import React from 'react';
import { CircleHelp, Plus, SlidersHorizontal, Trash2 } from 'lucide-react';
import type { Condition, MetricId, Operator } from '../../../../shared/api.interface';
import { METRICS, METRIC_MAP, OPERATOR_LABELS } from '../../../../shared/metric-catalog';
import { conditionsSchema, detectConflicts } from '../../../../shared/validation';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Switch } from '../../components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';

export function newCondition(metricId: MetricId = 'pe_ttm'): Condition {
  const metric = METRIC_MAP[metricId];
  return { id: crypto.randomUUID(), metricId, operator: 'lt', value: metricId === 'pe_ttm' ? 30 : 0,
    unit: metric.unit, basis: metric.basis, enabled: true, originalPhrase: '手动设置',
    assumptionReason: '请按研究目的设置阈值；初始值仅供编辑，不代表合理估值或投资建议。' };
}
interface ConditionEditorProps {
  conditions: Condition[];
  onChange: (conditions: Condition[]) => void;
  disabled: boolean;
}
const ConditionEditor: React.FC<ConditionEditorProps> = ({ conditions, onChange, disabled }) => {
  const validation = conditionsSchema.safeParse(conditions);
  const conflicts = detectConflicts(conditions);
  const patch = (id: string, values: Partial<Condition>): void =>
    onChange(conditions.map((condition: Condition) => condition.id === id ? { ...condition, ...values } : condition));
  return <section className="rounded-xl border bg-card" aria-label="条件编辑">
    <div className="flex items-center justify-between gap-3 border-b p-5">
      <div className="flex items-center gap-2 font-semibold"><SlidersHorizontal size={17} />筛选条件</div>
      <span className="text-xs text-muted-foreground">{conditions.filter((item) => item.enabled).length} 条生效 · 同时满足</span>
    </div>
    <div className="divide-y">
      {conditions.map((condition: Condition, index: number) => <div key={condition.id}
        className={`space-y-3 p-5 ${condition.enabled ? '' : 'bg-muted/40 opacity-70'}`}>
        <div className="flex items-center justify-between gap-3">
          <span className="text-[11px] font-semibold tracking-widest text-muted-foreground">条件 {String(index + 1).padStart(2, '0')}</span>
          <div className="flex items-center gap-2">
            <Switch disabled={disabled} checked={condition.enabled} aria-label={`启用条件${index + 1}`}
              onCheckedChange={(enabled: boolean) => patch(condition.id, { enabled })} />
            <Button variant="ghost" size="icon" disabled={disabled} aria-label={`删除条件${index + 1}`}
              onClick={() => onChange(conditions.filter((item: Condition) => item.id !== condition.id))}><Trash2 size={14} /></Button>
          </div>
        </div>
        <Select value={condition.metricId} disabled={disabled}
          onValueChange={(value: string) => {
            const next = newCondition(value as MetricId);
            patch(condition.id, { ...next, id: condition.id, enabled: condition.enabled });
          }}>
          <SelectTrigger className="w-full font-medium" aria-label={`条件${index + 1}指标`}><SelectValue /></SelectTrigger>
          <SelectContent>{METRICS.map((metric) => <SelectItem key={metric.id} value={metric.id}>{metric.name}</SelectItem>)}</SelectContent>
        </Select>
        <div className="flex items-center gap-2">
          <Select value={condition.operator} disabled={disabled}
            onValueChange={(value: string) => patch(condition.id, {
              operator: value as Operator, upperValue: value === 'between' ? condition.value : undefined,
            })}>
            <SelectTrigger className="w-28 shrink-0" aria-label={`条件${index + 1}比较方式`}><SelectValue /></SelectTrigger>
            <SelectContent>{Object.entries(OPERATOR_LABELS).map(([value, label]) =>
              <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent>
          </Select>
          <Input type="number" step="any" disabled={disabled} aria-label={`条件${index + 1}阈值`}
            value={Number.isFinite(condition.value) ? condition.value : ''}
            onChange={(event) => patch(condition.id, { value: event.target.value === '' ? NaN : Number(event.target.value) })}
            className="min-w-0 text-right tabular-nums" />
          <span className="shrink-0 text-xs text-muted-foreground">{condition.unit}</span>
        </div>
        {condition.operator === 'between' && <div className="flex items-center gap-2">
          <span className="shrink-0 text-xs text-muted-foreground">至（含）</span>
          <Input type="number" step="any" disabled={disabled} aria-label={`条件${index + 1}上限`}
            value={Number.isFinite(condition.upperValue) ? condition.upperValue : ''}
            onChange={(event) => patch(condition.id, { upperValue: event.target.value === '' ? NaN : Number(event.target.value) })} />
          <span className="text-xs">{condition.unit}</span>
        </div>}
        <details className="text-xs leading-5 text-muted-foreground">
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-1.5 hover:text-foreground">
            <CircleHelp size={14} />了解这个指标
          </summary>
          <div className="mt-2 space-y-2 rounded-md bg-muted/60 p-3">
            <p className="text-foreground">{METRIC_MAP[condition.metricId].summary}</p>
            <p><span className="font-medium text-foreground">数据口径：</span>{condition.basis}</p>
            <p><span className="font-medium text-foreground">计算方式：</span>{METRIC_MAP[condition.metricId].description}</p>
            <p><span className="font-medium text-foreground">对应描述：</span>{condition.originalPhrase || '手动添加'}</p>
            {condition.assumptionReason && <p><span className="font-medium text-foreground">使用提醒：</span>{condition.assumptionReason}</p>}
          </div>
        </details>
      </div>)}
    </div>
    {!conditions.length && <p className="p-5 text-sm leading-6 text-muted-foreground">先描述选股想法，或直接添加一条可核查的条件。</p>}
    <div className="space-y-3 p-5">
      <Button variant="outline" className="w-full" disabled={disabled || conditions.length >= 12}
        onClick={() => onChange([...conditions, newCondition()])}><Plus />添加条件</Button>
      {!validation.success && <p role="alert" className="text-xs leading-5 text-destructive">
        {validation.error.issues.map((issue) => issue.message).join('；')}</p>}
      {conflicts.map((conflict, index) => <p key={index} role="alert" className="text-xs leading-5 text-destructive">{conflict.message}</p>)}
    </div>
  </section>;
};
export default ConditionEditor;
