import React from 'react';
import ReactEChartsCore from 'echarts-for-react/lib/core';
import * as echarts from 'echarts/core';
import { LineChart } from 'echarts/charts';
import { AriaComponent, GridComponent, TooltipComponent } from 'echarts/components';
import { SVGRenderer } from 'echarts/renderers';
import type { EChartsOption } from 'echarts';
import type { MetricEvidence, MetricId, StockCompareResponse, StockFacts } from '../../../../shared/api.interface';
import { formatValue, METRICS, METRIC_MAP } from '../../../../shared/metric-catalog';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../../components/ui/dialog';
import VerdictBadge from './VerdictBadge';
import { displayTime } from './research-format';

echarts.use([LineChart, GridComponent, TooltipComponent, AriaComponent, SVGRenderer]);
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
const Evidence: React.FC<{ evidence: MetricEvidence }> = ({ evidence }) => {
  const metric = METRIC_MAP[evidence.metricId];
  return <details className="border-t py-3 text-xs leading-5">
  <summary className="flex min-h-11 cursor-pointer items-center justify-between gap-3">
    <span>{metric.name}</span>
    <span className="font-medium tabular-nums">{formatValue(evidence.value, evidence.unit)}</span>
  </summary>
  <div className="mt-3 space-y-2 rounded-lg bg-muted/60 p-3 text-muted-foreground">
    <p className="text-foreground">{metric.summary}</p>
    {evidence.reason && <p className="font-medium">{evidence.reason}</p>}
    <p><span className="font-medium text-foreground">数据口径：</span>{metric.basis}</p>
    <p><span className="font-medium text-foreground">计算方式：</span>{metric.description}</p>
    <details className="border-t pt-2">
      <summary className="min-h-11 cursor-pointer py-3 text-foreground">查看原始数据与来源</summary>
      <dl className="mt-2 grid grid-cols-[72px_1fr] gap-x-2 gap-y-1 break-words">
        <dt>报告期</dt><dd>{evidence.reportPeriod ?? '未提供 / 不适用'}</dd>
        <dt>披露日</dt><dd>{evidence.disclosureDate ?? '未提供 / 不适用'}</dd>
        <dt>行情日</dt><dd>{evidence.quoteDate ?? '未提供 / 不适用'}</dd>
        <dt>获取时间</dt><dd>{displayTime(evidence.fetchedAt)}</dd>
        <dt>时间标记</dt><dd>{{ per_report: '逐份报告', per_bar: '逐日行情', response_max_only: '仅响应中最大时间，非个股时间', unknown: '未知' }[evidence.timestampScope]}</dd>
        <dt>来源时间</dt><dd>{evidence.sourceTimestamp ?? '未提供'}</dd>
        <dt>数据接口</dt><dd className="break-all">{evidence.sourceEndpoint || '未取得有效响应'}</dd>
        <dt>请求 ID</dt><dd className="break-all">{evidence.requestId ?? '未提供'}</dd>
        <dt>公式版本</dt><dd>{evidence.formulaVersion}</dd>
      </dl>
      <div className="mt-3 border-t pt-2">
        <p className="mb-2 font-medium text-foreground">原始计算输入</p>
        {evidence.inputs.length ? evidence.inputs.map((input, index) => <div key={index} className="mb-2 break-all">
          <code>{input.rawField}</code> = {input.rawValue === null ? 'null' : String(input.rawValue)}
          <p>报告期 {input.reportPeriod ?? '—'} · 披露日 {input.disclosureDate ?? '—'} · 行情日 {input.quoteDate ?? '—'}</p>
        </div>) : <p>无可用输入，无法复算。</p>}
      </div>
    </details>
  </div>
</details>;
};

interface EvidenceDialogProps { data: StockCompareResponse | null; onClose: () => void }
const EvidenceDialog: React.FC<EvidenceDialogProps> = ({ data, onClose }) => <Dialog open={!!data} onOpenChange={(open) => { if (!open) onClose(); }}>
  <DialogContent className="max-h-[90vh] max-w-6xl overflow-y-auto bg-card">
    <DialogHeader><DialogTitle>{data && data.stocks.length > 1 ? '股票对比' : '筛选原因'}</DialogTitle>
      <DialogDescription>沪深300 · 行情 {data?.snapshot.quoteDate} · 以下判断均来自本次筛选使用的数据</DialogDescription></DialogHeader>
    <div className={`grid gap-6 ${data?.stocks.length === 3 ? 'lg:grid-cols-3' : data?.stocks.length === 2 ? 'md:grid-cols-2' : ''}`}>
      {data?.stocks.map((stock: StockFacts) => {
        const result = data.results.find((item) => item.code === stock.code);
        const usedMetricIds = [...new Set(result?.conditions.map((condition) => condition.evidence.metricId) ?? [])];
        const otherMetrics = METRICS.filter((metric) => !usedMetricIds.includes(metric.id));
        return <section key={stock.code} className="min-w-0 space-y-5 rounded-lg border p-4">
          <div className="flex items-center justify-between gap-3"><div><h3 className="text-xl font-semibold">{stock.name}</h3>
            <p className="mt-1 text-xs text-muted-foreground">{stock.code}</p></div>{result && <VerdictBadge verdict={result.verdict} />}</div>
          <div><p className="text-xs text-muted-foreground">前复权收盘价（元）· 历史走势</p><Prices stock={stock} /></div>
          <div className="space-y-3">
            <h4 className="text-sm font-semibold">判断原因</h4>
            {result?.conditions.map((condition) => <div key={condition.conditionId} className="flex items-start gap-2 text-xs leading-5">
              <VerdictBadge verdict={condition.verdict} /><p>{condition.explanation}</p></div>)}
          </div>
          <div><h4 className="mb-2 text-sm font-semibold">本次使用的指标</h4>
            {usedMetricIds.map((metricId: MetricId) => <Evidence key={metricId} evidence={stock.metrics[metricId]} />)}
            {!!otherMetrics.length && <details className="border-t py-3 text-xs text-muted-foreground">
              <summary className="min-h-11 cursor-pointer py-3">查看其他 {otherMetrics.length} 项指标</summary>
              <div className="mt-2">{otherMetrics.map((metric) =>
                <Evidence key={metric.id} evidence={stock.metrics[metric.id]} />)}</div>
            </details>}
          </div>
          {stock.errors.length > 0 && <p className="rounded-lg bg-warning/5 p-3 text-xs leading-5 text-warning">{stock.errors.join('；')}</p>}
        </section>;
      })}
    </div>
    <p className="text-xs text-muted-foreground">估值需结合行业理解，历史波动也不能直接代表未来风险。</p>
  </DialogContent>
</Dialog>;
export default EvidenceDialog;
