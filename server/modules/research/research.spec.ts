/** Synthetic fixtures only. Never loaded by the application or used as market facts. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  completedTradingDays, deriveRecentPriceMetrics, emptyEvidence, financialMetrics, numeric, priceMetrics,
  valuationMetric,
} from './metrics';
import type { FinancialReport, SourceMeta } from './metrics';
import { METRICS, METRIC_MAP } from '../../../shared/metric-catalog';
import {
  conditionsSchema, detectConflicts, draftSchema, sameConditions, screenRequestSchema,
} from '../../../shared/validation';
import type { Condition, DatasetSnapshot, MetricId, PricePoint, StockFacts } from '../../../shared/api.interface';
import { compareRuns, conditionEffects, screen } from './screening';

const meta: SourceMeta = {
  endpoint: '/synthetic-test-only', requestId: 'test-evidence',
  fetchedAt: '2026-10-02T06:00:00Z', timestamp: null,
};
const pe = (id: string, operator: Condition['operator'], value: number, upperValue?: number): Condition => ({
  id, metricId: 'pe_ttm', operator, value, ...(upperValue === undefined ? {} : { upperValue }),
  enabled: true, originalPhrase: '合成条件', assumptionReason: '', unit: '倍', basis: METRIC_MAP.pe_ttm.basis,
});
const report = (periodEnd: string, revenue: number | null, parentProfit = 10): FinancialReport => ({
  periodEnd, revenue, parentProfit, currency: 'CNY', disclosureDate: `${periodEnd}T10:00:00Z`,
});
const reports: FinancialReport[] = [
  report('2026-06-30', 150), report('2026-03-31', 60),
  report('2025-06-30', 100), report('2025-03-31', 50),
];
const days: string[] = Array.from({ length: 61 }, (_: unknown, i: number) =>
  new Date(Date.UTC(2026, 5, i + 1)).toISOString().slice(0, 10),
);
const points: PricePoint[] = days.map((date: string) => ({ date, close: 100, volume: 100, turnover: 10000 }));
function stock(code: string, peValue: number | null): StockFacts {
  const metrics = Object.fromEntries(METRICS.map((metric) => [
    metric.id, emptyEvidence(metric.id, meta),
  ])) as StockFacts['metrics'];
  metrics.pe_ttm = valuationMetric('pe_ttm', peValue, meta);
  return { code, name: '合成测试股票', metrics, prices: [], errors: [] };
}
function snapshot(stocks: StockFacts[]): DatasetSnapshot {
  return {
    id: 'test-snapshot', universeVersion: 'test-universe', universeName: '沪深300',
    memberCount: stocks.length, quoteDate: '2026-09-30', fetchedAt: meta.fetchedAt,
    status: 'partial', completedCount: stocks.length, errorCount: 0, marketClosed: true, warnings: [], stocks,
  };
}

test('null, empty strings, booleans and invalid strings never become zero', () => {
  for (const value of [null, undefined, '', ' ', false, true, 'NaN', '1,000', Infinity]) assert.equal(numeric(value), null);
  assert.equal(numeric(0), 0);
  assert.equal(numeric('0'), 0);
  assert.equal(numeric('1.25e2'), 125);
});
test('negative and zero PE are not applicable, positive PE retains exact precision', () => {
  assert.equal(valuationMetric('pe_ttm', -10, meta).status, 'not_applicable');
  assert.equal(valuationMetric('pe_ttm', 0, meta).value, null);
  assert.equal(valuationMetric('pe_ttm', 12.345678, meta).value, 12.345678);
  assert.equal(valuationMetric('pe_ttm', 12, meta).quoteDate, null);
  assert.equal(valuationMetric('pe_ttm', 12, meta).timestampScope, 'response_max_only');
});
test('cumulative revenue YoY and acceleration use comparable prior-year periods', () => {
  const values = financialMetrics(reports, meta, new Date(meta.fetchedAt), true);
  assert.equal(values.revenue_yoy_pct.value, 50);
  assert.ok(Math.abs(values.revenue_yoy_delta_pp.value! - 30) < 1e-10);
  assert.equal(values.parent_profit_yoy_pct.value, 0);
  assert.equal(values.revenue_yoy_delta_pp.inputs.length, 4);
});
test('future disclosures are excluded, not selected as latest report', () => {
  const future: FinancialReport = { ...report('2026-09-30', 999), disclosureDate: '2026-10-28T00:00:00Z' };
  const values = financialMetrics([future, ...reports], meta, new Date(meta.fetchedAt), true);
  assert.equal(values.revenue_yoy_pct.reportPeriod, '2026-06-30');
});
test('zero or negative baseline is not ordinary growth; missing is not zero', () => {
  for (const revenue of [0, -10, null]) {
    const values = financialMetrics([report('2026-06-30', 100), report('2025-06-30', revenue)],
      meta, new Date(meta.fetchedAt), true);
    assert.equal(values.revenue_yoy_pct.value, null);
  }
});
test('unverified cumulative basis blocks computation', () => {
  assert.equal(financialMetrics(reports, meta, new Date(meta.fetchedAt), false).revenue_yoy_pct.value, null);
});
test('acceleration cannot skip a missing adjacent quarter', () => {
  const values = financialMetrics(reports.filter((item) => item.periodEnd !== '2026-03-31'),
    meta, new Date(meta.fetchedAt), true);
  assert.equal(values.revenue_yoy_pct.value, 50);
  assert.equal(values.revenue_yoy_delta_pp.value, null);
});
test('parent profit uses parent figure and not ordinary net profit', () => {
  const values = financialMetrics([report('2026-06-30', 100, 15), report('2025-06-30', 80, 10)],
    meta, new Date(meta.fetchedAt), true);
  assert.equal(values.parent_profit_yoy_pct.value, 50);
});
test('same-day earlier available restatement is selected and unknown disclosure is excluded', () => {
  const amended: FinancialReport = { ...report('2026-06-30', 160), disclosureDate: '2026-09-01T00:00:00Z' };
  const undisclosed: FinancialReport = { ...report('2026-09-30', 800), disclosureDate: null };
  const values = financialMetrics([...reports, amended, undisclosed], meta, new Date(meta.fetchedAt), true);
  assert.ok(Math.abs(values.revenue_yoy_pct.value! - 60) < 1e-10);
});
test('currency mismatch blocks financial ratios', () => {
  const values = financialMetrics(reports.map((row) => ({ ...row, currency: 'USD' })),
    meta, new Date(meta.fetchedAt), true);
  assert.equal(values.revenue_yoy_pct.value, null);
});
test('flat price window produces zero volatility and drawdown, not missing', () => {
  const values = priceMetrics(points, days, meta);
  assert.equal(values.volatility_60d_pct.value, 0);
  assert.equal(values.max_drawdown_60d_pct.value, 0);
  assert.equal(values.avg_turnover_20d_cny.value, 10000);
  assert.equal(values.return_20d_pct.value, 0);
  assert.equal(values.price_vs_ma20_pct.value, 0);
});
test('20-day return and moving-average distance use exact consecutive windows', () => {
  const trend: PricePoint[] = points.map((point, index) =>
    ({ ...point, close: index < 40 ? 100 : 100 + index - 40 }));
  const values = priceMetrics(trend, days, meta);
  assert.ok(Math.abs(values.return_20d_pct.value! - 20) < 1e-10);
  assert.ok(Math.abs(values.price_vs_ma20_pct.value! - (120 / 110.5 - 1) * 100) < 1e-10);
  assert.equal(values.return_20d_pct.inputs.length, 21);
  assert.equal(values.price_vs_ma20_pct.inputs.length, 20);
});
test('new price metrics can be derived from a legacy snapshot validated price window', () => {
  const trend: PricePoint[] = points.map((point, index) =>
    ({ ...point, close: index < 40 ? 100 : 100 + index - 40 }));
  const values = priceMetrics(trend, days, meta);
  const derived = deriveRecentPriceMetrics(values.volatility_60d_pct);
  assert.ok(Math.abs(derived.return_20d_pct.value! - 20) < 1e-10);
  assert.ok(Math.abs(derived.price_vs_ma20_pct.value! - (120 / 110.5 - 1) * 100) < 1e-10);
});
test('60 returns use sample variance and 252 annualization', () => {
  let close = 100;
  const alternating: PricePoint[] = points.map((point: PricePoint, i: number) => {
    if (i > 0) close *= i % 2 ? 1.01 : 0.99;
    return { ...point, close };
  });
  const value = priceMetrics(alternating, days, meta).volatility_60d_pct.value;
  assert.ok(Math.abs(value! - Math.sqrt((60 * 0.01 ** 2 / 59) * 252) * 100) < 1e-9);
});
test('drawdown is a positive magnitude and uses the 60 price window', () => {
  const sequence = points.map((point: PricePoint, i: number) =>
    ({ ...point, close: i === 0 ? 1000 : i === 30 ? 80 : 100 }));
  assert.equal(priceMetrics(sequence, days, meta).max_drawdown_60d_pct.value, 20);
});
test('61 closes required for 60 returns; 60 closes are insufficient', () => {
  const values = priceMetrics(points.slice(1), days, meta);
  assert.equal(values.volatility_60d_pct.value, null);
  assert.equal(values.max_drawdown_60d_pct.value, 0);
});
test('duplicate days and gaps block affected windows only', () => {
  const missing = priceMetrics(points.filter((_: PricePoint, i: number) => i !== 10), days, meta);
  assert.equal(missing.volatility_60d_pct.value, null);
  assert.equal(missing.avg_turnover_20d_cny.value, 10000);
  assert.equal(priceMetrics([...points, points[60]], days, meta).volatility_60d_pct.value, null);
});
test('nonpositive price, suspension, missing amount are handled explicitly', () => {
  for (const patch of [{ close: 0 }, { volume: 0 }, { volume: null }]) {
    const values = priceMetrics(points.map((row, i) => i === 60 ? { ...row, ...patch } : row), days, meta);
    assert.equal(values.volatility_60d_pct.value, null);
  }
  const values = priceMetrics(points.map((row, i) => i === 60 ? { ...row, turnover: null } : row), days, meta);
  assert.equal(values.avg_turnover_20d_cny.value, null);
  assert.equal(values.volatility_60d_pct.value, 0);
});
test('holiday keeps last completed date; current pre-close day is excluded', () => {
  assert.deepEqual(completedTradingDays(['2026-09-29', '2026-09-30'], new Date(meta.fetchedAt)),
    ['2026-09-29', '2026-09-30']);
  assert.deepEqual(completedTradingDays(['2026-09-29', '2026-09-30'], new Date('2026-09-30T06:00:00Z')),
    ['2026-09-29']);
});
test('strict-bound conflicts and inclusive single-point intersection', () => {
  assert.equal(detectConflicts([pe('a', 'gt', 30), pe('b', 'lt', 10)]).length, 1);
  assert.equal(detectConflicts([pe('a', 'gt', 10), pe('b', 'lte', 10)]).length, 1);
  assert.equal(detectConflicts([pe('a', 'gte', 10), pe('b', 'lte', 10)]).length, 0);
  assert.equal(detectConflicts([pe('a', 'between', 10, 30), pe('b', 'gt', 30)]).length, 1);
});
test('disabled conditions cannot cause conflicts', () => {
  assert.equal(detectConflicts([pe('a', 'gt', 30), { ...pe('b', 'lt', 10), enabled: false }]).length, 0);
});
test('schema rejects unknown metrics, unit/window mismatch and malformed ranges', () => {
  for (const patch of [
    { metricId: 'arbitrary_execute' }, { unit: '%' }, { basis: '近5日' },
    { value: null }, { value: '30' }, { operator: 'between' }, { operator: 'between', upperValue: 1 },
    { value: Infinity }, { value: -1 }, { injected: 'execute' },
  ]) assert.equal(conditionsSchema.safeParse([{ ...pe('x', 'lt', 30), ...patch }]).success, false);
  assert.equal(conditionsSchema.safeParse([pe('x', 'gt', 10), pe('x', 'lt', 30)]).success, false);
});
test('metric help separates plain-language meaning from technical calculation detail', () => {
  for (const metric of METRICS) {
    assert.ok(metric.summary.length >= 10);
    assert.ok(metric.description.length >= 10);
    assert.notEqual(metric.summary, metric.description);
  }
});
test('screen execution still requires explicit confirmation from the primary action', () => {
  const request = {
    conditions: [pe('x', 'lt', 30)],
    snapshotId: '00000000-0000-4000-8000-000000000000',
    universeVersion: 'test-universe',
    intent: '市盈率小于30倍',
  };
  assert.equal(screenRequestSchema.safeParse(request).success, false);
  assert.equal(screenRequestSchema.safeParse({ ...request, confirmed: false }).success, false);
  assert.equal(screenRequestSchema.safeParse({ ...request, confirmed: true }).success, true);
});
test('AI cannot exceed two clarifications or omit required output fields', () => {
  assert.equal(draftSchema.safeParse({ intentSummary: 'test', conditions: [], clarifications: ['a', 'b', 'c'],
    unsupportedRequests: [], warnings: [] }).success, false);
  assert.equal(draftSchema.safeParse({ conditions: [] }).success, false);
});
test('three-valued classification conserves all universe members', () => {
  const run = screen(snapshot([stock('S1', 10), stock('S2', 40), stock('S3', null)]), [pe('pe', 'lt', 30)], 'r', 't');
  assert.deepEqual(run.coverage, { total: 3, pass: 1, fail: 1, unknown: 1, complete: 2 });
  assert.equal(run.results[1].onlyOneFailure, true);
});
test('fail plus unknown remains excluded and retains unknown evidence', () => {
  const metricId: MetricId = 'revenue_yoy_pct';
  const growth: Condition = { ...pe('rev', 'gt', 0), metricId, unit: '%', basis: METRIC_MAP[metricId].basis };
  const run = screen(snapshot([stock('S1', 40)]), [pe('pe', 'lt', 30), growth], 'r', 't');
  assert.equal(run.results[0].verdict, 'fail');
  assert.equal(run.results[0].conditions[1].verdict, 'unknown');
  assert.equal(run.results[0].onlyOneFailure, false);
});
test('new metrics remain unknown on older immutable snapshots instead of crashing', () => {
  const legacy = stock('S1', 10);
  delete (legacy.metrics as Partial<StockFacts['metrics']>).return_20d_pct;
  const condition: Condition = {
    ...pe('return', 'gt', 0), metricId: 'return_20d_pct', unit: '%',
    basis: METRIC_MAP.return_20d_pct.basis,
  };
  const run = screen(snapshot([legacy]), [condition], 'legacy-run', 't');
  assert.equal(run.results[0].verdict, 'unknown');
  assert.match(run.results[0].conditions[0].evidence.reason, /尚未包含/);
});
test('empty, conflicting and incomplete universe screens stop before producing results', () => {
  const data = snapshot([stock('S1', 10)]);
  assert.throws(() => screen(data, [], 'r', 't'));
  assert.throws(() => screen(data, [pe('a', 'gt', 30), pe('b', 'lt', 10)], 'r', 't'));
  assert.throws(() => screen({ ...data, memberCount: 300 }, [pe('a', 'lt', 30)], 'r', 't'));
  assert.throws(() => screen(snapshot([stock('S1', 10), stock('S1', 20)]), [pe('a', 'lt', 30)], 'r', 't'));
});
test('same snapshot repeatability and condition impact isolation', () => {
  const data = snapshot([stock('S1', 10), stock('S2', 28), stock('S3', 40)]);
  const before = screen(data, [pe('pe', 'lte', 30)], 'r1', 't');
  assert.deepEqual(screen(data, [pe('pe', 'lte', 30)], 'r1', 't'), before);
  const after = screen(data, [pe('pe', 'lte', 25)], 'r2', 't');
  const comparison = conditionEffects(data, before, after);
  assert.deepEqual(comparison.exited, ['S2']);
  assert.equal(comparison.independentEffects[0].exited, 1);
  assert.ok(comparison.changes[0].reasons[0].includes('28'));
  assert.throws(() => compareRuns(before, { ...after, snapshot: { ...after.snapshot, id: 'another' } }));
});
test('database key order does not mark unchanged conditions dirty or create independent effects', () => {
  const original: Condition = pe('pe', 'lt', 30);
  const restored: Condition = conditionSchemaFromReorderedKeys(original);
  assert.equal(sameConditions([original], [restored]), true);
  assert.equal(sameConditions([{ ...original, upperValue: undefined }], [restored]), true);
  assert.equal(sameConditions([original], [{ ...restored, value: 10 }]), false);
  assert.equal(sameConditions([original], [{ ...restored, enabled: false }]), false);
  assert.equal(sameConditions([original], []), false);
  const data: DatasetSnapshot = snapshot([stock('S1', 10)]);
  const before: ScreenRun = screen(data, [original], 'r1', 't');
  const after: ScreenRun = { ...before, id: 'r2', conditions: [restored] };
  assert.deepEqual(conditionEffects(data, before, after).independentEffects, []);
});
function conditionSchemaFromReorderedKeys(condition: Condition): Condition {
  const { id, ...fields } = condition;
  return { ...fields, id };
}
test('pass to unknown is not mislabeled as an explicit condition failure', () => {
  const data = snapshot([stock('S1', 10)]);
  const before = screen(data, [pe('pe', 'lte', 30)], 'r1', 't');
  const after = screen(data, [...before.conditions, {
    ...pe('revenue', 'gt', 0), metricId: 'revenue_yoy_pct', unit: '%', basis: METRIC_MAP.revenue_yoy_pct.basis,
  }], 'r2', 't');
  const comparison = compareRuns(before, after);
  assert.deepEqual(comparison.exited, []);
  assert.deepEqual(comparison.becameUnknown, ['S1']);
});
