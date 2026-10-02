import React from 'react';
import ReactEChartsCore from 'echarts-for-react/lib/core';
import * as echarts from 'echarts/core';
import { LineChart } from 'echarts/charts';
import { AriaComponent, GridComponent, TooltipComponent } from 'echarts/components';
import { SVGRenderer } from 'echarts/renderers';
import type { EChartsOption } from 'echarts';
import type { MetricEvidence, StockCompareResponse, StockFacts } from '../../../../shared/api.interface';
import { formatValue, METRICS, METRIC_MAP } from '../../../../shared/metric-catalog';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../../components/ui/dialog';
import { VerdictBadge } from './ResultsPanel';

echarts.use([LineChart, GridComponent, TooltipComponent, AriaComponent, SVGRenderer]);
export function displayTime(value: string | null): string {
  if (!value) return '未提供';
  return new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
}
const Prices: React.FC<{ stock: StockFacts }> = ({ stock }) => {
  if (!stock.prices.length) return <div className="flex h-44 items-center justify-center rounded-lg bg-muted text-sm text-muted-foreground">历史日线暂不可用</div>;
  const option: EChartsOption = {
    animation: false, aria: { enabled: true },
    grid: { top: 20, bottom: 30, left: 44, right: 10 },
    tooltip: { trigger: 'axis', renderMode: 'richText' },
    xAxis: { type: 'category', data: stock.prices.map((point) => point.date), axisLabel: { fontSize: 10 }, boundaryGap: false },
    yAxis: { type: 'value', scale: true, splitNumber: 3, axisLabel: { fontSize: 10 },
      splitLine: { lineStyle: { color: '#e9edef' } } },
    series: [{ type: 'line', data: stock.prices.map((point) => point.close),
      showSymbol: false, connectNulls: false, lineStyle: { width: 2, color: '#21675a' },
      areaStyle: { color: '#21675a', opacity: 0.04 } }],
  };
  return <ReactEChartsCore echarts={echarts} option={option} className="h-44 w-full" opts={{ renderer: 'svg' }} />;
};
const Evidence: React.FC<{ evidence: MetricEvidence }> = ({ evidence }) => <details className="border-t py-3 text-xs leading-5">
  <summary className="flex cursor-pointer items-center justify-between gap-3">
    <span>{METRIC_MAP[evidence.metricId].name}</span>
    <span className="font-medium tabular-nums">{formatValue(evidence.value, evidence.unit)}</span>
  </summary>
  <div className="mt-3 space-y-2 rounded-lg bg-muted/60 p-3 text-muted-foreground">
    <p>{METRIC_MAP[evidence.metricId].description}</p>
    {evidence.reason && <p className="font-medium">{evidence.reason}</p>}
    <dl className="grid grid-cols-[72px_1fr] gap-x-2 gap-y-1 break-words">
      <dt>报告期</dt><dd>{evidence.reportPeriod ?? '未提供 / 不适用'}</dd>
      <dt>披露日</dt><dd>{evidence.disclosureDate ?? '未提供 / 不适用'}</dd>
      <dt>行情日</dt><dd>{evidence.quoteDate ?? '未提供 / 不适用'}</dd>
      <dt>抓取时间</dt><dd>{displayTime(evidence.fetchedAt)}</dd>
      <dt>时间粒度</dt><dd>{{ per_report: '逐份报告', per_bar: '逐日行情', response_max_only: '仅响应中最大时间，非个股时间', unknown: '未知' }[evidence.timestampScope]}</dd>
      <dt>来源时间</dt><dd>{evidence.sourceTimestamp ?? '未提供'}</dd>
      <dt>接口</dt><dd className="break-all">{evidence.sourceEndpoint || '未取得有效响应'}</dd>
      <dt>请求ID</dt><dd className="break-all">{evidence.requestId ?? '未提供'}</dd>
      <dt>公式版本</dt><dd>{evidence.formulaVersion}</dd>
    </dl>
    <div className="border-t pt-2">
      <p className="mb-2 font-medium text-foreground">原始计算输入</p>
      {evidence.inputs.length ? evidence.inputs.map((input, index) => <div key={index} className="mb-2 break-all">
        <code>{input.rawField}</code> = {input.rawValue === null ? 'null' : String(input.rawValue)}
        <p>报告期 {input.reportPeriod ?? '—'} · 披露日 {input.disclosureDate ?? '—'} · 行情日 {input.quoteDate ?? '—'}</p>
      </div>) : <p>无可用输入，无法复算。</p>}
    </div>
  </div>
</details>;

interface EvidenceDialogProps { data: StockCompareResponse | null; onClose: () => void }
const EvidenceDialog: React.FC<EvidenceDialogProps> = ({ data, onClose }) => <Dialog open={!!data} onOpenChange={(open) => { if (!open) onClose(); }}>
  <DialogContent className="max-h-[90vh] max-w-6xl overflow-y-auto bg-card">
    <DialogHeader><DialogTitle>{data && data.stocks.length > 1 ? '同口径股票比较' : '个股研究证据'}</DialogTitle>
      <DialogDescription>沪深300 · 行情 {data?.snapshot.quoteDate} · 数据版本 {data?.snapshot.id.slice(0, 8)} · 所有解释来自当前筛选快照</DialogDescription></DialogHeader>
    <div className={`grid gap-6 ${data?.stocks.length === 3 ? 'lg:grid-cols-3' : data?.stocks.length === 2 ? 'md:grid-cols-2' : ''}`}>
      {data?.stocks.map((stock: StockFacts) => {
        const result = data.results.find((item) => item.code === stock.code);
        return <section key={stock.code} className="min-w-0 space-y-5 rounded-lg border p-4">
          <div className="flex items-center justify-between gap-3"><div><h3 className="text-xl font-semibold">{stock.name}</h3>
            <p className="mt-1 text-xs text-muted-foreground">{stock.code}</p></div>{result && <VerdictBadge verdict={result.verdict} />}</div>
          <div><p className="text-xs text-muted-foreground">前复权收盘价（元）· 历史走势</p><Prices stock={stock} /></div>
          <div className="space-y-3">
            <h4 className="text-sm font-semibold">为什么得到这个判断</h4>
            {result?.conditions.map((condition) => <div key={condition.conditionId} className="flex items-start gap-2 text-xs leading-5">
              <VerdictBadge verdict={condition.verdict} /><p>{condition.explanation}</p></div>)}
          </div>
          <div><h4 className="mb-2 text-sm font-semibold">指标与来源 · 点击展开复核</h4>
            {METRICS.map((metric) => <Evidence key={metric.id} evidence={stock.metrics[metric.id]} />)}</div>
          {stock.errors.length > 0 && <p className="rounded-lg bg-warning/5 p-3 text-xs leading-5 text-warning">{stock.errors.join('；')}</p>}
        </section>;
      })}
    </div>
    <p className="text-xs text-muted-foreground">筛选只核验已确认条件；跨行业估值、历史波动与未来收益不能直接画等号。</p>
  </DialogContent>
</Dialog>;
export default EvidenceDialog;
