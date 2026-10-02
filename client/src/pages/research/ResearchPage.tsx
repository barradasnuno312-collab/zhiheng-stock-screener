import React, { useEffect, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import {
  ArrowDownToLine, ArrowRight, BookOpen, Check, Compass, Database, Layers3,
  LoaderCircle, LockKeyhole, RefreshCw, Search, ShieldCheck, Sparkles,
} from 'lucide-react';
import type {
  CatalogResponse, Condition, IntentDraft, JobStatus, Monitor, RunComparison,
  SavedVersion, ScreenRun, SnapshotSummary, StockCompareResponse,
} from '../../../../shared/api.interface';
import { METRIC_MAP, OPERATOR_LABELS } from '../../../../shared/metric-catalog';
import { conditionsSchema, detectConflicts, sameConditions } from '../../../../shared/validation';
import { research as api } from '../../api';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Textarea } from '../../components/ui/textarea';
import { Checkbox } from '../../components/ui/checkbox';
import { Badge } from '../../components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../../components/ui/dialog';
import ConditionEditor from './ConditionEditor';
import ResultsPanel, { VERDICT_LABEL } from './ResultsPanel';
import EvidenceDialog from './EvidenceDialog';
import StrategyLibrary from './StrategyLibrary';

const EXAMPLES: string[] = [
  '经营改善、估值不要太贵、最近走势相对稳定的公司',
  '市盈率小于30倍，营收同比大于10%',
  '近60日最大回撤小于15%，日均成交额超过1亿元',
];
function label(condition: Condition): string {
  return `${METRIC_MAP[condition.metricId].name} ${OPERATOR_LABELS[condition.operator]} ${condition.value}${
    condition.operator === 'between' ? `～${condition.upperValue}` : ''}${condition.unit}${condition.enabled ? '' : '（停用）'}`;
}
const ResearchPage: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const isLibrary: boolean = location.pathname.endsWith('/strategies');
  const loginForm = useForm<{ code: string }>({ defaultValues: { code: '' } });
  const [authorized, setAuthorized] = useState<boolean | null>(null);
  const [catalog, setCatalog] = useState<CatalogResponse | null>(null);
  const [snapshot, setSnapshot] = useState<SnapshotSummary | null>(null);
  const [versions, setVersions] = useState<SavedVersion[]>([]);
  const [monitors, setMonitors] = useState<Monitor[]>([]);
  const [text, setText] = useState('');
  const [conditions, setConditions] = useState<Condition[]>([]);
  const [draft, setDraft] = useState<IntentDraft | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [job, setJob] = useState<JobStatus | null>(null);
  const [run, setRun] = useState<ScreenRun | null>(null);
  const [comparison, setComparison] = useState<RunComparison | null>(null);
  const [beforeRun, setBeforeRun] = useState<ScreenRun | null>(null);
  const [compareOpen, setCompareOpen] = useState(false);
  const [evidence, setEvidence] = useState<StockCompareResponse | null>(null);
  const [activeVersion, setActiveVersion] = useState<SavedVersion | null>(null);
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [aboutOpen, setAboutOpen] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const parsing: boolean = !!job && ['pending', 'running'].includes(job.status);
  const dirty: boolean = !!run && !sameConditions(conditions, run.conditions);
  const executable: boolean = !!snapshot && confirmed && conditions.some((item) => item.enabled)
    && conditionsSchema.safeParse(conditions).success && !detectConflicts(conditions).length && !busy && !parsing;

  async function loadResources(): Promise<void> {
    const data = await api.catalog();
    setCatalog(data);
    setSnapshot((previous) => previous ?? data.snapshot);
    setVersions(await api.versions());
    setMonitors(await api.monitors());
  }
  async function perform(name: string, action: () => Promise<void>): Promise<void> {
    setBusy(name); setError(''); setNotice('');
    try { await action(); } catch (failure: unknown) { setError(api.errorMessage(failure)); }
    finally { setBusy(''); }
  }
  useEffect(() => {
    let mounted = true;
    void (async () => {
      try {
        const session = await api.session();
        if (!mounted) return;
        setAuthorized(session.authorized);
        if (!session.authorized) return;
        await loadResources();
        const previousId: string | null = sessionStorage.getItem('zh-last-run');
        if (previousId) {
          const previous = await api.run(previousId);
          if (!mounted) return;
          setRun(previous); setConditions(previous.conditions); setSnapshot(previous.snapshot);
          setText(previous.intent); setConfirmed(true);
        }
        const jobId: string | null = sessionStorage.getItem('zh-intent-job');
        if (jobId && mounted) {
          const restored: JobStatus = await api.job(jobId);
          if (!mounted) return;
          setJob(restored);
          if (restored.status === 'succeeded' && restored.result && 'conditions' in restored.result) {
            setDraft(restored.result); setConditions(restored.result.conditions); setConfirmed(false);
            sessionStorage.removeItem('zh-intent-job');
          } else if (restored.status === 'failed') {
            setError(restored.message); sessionStorage.removeItem('zh-intent-job');
          }
        }
      } catch (failure: unknown) { if (mounted) setError(api.errorMessage(failure)); }
    })();
    return () => { mounted = false; };
  }, []);
  useEffect(() => {
    if (!job || !parsing) return;
    let mounted = true;
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const next: JobStatus = await api.job(job.id);
          if (!mounted) return;
          if (next.status === 'succeeded' && next.result && 'conditions' in next.result) {
            setDraft(next.result); setConditions(next.result.conditions); setConfirmed(false);
            sessionStorage.removeItem('zh-intent-job');
          } else if (next.status === 'failed') {
            setError(next.message); sessionStorage.removeItem('zh-intent-job');
          } else if (Date.now() - new Date(next.createdAt).getTime() > 90000) {
            setError('解析仍在等待处理。你可以手动编辑条件，稍后刷新页面恢复任务。');
            setJob(null); return;
          }
          setJob(next);
        } catch (failure: unknown) { if (mounted) { setError(api.errorMessage(failure)); setJob(null); } }
      })();
    }, 1200);
    return () => { mounted = false; clearTimeout(timer); };
  }, [job, parsing]);

  const edit = (next: Condition[]): void => { setConditions(next); setConfirmed(false); };
  const doParse = (): void => { void perform('理解想法', async () => {
    const next: JobStatus = await api.parse({ text, previousConditions: conditions });
    setJob(next); sessionStorage.setItem('zh-intent-job', next.id);
  }); };
  const execute = (): void => { if (!snapshot) return; void perform('执行筛选', async () => {
    const next: ScreenRun = await api.execute({ conditions, snapshotId: snapshot.id,
      universeVersion: snapshot.universeVersion, intent: text, confirmed });
    setBeforeRun(run);
    setComparison(run && run.snapshot.id === next.snapshot.id
      ? await api.compare({ beforeRunId: run.id, afterRunId: next.id }) : null);
    setRun(next); sessionStorage.setItem('zh-last-run', next.id);
    setNotice('筛选完成。可点击股票名称核查每条依据。');
  }); };
  const loadVersion = (id: string): void => { void perform('恢复策略', async () => {
    const data = await api.load(id);
    setRun(data.run); setConditions(data.version.conditions); setSnapshot(data.version.snapshot);
    setActiveVersion(data.version); setText(data.version.intent); setConfirmed(true);
    setDraft(null); setComparison(null); sessionStorage.setItem('zh-last-run', data.run.id);
    setNotice(`已恢复“${data.version.name}”v${data.version.version}及当时的数据版本`);
    navigate('/');
  }); };
  const save = (asNew: boolean): void => { if (!run) return; void perform('保存策略', async () => {
    const version = await api.save({ name: saveName, runId: run.id,
      strategyId: !asNew && activeVersion ? activeVersion.strategyId : undefined });
    setActiveVersion(version); setVersions(await api.versions()); setSaveOpen(false);
    setNotice(`已保存“${version.name}”v${version.version}，可到策略库开启监控。`);
  }); };

  if (authorized !== true) return <main className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
    <section className="flex flex-col justify-between bg-sidebar p-8 text-sidebar-foreground sm:p-14 lg:p-20">
      <div className="flex items-center gap-3"><Compass size={30} strokeWidth={1.5} /><strong className="text-2xl tracking-widest">知衡</strong><span className="ml-2 border-l border-current/20 pl-4 text-xs tracking-widest opacity-65">ZHIHENG</span></div>
      <div className="py-14"><p className="text-xs tracking-[0.25em] opacity-60">INVESTMENT RESEARCH, EXPLAINED.</p>
        <h1 className="mt-7 text-4xl leading-snug font-medium lg:text-5xl">每一个选股想法，<br />都应该有据可查。</h1>
        <p className="mt-6 max-w-md text-sm leading-7 opacity-65">用自然语言表达研究方向。把模糊偏好变成可编辑条件，让筛选、解释与持续跟踪连成一次完整研究。</p>
        <div className="mt-10 flex flex-wrap gap-5 text-xs opacity-75"><span className="flex gap-2"><Check size={14} />条件可控</span><span className="flex gap-2"><Check size={14} />证据可查</span><span className="flex gap-2"><Check size={14} />版本可追溯</span></div>
      </div><p className="text-xs opacity-45">沪深300 · 财务、估值与历史价格研究</p>
    </section>
    <section className="flex items-center justify-center bg-background px-8 py-16">
      <div className="w-full max-w-sm"><LockKeyhole className="mb-6 size-7 text-primary" strokeWidth={1.5} />
        <p className="text-xs tracking-widest text-muted-foreground">REVIEW ACCESS</p><h2 className="mt-3 text-2xl font-semibold">进入研究工作台</h2>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">输入作品访问码，开始一次独立的研究会话。</p>
        <form className="mt-8 space-y-4" onSubmit={loginForm.handleSubmit(({ code }) => perform('验证访问码', async () => {
          await api.login(code); loginForm.reset(); setAuthorized(true); await loadResources();
        }))}>
          <label htmlFor="access-code" className="text-sm font-medium">访问码</label>
          <Input id="access-code" type="password" autoComplete="current-password" placeholder="请输入访问码"
            {...loginForm.register('code', { required: true, maxLength: 128 })} />
          <Button className="w-full" size="lg" type="submit" disabled={!!busy || authorized === null}>
            {busy || authorized === null ? <LoaderCircle className="animate-spin" /> : <>开始研究<ArrowRight /></>}</Button>
        </form>
        {error && <div role="alert" className="mt-4 text-sm text-destructive">{error}
          {authorized === null && <Button variant="ghost" size="sm" onClick={() => { setAuthorized(false); setError(''); }}>重试</Button>}</div>}
        <p className="mt-8 flex items-start gap-2 text-xs leading-5 text-muted-foreground"><ShieldCheck className="mt-0.5 size-4 shrink-0" />策略仅属于当前浏览器会话。作品用于研究条件核验，不提供买卖建议。</p>
      </div>
    </section>
  </main>;

  return <div className="min-h-screen bg-background text-foreground">
    <aside className="fixed inset-y-0 left-0 z-20 hidden w-20 flex-col items-center gap-8 border-r bg-sidebar py-7 text-sidebar-foreground md:flex">
      <NavLink to="/" aria-label="知衡首页"><Compass className="size-8" strokeWidth={1.6} /></NavLink>
      <nav className="flex flex-col gap-4">
        <NavLink to="/" end className={({ isActive }) => `rounded-xl p-3 ${isActive ? 'bg-white/15' : 'opacity-50 hover:opacity-100'}`} aria-label="选股工作台"><Search size={21} /></NavLink>
        <NavLink to="/strategies" className={({ isActive }) => `rounded-xl p-3 ${isActive ? 'bg-white/15' : 'opacity-50 hover:opacity-100'}`} aria-label="策略与监控"><Layers3 size={21} /></NavLink>
      </nav>
      <Button className="mt-auto text-sidebar-foreground opacity-60" size="icon" variant="ghost" aria-label="方法与边界" onClick={() => setAboutOpen(true)}><BookOpen /></Button>
    </aside>
    <div className="md:ml-20">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b bg-card px-5 py-4 lg:px-10">
        <div className="flex items-center gap-5"><NavLink to="/" className="text-xl font-semibold tracking-[0.2em]">知衡</NavLink>
          <span className="hidden border-l pl-5 text-xs text-muted-foreground sm:block">自然语言选股与策略解释器</span></div>
        <nav className="flex items-center gap-4 text-sm"><NavLink to="/" end className={({ isActive }) => isActive ? 'font-medium text-primary' : 'text-muted-foreground'}>工作台</NavLink>
          <NavLink to="/strategies" className={({ isActive }) => isActive ? 'font-medium text-primary' : 'text-muted-foreground'}>策略与监控</NavLink>
          <Button variant="ghost" size="icon" aria-label="数据与方法" onClick={() => setAboutOpen(true)}><BookOpen /></Button></nav>
      </header>
      <main className="mx-auto max-w-[1600px] space-y-6 p-5 lg:p-10">
        {error && <div role="alert" className="rounded-lg border border-destructive/20 bg-destructive/5 p-4 text-sm text-destructive">{error}</div>}
        {notice && <div role="status" className="rounded-lg border border-primary/15 bg-primary/5 p-4 text-sm text-primary">{notice}</div>}
        {isLibrary ? <StrategyLibrary versions={versions} monitors={monitors} scheduleEnabled={catalog?.scheduleEnabled ?? false}
          busy={!!busy} onLoad={loadVersion}
          onMonitor={(id) => { void perform('创建监控', async () => { await api.createMonitor(id); setMonitors(await api.monitors()); setNotice('已保存监控设置。'); }); }}
          onCheck={(id) => { void perform('检查条件', async () => { const event = await api.check(id); setMonitors(await api.monitors()); setNotice(event?.message ?? '检查完成'); }); }}
          onToggle={(id, enabled) => { void perform('修改监控', async () => { await api.toggle(id, enabled); setMonitors(await api.monitors()); }); }} />
          : <>
            <section className="grid gap-6 lg:grid-cols-[0.85fr_1.4fr] lg:gap-12">
              <div className="py-3"><p className="text-xs font-medium tracking-[0.2em] text-primary">RESEARCH WORKSPACE</p>
                <h1 className="mt-4 text-3xl leading-tight font-semibold tracking-tight lg:text-4xl">从一个想法，<br className="hidden lg:block" />到一组有据的条件。</h1>
                <p className="mt-4 text-sm leading-7 text-muted-foreground">你决定研究方向，知衡把条件和证据摆在面前。</p>
                <div className="mt-5 flex flex-wrap gap-2"><Badge variant="outline">沪深300</Badge><Badge variant="outline">8项可核查指标</Badge><Badge variant="outline">全部条件同时满足</Badge></div>
              </div>
              <div className="rounded-xl border bg-card p-5 shadow-sm">
                <label htmlFor="research-intent" className="flex items-center gap-2 text-sm font-medium"><Sparkles className="size-4 text-primary" />你想寻找什么样的公司？</label>
                <Textarea id="research-intent" value={text} maxLength={2000}
                  onChange={(event) => setText(event.target.value)} disabled={parsing}
                  placeholder="例如：经营改善，估值不要太贵，最近走势相对稳定。" className="mt-3 min-h-24 resize-none border-0 bg-muted/45 text-sm shadow-none" />
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3"><span className="text-xs text-muted-foreground">支持中文描述、明确阈值和增量修改</span>
                  <Button disabled={!!busy || parsing || text.trim().length < 2 || !catalog?.aiConfigured} onClick={doParse}>
                    {parsing ? <><LoaderCircle className="animate-spin" />正在理解</> : <><Sparkles />生成条件草稿</>}</Button></div>
                <div className="mt-4 flex flex-wrap gap-2 border-t pt-3">{EXAMPLES.map((example, index) =>
                  <button key={example} disabled={parsing} className="rounded-full bg-muted px-3 py-1.5 text-[11px] text-muted-foreground hover:text-primary"
                    onClick={() => setText(example)}>{['经营改善 × 稳定', '成长与估值', '回撤与流动性'][index]}</button>)}</div>
              </div>
            </section>
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card px-4 py-3 text-xs">
              <div className="flex flex-wrap items-center gap-x-5 gap-y-2"><span className="flex items-center gap-2"><Database size={14} className="text-primary" />数据状态</span>
                <span>{snapshot ? `行情 ${snapshot.quoteDate}${snapshot.marketClosed ? ' · 休市' : ''}` : '行情尚未就绪'}</span>
                <span className="text-muted-foreground">{snapshot ? `${snapshot.completedCount}/${snapshot.memberCount}只已处理 · ${snapshot.errorCount}只取数异常 · 版本 ${snapshot.id.slice(0, 8)}` : '接入真实数据后才能执行筛选；条件仍可编辑'}</span></div>
              <Button variant="ghost" size="sm" disabled={!!busy} onClick={() => { void perform('检查数据状态', async () => {
                const data = await api.catalog(); setCatalog(data);
                if (!snapshot) setSnapshot(data.snapshot);
                setNotice(data.snapshot ? '已核对数据状态。' : '当前尚无可用数据版本。');
              }); }}><RefreshCw />检查状态</Button>
            </div>
            {catalog?.snapshot && snapshot?.id !== catalog.snapshot.id && <Button variant="outline" size="sm"
              onClick={() => { setSnapshot(catalog.snapshot); setConfirmed(false); setNotice('已选择最新数据；再次执行会形成新数据版本的结果。'); }}>使用最新数据版本</Button>}
            {draft && <div className="rounded-xl border bg-card p-5">
              <div className="flex items-center gap-2 text-sm font-semibold"><Check className="size-4 text-primary" />我的理解：{draft.intentSummary}</div>
              {draft.clarifications.length > 0 && <div className="mt-3 space-y-2 text-sm">{draft.clarifications.map((item, index) =>
                <p key={item} className="leading-6"><span className="mr-2 text-primary">待确认 {index + 1}</span>{item}</p>)}
                <p className="text-xs text-muted-foreground">直接编辑下面的条件阈值，或在输入框补充回答后重新生成。</p></div>}
              {draft.unsupportedRequests.length > 0 && <p className="mt-3 text-sm leading-6 text-warning">暂不支持：{draft.unsupportedRequests.join('；')}。确认后只执行下方列出的条件。</p>}
              {draft.warnings.length > 0 && <p className="mt-3 text-xs leading-5 text-muted-foreground">{draft.warnings.join('；')}</p>}
            </div>}
            <div className="grid items-start gap-6 xl:grid-cols-[320px_minmax(0,1fr)]">
              <div className="space-y-4"><ConditionEditor conditions={conditions} onChange={edit} disabled={!!busy || parsing} />
                <div className="rounded-xl border bg-card p-5"><label className="flex cursor-pointer items-start gap-3 text-xs leading-6">
                  <Checkbox checked={confirmed} onCheckedChange={(value) => setConfirmed(value === true)} className="mt-1" />
                  <span>已核对指标、口径及阈值{draft?.unsupportedRequests.length ? '，同意暂不使用上述未支持条件' : ''}。</span></label>
                  <Button className="mt-4 w-full" disabled={!executable} onClick={execute}>
                    {busy === '执行筛选' ? <LoaderCircle className="animate-spin" /> : <Search />}确认并执行筛选</Button>
                  {!snapshot && <p className="mt-3 text-xs leading-5 text-muted-foreground">数据尚未就绪，可先生成并编辑条件。</p>}
                </div>
                {snapshot?.warnings.map((warning) => <p key={warning} className="px-1 text-xs leading-5 text-muted-foreground">{warning}</p>)}
              </div>
              <div className="min-w-0 space-y-4"><ResultsPanel key={run?.id ?? 'empty'} run={run} dirty={dirty}
                loading={busy === '执行筛选'} onDetail={(codes) => { if (run) void perform('读取证据', async () => setEvidence(await api.stocks(run.id, codes))); }} />
                {run && <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-4">
                  <div className="text-xs text-muted-foreground">{activeVersion ? `当前策略：${activeVersion.name} · v${activeVersion.version}` : '将本次结果保存为可恢复的研究版本'}</div>
                  <div className="flex flex-wrap gap-2">{comparison && <Button variant="outline" disabled={!!busy} onClick={() => setCompareOpen(true)}><Layers3 />条件影响比较</Button>}
                    <Button disabled={!!busy || dirty} onClick={() => { setSaveName(activeVersion?.name ?? (draft?.intentSummary || '我的研究策略').slice(0, 40)); setSaveOpen(true); }}><ArrowDownToLine />保存策略</Button></div>
                </div>}
                <p className="px-1 text-xs leading-6 text-muted-foreground">低估值不等于低估，历史稳定不代表未来低风险。结果用于条件核验，不构成买卖建议。</p>
              </div>
            </div>
          </>}
      </main>
      <footer className="mx-5 flex flex-wrap items-center justify-between gap-2 border-t py-6 text-[11px] text-muted-foreground lg:mx-10"><span>知衡 ZHIHENG · 把判断留给你，把依据讲清楚</span><span>数据来源：扶摇 · {catalog?.rulesVersion ?? '规则加载中'}</span></footer>
    </div>
    {busy && <div role="status" className="fixed bottom-5 right-5 z-50 flex items-center gap-2 rounded-full border bg-card px-5 py-3 text-xs shadow-lg"><LoaderCircle className="size-4 animate-spin text-primary" />{busy}</div>}
    <EvidenceDialog data={evidence} onClose={() => setEvidence(null)} />
    <Dialog open={saveOpen} onOpenChange={setSaveOpen}><DialogContent className="bg-card"><DialogHeader>
      <DialogTitle>保存研究策略</DialogTitle><DialogDescription>条件、结果与数据快照一起保存。后续修改会生成新的版本。</DialogDescription></DialogHeader>
      <label htmlFor="strategy-name" className="text-sm">策略名称</label><Input id="strategy-name" value={saveName} maxLength={80} onChange={(event) => setSaveName(event.target.value)} />
      <div className="flex flex-wrap justify-end gap-2">{activeVersion && <Button variant="outline" disabled={!!busy || !saveName.trim()} onClick={() => save(true)}>另存为新策略</Button>}
        <Button disabled={!!busy || !saveName.trim()} onClick={() => save(false)}>{activeVersion ? `保存为 v${activeVersion.version + 1}` : '保存策略'}</Button></div>
    </DialogContent></Dialog>
    <Dialog open={compareOpen} onOpenChange={setCompareOpen}><DialogContent className="max-h-[85vh] max-w-4xl overflow-auto bg-card"><DialogHeader>
      <DialogTitle>这次修改带来了什么变化</DialogTitle><DialogDescription>固定数据版本 {comparison?.snapshotId.slice(0, 8)}，仅改变条件。单条件独立影响不能相加作为总影响。</DialogDescription></DialogHeader>
      <div className="grid gap-4 md:grid-cols-2">{[beforeRun, run].map((item, index) => <div key={index} className="rounded-lg bg-muted/60 p-4 text-xs leading-6">
        <strong>{index ? '修改后' : '修改前'}</strong>{item?.conditions.map((condition) => <p key={condition.id}>{label(condition)}</p>)}</div>)}</div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{[['新入选', comparison?.entered.length], ['明确移出', comparison?.exited.length], ['保持入选', comparison?.retained.length], ['变为待核实', comparison?.becameUnknown.length]].map(([name, count]) =>
        <div className="rounded-lg border p-4" key={name}><p className="text-xs text-muted-foreground">{name}</p><strong className="mt-2 block text-2xl tabular-nums">{count}</strong></div>)}</div>
      {comparison?.independentEffects.map((effect) => <p key={effect.conditionId} className="text-xs leading-6">单独修改“{(run?.conditions.find((item) => item.id === effect.conditionId) ?? beforeRun?.conditions.find((item) => item.id === effect.conditionId))?.metricId
        ? METRIC_MAP[(run?.conditions.find((item) => item.id === effect.conditionId) ?? beforeRun!.conditions.find((item) => item.id === effect.conditionId))!.metricId].name : '条件'}”：新增{effect.entered}只，明确移出{effect.exited}只</p>)}
      <div className="divide-y">{comparison?.changes.length ? comparison.changes.map((change) => <div key={change.code} className="py-3 text-sm">
        <p className="font-medium">{change.name} {change.code} · {VERDICT_LABEL[change.before]} → {VERDICT_LABEL[change.after]}</p><p className="mt-1 text-xs leading-6 text-muted-foreground">{change.reasons.join('；')}</p>
      </div>) : <p className="py-5 text-center text-sm text-muted-foreground">条件改变后，名单没有变化。</p>}</div>
    </DialogContent></Dialog>
    <Dialog open={aboutOpen} onOpenChange={setAboutOpen}><DialogContent className="max-h-[85vh] max-w-2xl overflow-auto bg-card"><DialogHeader><DialogTitle>方法、数据与边界</DialogTitle>
      <DialogDescription>让每一个“满足”都能沿着来源复核。</DialogDescription></DialogHeader>
      <div className="space-y-5 text-sm leading-7">
        <p>AI将自然语言转成条件草稿；用户确认后，由程序按同一快照确定性计算。全部条件满足才入选；出现明确不满足则排除；没有明确不满足但存在缺失值时，标记待核实。</p>
        <p>首版限定执行时取得的完整沪深300成分股，支持8项指标与AND组合。财报仅使用研究时点前已披露且可比的数据。累计同比的变化不等于单季环比。</p>
        <p>行情使用已完成交易日的前复权日线。估值使用供应商最新PE(TTM)/PB(MRQ)，接口最大时间不代表每只股票同步更新。点击个股指标可查看原始输入、日期、公式和请求来源。</p>
        <p>支持同快照条件比较、2—3股比较、不可变策略版本、手动及定时条件检查。监控开关针对固定版本；修改策略后，需要为新版本重新创建监控。</p>
        <p>不提供历史选股回测、未来涨跌预测、收益承诺或自动交易。仅使用当前数据研究，不能将本次名单当作历史时点的投资组合。</p>
        <a className="text-primary underline" href="https://fuyao.aicubes.cn/docs/" target="_blank" rel="noreferrer">查看扶摇数据接口文档</a>
      </div>
    </DialogContent></Dialog>
  </div>;
};
export default ResearchPage;
