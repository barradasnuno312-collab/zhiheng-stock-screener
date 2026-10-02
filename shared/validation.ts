import { z } from 'zod';
import { METRIC_IDS } from './api.interface';
import type { Condition, ConditionConflict, MetricId } from './api.interface';
import { METRIC_MAP } from './metric-catalog';

export const conditionSchema = z.object({
  id: z.string().min(1).max(80).regex(/^[a-zA-Z0-9_-]+$/),
  metricId: z.enum(METRIC_IDS),
  operator: z.enum(['gt', 'gte', 'lt', 'lte', 'between']),
  value: z.number().finite(),
  upperValue: z.number().finite().optional(),
  enabled: z.boolean(),
  originalPhrase: z.string().max(500),
  assumptionReason: z.string().max(800),
  unit: z.enum(['%', '百分点', '倍', '元']),
  basis: z.string().max(100),
}).strict().superRefine((condition, ctx) => {
  const metric = METRIC_MAP[condition.metricId];
  if (condition.unit !== metric.unit || condition.basis !== metric.basis) {
    ctx.addIssue({ code: 'custom', message: `${metric.name}的单位或计算窗口不受支持` });
  }
  for (const value of [condition.value, condition.upperValue]) {
    if (value !== undefined && (value < metric.min || value > metric.max)) {
      ctx.addIssue({ code: 'custom', message: `${metric.name}阈值超出可用范围` });
    }
  }
  if (condition.operator === 'between') {
    if (condition.upperValue === undefined || condition.upperValue < condition.value) {
      ctx.addIssue({ code: 'custom', message: '区间需要有效且不小于下限的上限' });
    }
  } else if (condition.upperValue !== undefined) {
    ctx.addIssue({ code: 'custom', message: '只有区间条件可以设置上限字段' });
  }
});
export const conditionsSchema = z.array(conditionSchema).max(12).superRefine((conditions, ctx) => {
  if (new Set(conditions.map((condition) => condition.id)).size !== conditions.length) {
    ctx.addIssue({ code: 'custom', message: '条件ID重复' });
  }
});
export const draftSchema = z.object({
  intentSummary: z.string().min(1).max(500),
  conditions: conditionsSchema,
  clarifications: z.array(z.string().max(600)).max(2),
  unsupportedRequests: z.array(z.string().max(600)).max(12),
  warnings: z.array(z.string().max(600)).max(12),
}).strict();
export const screenRequestSchema = z.object({
  conditions: conditionsSchema.refine((items) => items.some((item) => item.enabled), '至少启用一个条件'),
  snapshotId: z.string().uuid(),
  universeVersion: z.string().min(1).max(100),
  intent: z.string().max(2000),
  confirmed: z.literal(true, { error: '请先确认筛选条件' }),
}).strict();
export const parseRequestSchema = z.object({
  text: z.string().trim().min(2).max(2000),
  previousConditions: conditionsSchema,
}).strict();
export const saveRequestSchema = z.object({
  name: z.string().trim().min(1).max(80),
  runId: z.string().uuid(),
  strategyId: z.string().uuid().optional(),
}).strict();

/** JSONB can reorder object keys; equality must compare the condition values. */
export function sameCondition(a: Condition | undefined, b: Condition | undefined): boolean {
  if (!a || !b) return a === b;
  return a.id === b.id && a.metricId === b.metricId && a.operator === b.operator
    && a.value === b.value && a.upperValue === b.upperValue && a.enabled === b.enabled
    && a.unit === b.unit && a.basis === b.basis
    && a.originalPhrase === b.originalPhrase && a.assumptionReason === b.assumptionReason;
}
export function sameConditions(a: Condition[], b: Condition[]): boolean {
  return a.length === b.length && a.every((condition: Condition, index: number) => sameCondition(condition, b[index]));
}

interface Interval {
  lower: number;
  upper: number;
  lowerInclusive: boolean;
  upperInclusive: boolean;
}
function interval(condition: Condition): Interval {
  return {
    lower: ['gt', 'gte', 'between'].includes(condition.operator) ? condition.value : -Infinity,
    upper: condition.operator === 'between'
      ? condition.upperValue! : ['lt', 'lte'].includes(condition.operator) ? condition.value : Infinity,
    lowerInclusive: condition.operator !== 'gt',
    upperInclusive: condition.operator !== 'lt',
  };
}
export function detectConflicts(conditions: Condition[]): ConditionConflict[] {
  const conflicts: ConditionConflict[] = [];
  for (const metricId of METRIC_IDS) {
    const group: Condition[] = conditions.filter(
      (condition: Condition) => condition.enabled && condition.metricId === metricId,
    );
    for (let i = 0; i < group.length; i += 1) {
      for (let j = i + 1; j < group.length; j += 1) {
        const a: Interval = interval(group[i]);
        const b: Interval = interval(group[j]);
        const lower: number = Math.max(a.lower, b.lower);
        const upper: number = Math.min(a.upper, b.upper);
        const inclusive: boolean =
          (lower !== a.lower || a.lowerInclusive) && (lower !== b.lower || b.lowerInclusive) &&
          (upper !== a.upper || a.upperInclusive) && (upper !== b.upper || b.upperInclusive);
        if (lower > upper || (lower === upper && !inclusive)) {
          conflicts.push({
            metricId: metricId as MetricId,
            conditionIds: [group[i].id, group[j].id],
            message: `${METRIC_MAP[metricId].name}的两条条件无交集，请调整阈值或停用一条。`,
          });
        }
      }
    }
  }
  return conflicts;
}
