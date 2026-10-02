import type { MetricDefinition, MetricId } from './api.interface';

export const RULES_VERSION = 'zh-v1.0.0';
export const METRICS: MetricDefinition[] = [
  {
    id: 'revenue_yoy_pct', name: '营业收入同比', unit: '%', basis: '最新已披露累计报告期',
    description: '（本期累计营收÷上年同报告期营收−1）×100；基期须为正。',
    min: -100, max: 100000,
  },
  {
    id: 'revenue_yoy_delta_pp', name: '营收同比增速变化', unit: '百分点', basis: '相邻累计报告期',
    description: '最新累计营收同比减上一连续报告期累计同比；不是单季环比。',
    min: -100000, max: 100000,
  },
  {
    id: 'parent_profit_yoy_pct', name: '归母净利润同比', unit: '%', basis: '最新已披露累计报告期',
    description: '归母净利润与上年同报告期比较；基期为零或负数时不计算普通同比。',
    min: -100000, max: 100000,
  },
  {
    id: 'pe_ttm', name: '市盈率 PE (TTM)', unit: '倍', basis: '供应商最新估值快照',
    description: '直接使用供应商PE(TTM)；非正值不作低估值判断，跨行业数值不代表低估。',
    min: 0, max: 100000,
  },
  {
    id: 'pb_mrq', name: '市净率 PB (MRQ)', unit: '倍', basis: '供应商最新估值快照',
    description: '直接使用供应商PB(MRQ)；非正值单列为不适用。',
    min: 0, max: 100000,
  },
  {
    id: 'volatility_60d_pct', name: '近60日年化波动率', unit: '%', basis: '60个交易日收益率',
    description: '61个连续交易日的前复权收盘价；日简单收益率样本标准差×√252×100。',
    min: 0, max: 10000,
  },
  {
    id: 'max_drawdown_60d_pct', name: '近60日最大回撤', unit: '%', basis: '60个交易日价格',
    description: '窗口内峰值至后续谷值的最大跌幅，以正数显示；历史回撤不代表未来风险。',
    min: 0, max: 100,
  },
  {
    id: 'avg_turnover_20d_cny', name: '近20日日均成交额', unit: '元', basis: '20个连续交易日',
    description: '20个连续有效交易日成交额算术平均，原始单位为人民币元。',
    min: 0, max: 1e15,
  },
];
export const METRIC_MAP = Object.fromEntries(METRICS.map(
  (metric: MetricDefinition) => [metric.id, metric],
)) as Record<MetricId, MetricDefinition>;
export const OPERATOR_LABELS = { gt: '>', gte: '≥', lt: '<', lte: '≤', between: '介于' } as const;

export function formatValue(value: number | null, unit: string): string {
  if (value === null || !Number.isFinite(value)) return '—';
  if (unit === '元' && Math.abs(value) >= 1e8) return `${(value / 1e8).toFixed(2)}亿元`;
  if (unit === '元' && Math.abs(value) >= 1e4) return `${(value / 1e4).toFixed(2)}万元`;
  return `${value.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}${unit}`;
}
