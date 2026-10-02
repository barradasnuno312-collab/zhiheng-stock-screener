import type {
  Condition, ConditionResult, DatasetSnapshot, ResultChange, RunComparison,
  ScreenRun, SnapshotSummary, StockFacts, StockResult, Verdict,
} from '../../../shared/api.interface';
import { formatValue, METRIC_MAP, OPERATOR_LABELS, RULES_VERSION } from '../../../shared/metric-catalog';
import { conditionsSchema, detectConflicts, sameCondition } from '../../../shared/validation';

export function snapshotSummary(snapshot: DatasetSnapshot): SnapshotSummary {
  const { stocks: _stocks, ...summary } = snapshot;
  return summary;
}
export function matches(value: number, condition: Condition): boolean {
  switch (condition.operator) {
    case 'gt': return value > condition.value;
    case 'gte': return value >= condition.value;
    case 'lt': return value < condition.value;
    case 'lte': return value <= condition.value;
    case 'between': return value >= condition.value && value <= condition.upperValue!;
  }
}
export function conditionLabel(condition: Condition): string {
  const metric = METRIC_MAP[condition.metricId];
  const threshold: string = condition.operator === 'between'
    ? `${formatValue(condition.value, metric.unit)}～${formatValue(condition.upperValue!, metric.unit)}（含边界）`
    : `${OPERATOR_LABELS[condition.operator]} ${formatValue(condition.value, metric.unit)}`;
  return `${metric.name} ${threshold}`;
}
export function evaluateStock(stock: StockFacts, conditions: Condition[]): StockResult {
  const evaluations: ConditionResult[] = conditions.filter((condition: Condition) => condition.enabled)
    .map((condition: Condition): ConditionResult => {
      const evidence = stock.metrics[condition.metricId];
      const known: boolean = evidence.status === 'available'
        && evidence.value !== null && Number.isFinite(evidence.value);
      const verdict: Verdict = known
        ? matches(evidence.value!, condition) ? 'pass' : 'fail' : 'unknown';
      const explanation: string = verdict === 'unknown'
        ? `${conditionLabel(condition)}：无法判断，${evidence.reason || '该指标数据不足'}`
        : `${formatValue(evidence.value, evidence.unit)}，${verdict === 'pass' ? '满足' : '不满足'}${conditionLabel(condition)}`;
      return { conditionId: condition.id, verdict, explanation, evidence };
    });
  const failures: number = evaluations.filter((item: ConditionResult) => item.verdict === 'fail').length;
  const unknowns: number = evaluations.filter((item: ConditionResult) => item.verdict === 'unknown').length;
  return {
    code: stock.code, name: stock.name,
    verdict: failures > 0 ? 'fail' : unknowns > 0 ? 'unknown' : 'pass',
    conditions: evaluations,
    onlyOneFailure: failures === 1 && unknowns === 0,
  };
}
export function screen(
  snapshot: DatasetSnapshot, conditions: Condition[], id: string, createdAt: string, intent = '',
): ScreenRun {
  conditionsSchema.parse(conditions);
  if (!conditions.some((condition: Condition) => condition.enabled)) throw new Error('至少启用一个条件');
  const conflicts = detectConflicts(conditions);
  if (conflicts.length) throw new Error(conflicts.map((item) => item.message).join('；'));
  if (!['ready', 'partial'].includes(snapshot.status)) throw new Error('数据快照尚未就绪');
  if (snapshot.stocks.length !== snapshot.memberCount
    || new Set(snapshot.stocks.map((stock: StockFacts) => stock.code)).size !== snapshot.memberCount) {
    throw new Error('股票池成员不完整或重复，筛选已停止');
  }
  const results: StockResult[] = snapshot.stocks.map(
    (stock: StockFacts) => evaluateStock(stock, conditions),
  ).sort((a: StockResult, b: StockResult) => a.code.localeCompare(b.code));
  return {
    id, snapshot: snapshotSummary(snapshot), conditions, createdAt, intent, rulesVersion: RULES_VERSION,
    results,
    coverage: {
      total: results.length,
      pass: results.filter((item: StockResult) => item.verdict === 'pass').length,
      fail: results.filter((item: StockResult) => item.verdict === 'fail').length,
      unknown: results.filter((item: StockResult) => item.verdict === 'unknown').length,
      complete: results.filter(
        (item: StockResult) => item.conditions.every((condition: ConditionResult) => condition.verdict !== 'unknown'),
      ).length,
    },
  };
}
export function resultChanges(before: StockResult[], after: StockResult[]): ResultChange[] {
  const previous = new Map(before.map((stock: StockResult) => [stock.code, stock]));
  const current = new Map(after.map((stock: StockResult) => [stock.code, stock]));
  const codes: string[] = [...new Set([...previous.keys(), ...current.keys()])].sort();
  return codes.flatMap((code: string): ResultChange[] => {
    const a = previous.get(code);
    const b = current.get(code);
    if (a?.verdict === b?.verdict) return [];
    const reasons: string[] = !a ? ['加入当前股票池'] : !b ? ['移出当前股票池'] :
      b.conditions.filter((item: ConditionResult) => {
        const old = a.conditions.find((entry: ConditionResult) => entry.conditionId === item.conditionId);
        return !old || old.verdict !== item.verdict;
      }).map((item: ConditionResult) => item.explanation);
    if (a && b) {
      for (const old of a.conditions) {
        if (!b.conditions.some((item: ConditionResult) => item.conditionId === old.conditionId)) {
          reasons.push(`已移除条件：${old.explanation}`);
        }
      }
    }
    return [{ code, name: b?.name ?? a!.name, before: a?.verdict ?? 'outside',
      after: b?.verdict ?? 'outside', reasons }];
  });
}
export function compareRuns(before: ScreenRun, after: ScreenRun): RunComparison {
  if (before.snapshot.id !== after.snapshot.id || before.snapshot.universeVersion !== after.snapshot.universeVersion) {
    throw new Error('条件影响比较必须使用同一数据快照和股票池版本');
  }
  const prior = new Set(before.results.filter((item: StockResult) => item.verdict === 'pass').map((item) => item.code));
  const next = new Set(after.results.filter((item: StockResult) => item.verdict === 'pass').map((item) => item.code));
  const changes: ResultChange[] = resultChanges(before.results, after.results);
  return {
    snapshotId: before.snapshot.id, beforeRunId: before.id, afterRunId: after.id,
    entered: [...next].filter((code: string) => !prior.has(code)),
    exited: changes.filter((item: ResultChange) => item.before === 'pass' && item.after === 'fail')
      .map((item: ResultChange) => item.code),
    retained: [...next].filter((code: string) => prior.has(code)),
    becameUnknown: changes.filter((item: ResultChange) => item.after === 'unknown')
      .map((item: ResultChange) => item.code),
    changes, independentEffects: [],
  };
}

/** Each condition is varied independently from the original; effects are not additive. */
export function conditionEffects(
  snapshot: DatasetSnapshot, before: ScreenRun, after: ScreenRun,
): RunComparison {
  const comparison: RunComparison = compareRuns(before, after);
  const old = new Map(before.conditions.map((condition: Condition) => [condition.id, condition]));
  const next = new Map(after.conditions.map((condition: Condition) => [condition.id, condition]));
  for (const id of new Set([...old.keys(), ...next.keys()])) {
    if (sameCondition(old.get(id), next.get(id))) continue;
    const isolated: Condition[] = before.conditions.filter((condition: Condition) => condition.id !== id);
    const replacement = next.get(id);
    if (replacement) isolated.push(replacement);
    if (!isolated.some((condition: Condition) => condition.enabled) || detectConflicts(isolated).length) continue;
    const run: ScreenRun = screen(snapshot, isolated, after.id, after.createdAt);
    const impact = compareRuns(before, run);
    comparison.independentEffects.push({ conditionId: id, entered: impact.entered.length, exited: impact.exited.length });
  }
  return comparison;
}
