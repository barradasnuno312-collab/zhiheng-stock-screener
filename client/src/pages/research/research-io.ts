import type { Condition, MetricId, Operator, ScreenRun, StockResult } from '../../../../shared/api.interface';
import { formatValue, METRIC_MAP } from '../../../../shared/metric-catalog';
import { conditionsSchema } from '../../../../shared/validation';
import { VERDICT_LABEL } from './research-format';

interface SharedCondition {
  metricId: MetricId;
  operator: Operator;
  value: number;
  upperValue?: number;
  enabled: boolean;
}
interface SharedScreen {
  version: 1;
  intent: string;
  conditions: SharedCondition[];
}
export interface DecodedScreen {
  intent: string;
  conditions: Condition[];
}

function encodeBase64Url(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
function decodeBase64Url(value: string): string {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '='));
  return new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)));
}

export function encodeSharedScreen(intent: string, conditions: Condition[]): string {
  const payload: SharedScreen = {
    version: 1,
    intent: intent.slice(0, 2000),
    conditions: conditions.map(({ metricId, operator, value, upperValue, enabled }) => ({
      metricId, operator, value, ...(upperValue === undefined ? {} : { upperValue }), enabled,
    })),
  };
  return encodeBase64Url(JSON.stringify(payload));
}

export function decodeSharedScreen(value: string | null): DecodedScreen | null {
  if (!value || value.length > 12000) return null;
  try {
    const payload = JSON.parse(decodeBase64Url(value)) as Partial<SharedScreen>;
    if (payload.version !== 1 || typeof payload.intent !== 'string' || payload.intent.length > 2000
      || !Array.isArray(payload.conditions) || payload.conditions.length > 12) return null;
    const conditions: Condition[] = payload.conditions.map((item, index) => {
      if (!item || typeof item !== 'object' || !(item.metricId in METRIC_MAP)
        || !['gt', 'gte', 'lt', 'lte', 'between'].includes(item.operator)
        || typeof item.value !== 'number' || !Number.isFinite(item.value)
        || typeof item.enabled !== 'boolean') throw new Error('invalid shared condition');
      const metric = METRIC_MAP[item.metricId];
      return {
        id: `shared-${index + 1}`, metricId: item.metricId, operator: item.operator,
        value: item.value, ...(item.upperValue === undefined ? {} : { upperValue: item.upperValue }),
        enabled: item.enabled, unit: metric.unit, basis: metric.basis,
        originalPhrase: '分享的筛选条件', assumptionReason: '请核对阈值后再执行；分享链接不包含历史结果。',
      };
    });
    if (!conditionsSchema.safeParse(conditions).success) return null;
    return { intent: payload.intent, conditions };
  } catch {
    return null;
  }
}

export function buildShareUrl(intent: string, conditions: Condition[], href: string): string {
  const url = new URL(href);
  url.pathname = url.pathname.replace(/\/strategies\/?$/, '');
  url.search = '';
  url.hash = '';
  url.searchParams.set('screen', encodeSharedScreen(intent, conditions));
  return url.toString();
}

function csvCell(value: string | number): string {
  let text = String(value);
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export function buildResultsCsv(run: ScreenRun, rows: StockResult[]): string {
  const enabled = run.conditions.filter((condition) => condition.enabled);
  const headers: (string | number)[] = ['股票代码', '股票名称', '判断', '行情日', '数据版本'];
  for (const condition of enabled) {
    const name = METRIC_MAP[condition.metricId].name;
    headers.push(`${name}数值`, `${name}判断`, `${name}说明`);
  }
  const body = rows.map((stock) => {
    const values: (string | number)[] = [
      stock.code, stock.name, VERDICT_LABEL[stock.verdict], run.snapshot.quoteDate, run.snapshot.id,
    ];
    for (const condition of enabled) {
      const result = stock.conditions.find((item) => item.conditionId === condition.id);
      values.push(
        formatValue(result?.evidence.value ?? null, result?.evidence.unit ?? METRIC_MAP[condition.metricId].unit),
        result ? VERDICT_LABEL[result.verdict] : '待核实',
        result?.explanation ?? '当前快照缺少该条件结果',
      );
    }
    return values.map(csvCell).join(',');
  });
  return `\uFEFF${[headers.map(csvCell).join(','), ...body].join('\r\n')}\r\n`;
}
