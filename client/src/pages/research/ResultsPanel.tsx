import React, { useEffect, useMemo, useState } from 'react';
import { Table } from '@lark-apaas/client-toolkit/antd-table';
import type { TableColumnsType } from '@lark-apaas/client-toolkit/antd-table';
import { ArrowRight, Columns3, Download, Search, SearchCheck } from 'lucide-react';
import type { ScreenRun, StockResult, Verdict } from '../../../../shared/api.interface';
import { formatValue, METRIC_MAP } from '../../../../shared/metric-catalog';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Checkbox } from '../../components/ui/checkbox';
import VerdictBadge from './VerdictBadge';
import { VERDICT_LABEL } from './research-format';
import { buildResultsCsv } from './research-io';

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
  const [page, setPage] = useState(1);
  const rows = useMemo(() => run?.results.filter((stock: StockResult) =>
    (tab === 'all' || (tab === 'near' ? stock.onlyOneFailure : stock.verdict === tab))
    && `${stock.code}${stock.name}`.toLowerCase().includes(query.toLowerCase())) ?? [], [run, tab, query]);
  useEffect(() => { setPage(1); }, [run?.id, query, tab]);
  useEffect(() => { setSelected([]); }, [run?.id, tab]);
  const mobilePageSize = 10;
  const mobilePages = Math.max(1, Math.ceil(rows.length / mobilePageSize));
  const mobileRows = rows.slice((page - 1) * mobilePageSize, page * mobilePageSize);
  const enabledConditions = run?.conditions.filter((condition) => condition.enabled) ?? [];
  const tabItems: { key: Verdict | 'all' | 'near'; label: string; count: number }[] = run ? [
    { key: 'pass', label: '入选', count: run.coverage.pass },
    { key: 'fail', label: '排除', count: run.coverage.fail },
    { key: 'unknown', label: '待核实', count: run.coverage.unknown },
    { key: 'near', label: '只差一条', count: run.results.filter((stock) => stock.onlyOneFailure).length },
    { key: 'all', label: '全部', count: run.coverage.total },
  ] : [];
  const toggleSelected = (code: string, checked: boolean): void => {
    setSelected((current) => checked
      ? (current.includes(code) || current.length >= 3 ? current : [...current, code])
      : current.filter((key) => key !== code));
  };
  const exportCsv = (): void => {
    if (!run || !rows.length) return;
    const blob = new Blob([buildResultsCsv(run, rows)], { type: 'text/csv;charset=utf-8' });
    const href = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = href;
    anchor.download = `知衡_${tabItems.find((item) => item.key === tab)?.label ?? '结果'}_${run.snapshot.quoteDate}.csv`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(href), 0);
  };
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
    { title: '原因', key: 'detail', width: 104, render: (_value: unknown, stock: StockResult) =>
      <Button variant="ghost" size="sm" onClick={() => onDetail([stock.code])}>查看原因<ArrowRight size={13} /></Button> },
  ];
  return <section className="min-w-0 rounded-xl border bg-card" aria-label="筛选结果">
    <div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4">
      <div><h2 className="font-semibold">筛选结果</h2><p className="mt-1 text-xs text-muted-foreground">
        {run ? `${run.snapshot.universeName} · ${run.coverage.total}只 · 行情 ${run.snapshot.quoteDate}` : '筛选后可逐只查看入选、排除或待核实原因'}</p></div>
      <div className="flex flex-wrap gap-2">
        {run && <Button variant="outline" size="sm" disabled={!rows.length || loading}
          aria-label={`导出当前${rows.length}条结果为CSV`} onClick={exportCsv}><Download />导出</Button>}
        <Button variant="outline" size="sm" disabled={selected.length < 2 || loading}
          onClick={() => onDetail(selected.map(String))}><Columns3 />
          {selected.length ? `比较 ${selected.length} 只` : '比较2—3只'}</Button>
      </div>
    </div>
    {dirty && run && <div className="border-b bg-warning/5 px-5 py-3 text-xs text-warning">
      条件已修改，当前仍显示上次结果。重新筛选后可查看变化。</div>}
    {run ? <>
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
        <div role="tablist" aria-label="结果分类" className="flex flex-wrap gap-1">
          {tabItems.map((item) =>
            <Button key={item.key} role="tab" aria-selected={tab === item.key} size="sm"
              variant={tab === item.key ? 'secondary' : 'ghost'} onClick={() => setTab(item.key)}>
              {item.label}<span className="tabular-nums text-muted-foreground">{item.count}</span>
            </Button>)}
        </div>
        <div className="relative w-44"><Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
          <Input value={query} onChange={(event) => setQuery(event.target.value)} aria-label="搜索股票" placeholder="名称 / 代码" className="pl-9" /></div>
      </div>
      <div className="space-y-3 px-3 pb-3 md:hidden">
        {mobileRows.map((stock) => <article key={stock.code} className="rounded-lg border bg-background p-4">
          <div className="flex items-start justify-between gap-3">
            <button className="min-h-11 text-left focus-visible:outline-primary"
              onClick={() => onDetail([stock.code])}>
              <span className="block font-medium">{stock.name}</span>
              <span className="mt-1 block text-xs text-muted-foreground">{stock.code}</span>
            </button>
            <VerdictBadge verdict={stock.verdict} />
          </div>
          <dl className="mt-3 grid grid-cols-2 gap-3">
            {enabledConditions.slice(0, 2).map((condition) => {
              const result = stock.conditions.find((item) => item.conditionId === condition.id);
              return <div key={condition.id} className="min-w-0">
                <dt className="truncate text-[11px] text-muted-foreground">{METRIC_MAP[condition.metricId].name}</dt>
                <dd className={`mt-1 text-sm tabular-nums ${result?.verdict === 'fail' ? 'font-medium text-destructive' : ''}`}>
                  {formatValue(result?.evidence.value ?? null, result?.evidence.unit ?? '')}
                </dd>
              </div>;
            })}
          </dl>
          {enabledConditions.length > 2 && <p className="mt-2 text-xs text-muted-foreground">另有{enabledConditions.length - 2}项条件，打开详情查看</p>}
          <div className="mt-3 flex items-center justify-between gap-3 border-t pt-3">
            <label className="flex min-h-11 items-center gap-2 text-xs">
              <Checkbox checked={selected.includes(stock.code)}
                disabled={selected.length >= 3 && !selected.includes(stock.code)}
                onCheckedChange={(checked) => toggleSelected(stock.code, checked === true)}
                aria-label={`选择${stock.name}比较`} />
              加入比较
            </label>
            <Button variant="ghost" size="sm" onClick={() => onDetail([stock.code])}>查看原因<ArrowRight /></Button>
          </div>
        </article>)}
        {!mobileRows.length && <div className="py-10 text-center text-sm text-muted-foreground">当前分类没有匹配股票。</div>}
        {rows.length > mobilePageSize && <div className="flex items-center justify-between gap-3">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}
            aria-label="上一页结果">上一页</Button>
          <span className="text-xs text-muted-foreground">第{page}/{mobilePages}页 · 共{rows.length}只</span>
          <Button variant="outline" size="sm" disabled={page >= mobilePages} onClick={() => setPage((value) => value + 1)}
            aria-label="下一页结果">下一页</Button>
        </div>}
      </div>
      <div className="hidden px-3 pb-3 md:block [&_.ant-checkbox-wrapper]:inline-flex [&_.ant-checkbox-wrapper]:min-h-11 [&_.ant-checkbox-wrapper]:min-w-11 [&_.ant-checkbox-wrapper]:items-center [&_.ant-checkbox-wrapper]:justify-center [&_.ant-table]:bg-transparent [&_.ant-table-cell]:!text-[13px]">
        <Table<StockResult> rowKey="code" columns={columns} dataSource={rows} loading={loading}
          scroll={{ x: 'max-content' }} size="middle" tableLayout="fixed"
          rowSelection={{ selectedRowKeys: selected, columnWidth: 48,
            onChange: (keys: React.Key[]) => setSelected(keys.slice(0, 3)),
            getCheckboxProps: (record: StockResult) => ({
              disabled: selected.length >= 3 && !selected.includes(record.code),
              'aria-label': `选择${record.name}比较`,
            }) }}
          pagination={{ pageSize: 15, showSizeChanger: false, showTotal: (total: number) => `共 ${total} 只` }}
          locale={{ emptyText: <div className="py-9 text-sm">当前条件下没有{tab === 'pass' ? '入选' : ''}股票。
            {tab === 'pass' && <p className="mt-2 text-xs">查看排除原因或“只差一条”，再按研究目的调整条件。</p>}</div> }} />
      </div>
      <div className="border-t px-5 py-3 text-xs leading-5 text-muted-foreground">
        <p>{run.coverage.complete}/{run.coverage.total}只的全部启用指标可判定 · “—”表示缺失或不适用 · 数值不是推荐排序分数</p>
        <details className="mt-1"><summary className="min-h-11 cursor-pointer py-3">结果分类说明</summary>
          <p className="mt-1">入选：全部条件满足；排除：至少一条不满足；待核实：没有已知不满足，但存在缺失数据；只差一条：仅一条条件不满足。</p>
        </details>
      </div>
    </> : <div className="flex min-h-96 flex-col items-center justify-center px-6 py-12 text-center">
      <div className="mb-5 rounded-2xl bg-muted p-5"><SearchCheck className="size-9 text-primary" strokeWidth={1.4} /></div>
      <h3 className="text-lg font-medium">从一个想法开始</h3>
      <p className="mt-3 max-w-sm text-sm leading-6 text-muted-foreground">
        描述你关注的增长、估值或价格表现，生成条件后即可筛选并查看原因。</p>
      <div className="mt-8 flex flex-wrap justify-center gap-5 text-xs text-muted-foreground">
        <span>01 生成条件</span><span>02 筛选股票</span><span>03 查看原因</span>
      </div>
    </div>}
  </section>;
};
export default ResultsPanel;
