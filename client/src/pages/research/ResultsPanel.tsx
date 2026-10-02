import React, { useMemo, useState } from 'react';
import { Table } from '@lark-apaas/client-toolkit/antd-table';
import type { TableColumnsType } from '@lark-apaas/client-toolkit/antd-table';
import { ArrowRight, Columns3, Search, SearchCheck } from 'lucide-react';
import type { ScreenRun, StockResult, Verdict } from '../../../../shared/api.interface';
import { formatValue, METRIC_MAP } from '../../../../shared/metric-catalog';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Badge } from '../../components/ui/badge';

export const VERDICT_LABEL: Record<Verdict | 'outside', string> = {
  pass: '入选', fail: '排除', unknown: '待核实', outside: '不在股票池',
};
export const VerdictBadge: React.FC<{ verdict: Verdict }> = ({ verdict }) =>
  <Badge variant="outline" className={verdict === 'pass' ? 'border-primary/20 bg-primary/5 text-primary'
    : verdict === 'unknown' ? 'border-warning/25 bg-warning/5 text-warning' : 'text-muted-foreground'}>
    {VERDICT_LABEL[verdict]}</Badge>;

interface ResultsPanelProps {
  run: ScreenRun | null;
  dirty: boolean;
  loading: boolean;
  onDetail: (codes: string[]) => void;
}
const ResultsPanel: React.FC<ResultsPanelProps> = ({ run, dirty, loading, onDetail }) => {
  const [tab, setTab] = useState<Verdict | 'all' | 'near'>('pass');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<React.Key[]>([]);
  const rows = useMemo(() => run?.results.filter((stock: StockResult) =>
    (tab === 'all' || (tab === 'near' ? stock.onlyOneFailure : stock.verdict === tab))
    && `${stock.code}${stock.name}`.toLowerCase().includes(query.toLowerCase())) ?? [], [run, tab, query]);
  const columns: TableColumnsType<StockResult> = [
    { title: '股票', key: 'stock', fixed: 'left', width: 155, sorter: (a, b) => a.code.localeCompare(b.code),
      defaultSortOrder: 'ascend', render: (_value: unknown, stock: StockResult) =>
        <button className="cursor-pointer text-left hover:text-primary focus-visible:outline-primary"
          onClick={() => onDetail([stock.code])}>
          <span className="block font-medium">{stock.name}</span><span className="mt-1 block text-xs text-muted-foreground">{stock.code}</span>
        </button> },
    { title: '判断', key: 'verdict', width: 95, render: (_value: unknown, stock: StockResult) =>
      <VerdictBadge verdict={stock.verdict} /> },
    ...(run?.conditions.filter((item) => item.enabled).map((condition) => ({
      title: METRIC_MAP[condition.metricId].name, key: condition.id, width: 155, align: 'right' as const,
      sorter: (a: StockResult, b: StockResult): number => {
        const av = a.conditions.find((item) => item.conditionId === condition.id)?.evidence.value;
        const bv = b.conditions.find((item) => item.conditionId === condition.id)?.evidence.value;
        if (av === null || av === undefined) return 1;
        if (bv === null || bv === undefined) return -1;
        return av - bv;
      },
      render: (_value: unknown, stock: StockResult) => {
        const result = stock.conditions.find((item) => item.conditionId === condition.id);
        return <span className={`tabular-nums ${result?.verdict === 'fail' ? 'font-medium text-destructive' : ''}`}
          title={result?.explanation}>{formatValue(result?.evidence.value ?? null, result?.evidence.unit ?? '')}</span>;
      },
    })) ?? []),
    { title: '依据', key: 'detail', width: 88, render: (_value: unknown, stock: StockResult) =>
      <Button variant="ghost" size="sm" onClick={() => onDetail([stock.code])}>查看<ArrowRight size={13} /></Button> },
  ];
  return <section className="min-w-0 rounded-xl border bg-card" aria-label="筛选结果">
    <div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4">
      <div><h2 className="font-semibold">筛选结果</h2><p className="mt-1 text-xs text-muted-foreground">
        {run ? `${run.snapshot.universeName} · ${run.coverage.total}只 · 行情 ${run.snapshot.quoteDate}` : '条件确认后，生成逐项可解释的股票名单'}</p></div>
      <Button variant="outline" size="sm" disabled={selected.length < 2 || loading}
        onClick={() => onDetail(selected.map(String))}><Columns3 />
        {selected.length ? `比较 ${selected.length} 只股票` : '选择2—3只比较'}</Button>
    </div>
    {dirty && run && <div className="border-b bg-warning/5 px-5 py-3 text-xs text-warning">
      条件已修改，下方仍是上一次执行结果。重新执行后可比较变化。</div>}
    {run ? <>
      <div data-ai-section-type="card-stat" className="grid grid-cols-3 border-b">
        {(['pass', 'fail', 'unknown'] as const).map((key) => <button key={key} onClick={() => setTab(key)}
          className={`border-r px-4 py-5 text-left last:border-r-0 hover:bg-muted/40 ${tab === key ? 'bg-primary/5' : ''}`}>
          <span className="text-xs text-muted-foreground">{VERDICT_LABEL[key]}</span>
          <strong className="mt-1 block text-3xl font-medium tabular-nums">{run.coverage[key]}</strong>
        </button>)}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
        <div className="flex flex-wrap gap-1">
          {(['pass', 'fail', 'unknown', 'near', 'all'] as const).map((key) =>
            <Button key={key} size="sm" variant={tab === key ? 'secondary' : 'ghost'} onClick={() => setTab(key)}>
              {key === 'all' ? '全部' : key === 'near' ? '只差一条' : VERDICT_LABEL[key]}</Button>)}
        </div>
        <div className="relative w-44"><Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
          <Input value={query} onChange={(event) => setQuery(event.target.value)} aria-label="搜索股票" placeholder="名称 / 代码" className="pl-9" /></div>
      </div>
      <div className="px-3 pb-3 [&_.ant-table]:bg-transparent [&_.ant-table-cell]:!text-[13px]">
        <Table<StockResult> rowKey="code" columns={columns} dataSource={rows} loading={loading}
          scroll={{ x: 'max-content' }} size="middle" tableLayout="fixed"
          rowSelection={{ selectedRowKeys: selected,
            onChange: (keys: React.Key[]) => setSelected(keys.slice(0, 3)),
            getCheckboxProps: (record: StockResult) => ({
              disabled: selected.length >= 3 && !selected.includes(record.code),
              'aria-label': `选择${record.name}比较`,
            }) }}
          pagination={{ pageSize: 15, showSizeChanger: false, showTotal: (total: number) => `共 ${total} 只` }}
          locale={{ emptyText: <div className="py-9 text-sm">当前条件下没有{tab === 'pass' ? '入选' : ''}股票。
            {tab === 'pass' && <p className="mt-2 text-xs">查看排除依据或“只差一条”，再按研究目的调整条件。</p>}</div> }} />
      </div>
      <p className="border-t px-5 py-3 text-xs leading-5 text-muted-foreground">
        {run.coverage.complete}/{run.coverage.total}只的全部启用指标可判定 · “—”表示缺失或不适用 · 数值不是推荐排序分数
      </p>
    </> : <div className="flex min-h-96 flex-col items-center justify-center px-6 py-12 text-center">
      <div className="mb-5 rounded-2xl bg-muted p-5"><SearchCheck className="size-9 text-primary" strokeWidth={1.4} /></div>
      <h3 className="text-lg font-medium">先把想法变成条件</h3>
      <p className="mt-3 max-w-sm text-sm leading-6 text-muted-foreground">
        描述你关注的增长、估值或历史波动。确认条件后，每只股票都会显示入选、排除或待核实的依据。</p>
      <div className="mt-8 flex flex-wrap justify-center gap-5 text-xs text-muted-foreground">
        <span>01 描述想法</span><span>02 确认条件</span><span>03 查看证据</span>
      </div>
    </div>}
  </section>;
};
export default ResultsPanel;
