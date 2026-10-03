import type { MetricEvidence, MetricId, PricePoint, SourceInput } from '../../../shared/api.interface';
import { METRIC_MAP, RULES_VERSION } from '../../../shared/metric-catalog';

export interface SourceMeta {
  endpoint: string;
  requestId: string | null;
  fetchedAt: string;
  timestamp: number | null;
}
export interface FinancialReport {
  periodEnd: string;
  disclosureDate: string | null;
  revenue: number | null;
  parentProfit: number | null;
  currency: string | null;
}
export function numeric(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || !value.trim() || !/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(value.trim())) {
    return null;
  }
  const parsed: number = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
export function chinaDay(value: number | string | Date): string {
  const date: Date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error('无效日期');
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date);
}
export function timestampIso(value: number | null): string | null {
  return value !== null && Number.isFinite(value) && value > 0 ? new Date(value).toISOString() : null;
}
export function completedTradingDays(days: string[], now: Date): string[] {
  const today: string = chinaDay(now);
  const afterClose: boolean = now.getTime() >= new Date(`${today}T15:00:00+08:00`).getTime();
  if (new Set(days).size !== days.length) throw new Error('交易日历存在重复日期');
  return days.filter((day: string) => day < today || (day === today && afterClose)).sort();
}
export function emptyEvidence(metricId: MetricId, meta: SourceMeta, reason = '上游未返回该指标'): MetricEvidence {
  return {
    metricId, value: null, unit: METRIC_MAP[metricId].unit, status: 'missing', reason, inputs: [],
    reportPeriod: null, disclosureDate: null, quoteDate: null, fetchedAt: meta.fetchedAt,
    timestampScope: 'unknown', sourceEndpoint: meta.endpoint, requestId: meta.requestId,
    sourceTimestamp: timestampIso(meta.timestamp), formulaVersion: RULES_VERSION,
  };
}
function finish(evidence: MetricEvidence, value: number): MetricEvidence {
  if (!Number.isFinite(value)) return { ...evidence, status: 'error', reason: '计算结果非有限数值' };
  return { ...evidence, value, status: 'available', reason: '' };
}
export function valuationMetric(
  metricId: 'pe_ttm' | 'pb_mrq', raw: unknown, meta: SourceMeta,
): MetricEvidence {
  const evidence: MetricEvidence = {
    ...emptyEvidence(metricId, meta),
    timestampScope: 'response_max_only',
    inputs: [{ rawField: metricId, rawValue: typeof raw === 'string' || typeof raw === 'number' ? raw : null,
      reportPeriod: null, disclosureDate: null, quoteDate: null }],
  };
  const value: number | null = numeric(raw);
  if (value === null) return evidence;
  if (value <= 0) return { ...evidence, status: 'not_applicable', reason: '非正估值不适用于常规低估值筛选' };
  return finish(evidence, value);
}
export function normalizeReports(rows: Record<string, unknown>[]): FinancialReport[] {
  return rows.flatMap((row: Record<string, unknown>): FinancialReport[] => {
    const period: number | null = numeric(row.period_end_ms);
    const disclosure: number | null = numeric(row.report_date_ms);
    if (!period || period <= 0) return [];
    return [{
      periodEnd: chinaDay(period), disclosureDate: timestampIso(disclosure),
      revenue: numeric(row.operating_income), parentProfit: numeric(row.parent_holder_net_profit),
      currency: typeof row.currency === 'string' ? row.currency : null,
    }];
  });
}
function previousPeriod(period: string): string {
  const year: number = Number(period.slice(0, 4));
  switch (period.slice(5)) {
    case '03-31': return `${year - 1}-12-31`;
    case '06-30': return `${year}-03-31`;
    case '09-30': return `${year}-06-30`;
    case '12-31': return `${year}-09-30`;
    default: return '';
  }
}
function priorYear(period: string): string {
  return `${Number(period.slice(0, 4)) - 1}${period.slice(4)}`;
}
function reportInput(report: FinancialReport | undefined, field: 'revenue' | 'parentProfit'): SourceInput {
  return {
    rawField: field === 'revenue' ? 'operating_income' : 'parent_holder_net_profit',
    rawValue: report?.[field] ?? null, reportPeriod: report?.periodEnd ?? null,
    disclosureDate: report?.disclosureDate ?? null, quoteDate: null,
  };
}
export function financialMetrics(
  reports: FinancialReport[], meta: SourceMeta, asOf: Date, cumulativeVerified: boolean,
): Pick<Record<MetricId, MetricEvidence>, 'revenue_yoy_pct' | 'revenue_yoy_delta_pp' | 'parent_profit_yoy_pct'> {
  const eligible: FinancialReport[] = reports.filter((report: FinancialReport) =>
    !!report.disclosureDate && new Date(report.disclosureDate).getTime() <= asOf.getTime()
    && report.periodEnd <= chinaDay(asOf),
  ).sort((a: FinancialReport, b: FinancialReport) =>
    b.periodEnd.localeCompare(a.periodEnd) || b.disclosureDate!.localeCompare(a.disclosureDate!),
  );
  const latest = eligible[0];
  const byPeriod = new Map<string, FinancialReport>();
  for (const report of eligible) if (!byPeriod.has(report.periodEnd)) byPeriod.set(report.periodEnd, report);
  const calculate = (metricId: 'revenue_yoy_pct' | 'parent_profit_yoy_pct',
    current: FinancialReport | undefined): MetricEvidence => {
    const field: 'revenue' | 'parentProfit' = metricId === 'revenue_yoy_pct' ? 'revenue' : 'parentProfit';
    const baseline = current ? byPeriod.get(priorYear(current.periodEnd)) : undefined;
    const evidence: MetricEvidence = {
      ...emptyEvidence(metricId, meta), reportPeriod: current?.periodEnd ?? null,
      disclosureDate: current?.disclosureDate ?? null, timestampScope: 'per_report',
      inputs: [reportInput(current, field), reportInput(baseline, field)],
    };
    if (!cumulativeVerified) return { ...evidence, reason: '财报累计口径尚未完成真实数据核验' };
    if (!current || !baseline || current[field] === null || baseline[field] === null) {
      return { ...evidence, reason: '缺少已披露本期或上年同报告期可比值' };
    }
    if (current.currency !== 'CNY' || baseline.currency !== 'CNY') {
      return { ...evidence, reason: '币种缺失或不一致，不能计算同比' };
    }
    if (baseline[field]! <= 0) return { ...evidence, status: 'not_applicable', reason: '基期为零或负数，不计算普通同比' };
    return finish(evidence, (current[field]! / baseline[field]! - 1) * 100);
  };
  const revenue: MetricEvidence = calculate('revenue_yoy_pct', latest);
  const profit: MetricEvidence = calculate('parent_profit_yoy_pct', latest);
  const previous = latest ? byPeriod.get(previousPeriod(latest.periodEnd)) : undefined;
  const previousGrowth: MetricEvidence = calculate('revenue_yoy_pct', previous);
  const delta: MetricEvidence = {
    ...emptyEvidence('revenue_yoy_delta_pp', meta),
    inputs: [...revenue.inputs, ...previousGrowth.inputs],
    reportPeriod: revenue.reportPeriod, disclosureDate: revenue.disclosureDate, timestampScope: 'per_report',
  };
  const acceleration: MetricEvidence = revenue.value !== null && previousGrowth.value !== null
    ? finish(delta, revenue.value - previousGrowth.value)
    : { ...delta, reason: '需要最新及上一连续报告期、各自上年同期的有效累计营收' };
  return { revenue_yoy_pct: revenue, parent_profit_yoy_pct: profit, revenue_yoy_delta_pp: acceleration };
}
export function normalizePrices(rows: Record<string, unknown>[]): PricePoint[] {
  return rows.flatMap((row: Record<string, unknown>): PricePoint[] => {
    const timestamp: number | null = numeric(row.date_ms);
    if (!timestamp || timestamp <= 0) return [];
    return [{ date: chinaDay(timestamp), close: numeric(row.close_price),
      volume: numeric(row.volume), turnover: numeric(row.turnover) }];
  }).sort((a: PricePoint, b: PricePoint) => a.date.localeCompare(b.date));
}
function checkWindow(prices: PricePoint[], days: string[], count: number): { points: PricePoint[]; reason: string } {
  const window: string[] = days.slice(-count);
  if (window.length < count) return { points: [], reason: `交易日历不足${count}日` };
  const points: PricePoint[] = prices.filter((point: PricePoint) => window.includes(point.date));
  if (points.length !== count || new Set(points.map((point: PricePoint) => point.date)).size !== count) {
    return { points, reason: `需要${count}个连续交易日，存在缺日或重复日线` };
  }
  if (points.some((point: PricePoint) => point.close === null || point.close <= 0)) {
    return { points, reason: '窗口中存在缺失或非正收盘价' };
  }
  if (points.some((point: PricePoint) => point.volume === null || point.volume <= 0)) {
    return { points, reason: '窗口中存在停牌、零成交量或成交量缺失' };
  }
  return { points: points.sort((a: PricePoint, b: PricePoint) => a.date.localeCompare(b.date)), reason: '' };
}
export function priceMetrics(
  prices: PricePoint[], tradingDays: string[], meta: SourceMeta,
): Pick<Record<MetricId, MetricEvidence>,
  'volatility_60d_pct' | 'max_drawdown_60d_pct' | 'avg_turnover_20d_cny' | 'return_20d_pct' | 'price_vs_ma20_pct'> {
  const calculate = (metricId: 'volatility_60d_pct' | 'max_drawdown_60d_pct' | 'avg_turnover_20d_cny'
    | 'return_20d_pct' | 'price_vs_ma20_pct'): MetricEvidence => {
    const count: number = metricId === 'volatility_60d_pct' ? 61
      : metricId === 'max_drawdown_60d_pct' ? 60 : metricId === 'return_20d_pct' ? 21 : 20;
    const { points, reason } = checkWindow(prices, tradingDays, count);
    const evidence: MetricEvidence = {
      ...emptyEvidence(metricId, meta), quoteDate: points.at(-1)?.date ?? null, timestampScope: 'per_bar',
      inputs: points.map((point: PricePoint): SourceInput => ({
        rawField: metricId === 'avg_turnover_20d_cny' ? 'turnover' : 'close_price (forward)',
        rawValue: metricId === 'avg_turnover_20d_cny' ? point.turnover : point.close,
        reportPeriod: null, disclosureDate: null, quoteDate: point.date,
      })),
    };
    if (reason) return { ...evidence, reason };
    if (metricId === 'avg_turnover_20d_cny') {
      if (points.some((point: PricePoint) => point.turnover === null || point.turnover <= 0)) {
        return { ...evidence, reason: '窗口中存在缺失或零成交额' };
      }
      return finish(evidence, points.reduce((sum: number, point: PricePoint) => sum + point.turnover!, 0) / count);
    }
    const closes: number[] = points.map((point: PricePoint) => point.close!);
    if (metricId === 'return_20d_pct') {
      return finish(evidence, (closes.at(-1)! / closes[0] - 1) * 100);
    }
    if (metricId === 'price_vs_ma20_pct') {
      const average: number = closes.reduce((sum: number, close: number) => sum + close, 0) / closes.length;
      return finish(evidence, (closes.at(-1)! / average - 1) * 100);
    }
    if (metricId === 'max_drawdown_60d_pct') {
      let peak: number = closes[0];
      let drawdown = 0;
      for (const close of closes) {
        peak = Math.max(peak, close);
        drawdown = Math.max(drawdown, (peak - close) / peak);
      }
      return finish(evidence, drawdown * 100);
    }
    const returns: number[] = closes.slice(1).map((close: number, i: number) => close / closes[i] - 1);
    const mean: number = returns.reduce((sum: number, value: number) => sum + value, 0) / returns.length;
    const variance: number = returns.reduce((sum: number, value: number) => sum + (value - mean) ** 2, 0)
      / (returns.length - 1);
    return finish(evidence, Math.sqrt(variance * 252) * 100);
  };
  return {
    volatility_60d_pct: calculate('volatility_60d_pct'),
    max_drawdown_60d_pct: calculate('max_drawdown_60d_pct'),
    avg_turnover_20d_cny: calculate('avg_turnover_20d_cny'),
    return_20d_pct: calculate('return_20d_pct'),
    price_vs_ma20_pct: calculate('price_vs_ma20_pct'),
  };
}

export function deriveRecentPriceMetrics(
  source: MetricEvidence,
): Pick<Record<MetricId, MetricEvidence>, 'return_20d_pct' | 'price_vs_ma20_pct'> {
  const create = (metricId: 'return_20d_pct' | 'price_vs_ma20_pct', count: number): MetricEvidence => {
    const inputs = source.inputs.filter((input) => input.rawField === 'close_price (forward)').slice(-count);
    const evidence: MetricEvidence = {
      ...emptyEvidence(metricId, {
        endpoint: source.sourceEndpoint, requestId: source.requestId, fetchedAt: source.fetchedAt,
        timestamp: source.sourceTimestamp ? new Date(source.sourceTimestamp).getTime() : null,
      }),
      quoteDate: inputs.at(-1)?.quoteDate ?? source.quoteDate, timestampScope: 'per_bar', inputs,
    };
    if (source.status !== 'available' || inputs.length !== count) {
      return { ...evidence, reason: `需要已有快照中${count}个连续交易日的已验证收盘价` };
    }
    const closes = inputs.map((input) => numeric(input.rawValue));
    if (closes.some((close) => close === null || close <= 0)) {
      return { ...evidence, reason: '已有快照的收盘价窗口不完整' };
    }
    if (metricId === 'return_20d_pct') return finish(evidence, (closes.at(-1)! / closes[0]! - 1) * 100);
    const average = closes.reduce((sum, close) => sum + close!, 0) / closes.length;
    return finish(evidence, (closes.at(-1)! / average - 1) * 100);
  };
  return {
    return_20d_pct: create('return_20d_pct', 21),
    price_vs_ma20_pct: create('price_vs_ma20_pct', 20),
  };
}
