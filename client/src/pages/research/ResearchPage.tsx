import React, { lazy, Suspense, useEffect, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import {
  ArrowDownToLine, ArrowRight, Check, CircleHelp, Compass, Database, ExternalLink,
  Layers3, LoaderCircle, LockKeyhole, RefreshCw, Search, Share2, ShieldCheck, Sparkles,
} from 'lucide-react';
import type {
  CatalogResponse, Condition, IntentDraft, JobStatus, Monitor, RunComparison,
  SavedVersion, ScreenRun, SnapshotReplay, SnapshotSummary, StockCompareResponse,
} from '../../../../shared/api.interface';
import { METRIC_MAP, OPERATOR_LABELS } from '../../../../shared/metric-catalog';
import { conditionsSchema, detectConflicts, sameConditions } from '../../../../shared/validation';
import { research as api } from '../../api';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Textarea } from '../../components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../../components/ui/dialog';
import ConditionEditor from './ConditionEditor';
import { VERDICT_LABEL } from './research-format';
import { buildShareUrl, decodeSharedScreen } from './research-io';

const ResultsPanel = lazy(() => import('./ResultsPanel'));
const EvidenceDialog = lazy(() => import('./EvidenceDialog'));
const StrategyLibrary = lazy(() => import('./StrategyLibrary'));
const INITIAL_SHARED_SCREEN = typeof window === 'undefined' ? null
  : decodeSharedScreen(new URLSearchParams(window.location.search).get('screen'));

const EXAMPLES: string[] = [
  '经营改善、估值不要太贵、最近走势相对稳定的公司',
  '市盈率小于30倍，营收同比大于10%',
  '近60日最大回撤小于15%，日均成交额超过1亿元',
];
function label(condition: Condition): string {
  return `${METRIC_MAP[condition.metricId].name} ${OPERATOR_LABELS[condition.operator]} ${condition.value}${
    condition.operator === 'between' ? `～${condition.upperValue}` : ''}${condition.unit}${condition.enabled ? '' : '（停用）'}`;
}
const WorkspaceSkeleton: React.FC = () => <div aria-busy="true" aria-label="正在载入研究工作台" className="space-y-6">
  <p className="text-sm text-muted-foreground">正在同步数据版本、策略和最近结果…</p>
  <div className="grid gap-6 lg:grid-cols-[0.85fr_1.4fr]">
    <div className="space-y-3 py-3"><div className="h-3 w-36 animate-pulse rounded bg-muted" />
      <div className="h-10 w-64 animate-pulse rounded bg-muted" /><div className="h-4 w-56 animate-pulse rounded bg-muted" /></div>
    <div className="h-52 animate-pulse rounded-lg border bg-card" />
  </div>
  <div className="h-14 animate-pulse rounded-lg border bg-card" />
  <div className="grid gap-6 xl:grid-cols-[320px_minmax(0,1fr)]">
    <div className="h-80 animate-pulse rounded-lg border bg-card" />
    <div className="h-96 animate-pulse rounded-lg border bg-card" />
  </div>
</div>;
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
  const [text, setText] = useState(INITIAL_SHARED_SCREEN?.intent ?? '');
  const [conditions, setConditions] = useState<Condition[]>(INITIAL_SHARED_SCREEN?.conditions ?? []);
  const [draft, setDraft] = useState<IntentDraft | null>(null);
  const [job, setJob] = useState<JobStatus | null>(null);
  const [run, setRun] = useState<ScreenRun | null>(null);
  const [comparison, setComparison] = useState<RunComparison | null>(null);
  const [beforeRun, setBeforeRun] = useState<ScreenRun | null>(null);
  const [compareOpen, setCompareOpen] = useState(false);
  const [replay, setReplay] = useState<SnapshotReplay | null>(null);
  const [evidence, setEvidence] = useState<StockCompareResponse | null>(null);
  const [activeVersion, setActiveVersion] = useState<SavedVersion | null>(null);
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [aboutOpen, setAboutOpen] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState(INITIAL_SHARED_SCREEN ? '分享的条件已填入。核对阈值后即可筛选。' : '');
  const [booting, setBooting] = useState(true);
  const parsing: boolean = !!job && ['pending', 'running'].includes(job.status);
  const dirty: boolean = !!run && !sameConditions(conditions, run.conditions);
  const enabledConditionCount = conditions.filter((item) => item.enabled).length;
  const executable: boolean = !!snapshot && enabledConditionCount > 0
    && conditionsSchema.safeParse(conditions).success && !detectConflicts(conditions).length && !busy && !parsing;

  async function perform(name: string, action: () => Promise<void>): Promise<void> {
    setBusy(name); setError(''); setNotice('');
    try { await action(); } catch (failure: unknown) { setError(api.errorMessage(failure)); }
    finally { setBusy(''); }
  }
  useEffect(() => {
    let mounted = true;
    void api.session().then((session) => { if (mounted) setAuthorized(session.authorized); })
      .catch((failure: unknown) => { if (mounted) { setAuthorized(false); setError(api.errorMessage(failure)); } });
    return () => { mounted = false; };
  }, []);
  useEffect(() => {
    if (authorized !== true) { if (authorized === false) setBooting(false); return; }
    let mounted = true;
    setBooting(true);
    const previousId: string | null = INITIAL_SHARED_SCREEN ? null : sessionStorage.getItem('zh-last-run');
    const jobId: string | null = INITIAL_SHARED_SCREEN ? null : sessionStorage.getItem('zh-intent-job');
    void Promise.all([
      api.catalog(), api.versions(), api.monitors(),
      previousId ? api.run(previousId).catch(() => null) : Promise.resolve(null),
      jobId ? api.job(jobId).catch(() => null) : Promise.resolve(null),
    ]).then(([data, nextVersions, nextMonitors, previous, restored]) => {
      if (!mounted) return;
      setCatalog(data); setVersions(nextVersions); setMonitors(nextMonitors);
      setSnapshot(previous?.snapshot ?? data.snapshot);
      if (previous) {
        setRun(previous); setConditions(previous.conditions); setText(previous.intent);
      }
      if (restored) {
        setJob(restored);
        if (restored.status === 'succeeded' && restored.result && 'conditions' in restored.result) {
          setDraft(restored.result); setConditions(restored.result.conditions);
          sessionStorage.removeItem('zh-intent-job');
        } else if (restored.status === 'failed') {
          setError(restored.message); sessionStorage.removeItem('zh-intent-job');
        }
      }
    }).catch((failure: unknown) => { if (mounted) setError(api.errorMessage(failure)); })
      .finally(() => { if (mounted) setBooting(false); });
    return () => { mounted = false; };
  }, [authorized]);
  useEffect(() => {
    if (!job || !parsing) return;
    let mounted = true;
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const next: JobStatus = await api.job(job.id);
          if (!mounted) return;
          if (next.status === 'succeeded' && next.result && 'conditions' in next.result) {
            setDraft(next.result); setConditions(next.result.conditions);
            sessionStorage.removeItem('zh-intent-job');
          } else if (next.status === 'failed') {
            setError(next.message); sessionStorage.removeItem('zh-intent-job');
          } else if (Date.now() - new Date(next.createdAt).getTime() > 90000) {
            setError('条件仍在生成。你可以先手动编辑，稍后刷新页面查看结果。');
            setJob(null); return;
          }
          setJob(next);
        } catch (failure: unknown) { if (mounted) { setError(api.errorMessage(failure)); setJob(null); } }
      })();
    }, 1200);
    return () => { mounted = false; clearTimeout(timer); };
  }, [job, parsing]);

  const edit = (next: Condition[]): void => { setConditions(next); };
  const doParse = (): void => { void perform('理解想法', async () => {
    const next: JobStatus = await api.parse({ text, previousConditions: conditions });
    setJob(next); sessionStorage.setItem('zh-intent-job', next.id);
  }); };
  const execute = (): void => { if (!snapshot) return; void perform('执行筛选', async () => {
    const next: ScreenRun = await api.execute({ conditions, snapshotId: snapshot.id,
      universeVersion: snapshot.universeVersion, intent: text, confirmed: true });
    setBeforeRun(run);
    setComparison(run && run.snapshot.id === next.snapshot.id
      ? await api.compare({ beforeRunId: run.id, afterRunId: next.id }) : null);
    setRun(next); sessionStorage.setItem('zh-last-run', next.id);
    setNotice('筛选完成。点击股票名称可查看入选或排除原因。');
  }); };
  const loadVersion = (id: string): void => { void perform('恢复策略', async () => {
    const data = await api.load(id);
    setRun(data.run); setConditions(data.version.conditions); setSnapshot(data.version.snapshot);
    setActiveVersion(data.version); setText(data.version.intent);
    setDraft(null); setComparison(null); sessionStorage.setItem('zh-last-run', data.run.id);
    setNotice(`已打开“${data.version.name}”v${data.version.version}及对应日期的数据`);
    navigate('/');
  }); };
  const save = (asNew: boolean): void => { if (!run) return; void perform('保存策略', async () => {
    const version = await api.save({ name: saveName, runId: run.id,
      strategyId: !asNew && activeVersion ? activeVersion.strategyId : undefined });
    setActiveVersion(version); setVersions(await api.versions()); setSaveOpen(false);
    setNotice(`已保存“${version.name}”v${version.version}，可在策略页再次打开或跟踪。`);
  }); };
  const share = (): void => { void perform('复制条件链接', async () => {
    if (!conditions.length) throw new Error('请先生成或添加筛选条件');
    await navigator.clipboard.writeText(buildShareUrl(text, conditions, window.location.href));
    setNotice('条件链接已复制，不包含访问码、股票名单或历史结果。');
  }); };
  const replayVersion = (id: string): void => { void perform('读取历史变化', async () => {
    setReplay(await api.replay(id));
  }); };

  if (authorized !== true) return <main className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
    <section className="flex flex-col justify-between bg-sidebar p-8 text-sidebar-foreground sm:p-14 lg:p-20">
      <div className="flex items-center gap-3"><Compass size={30} strokeWidth={1.5} /><strong className="text-2xl tracking-widest">知衡</strong><span className="ml-2 border-l border-current/20 pl-4 text-xs tracking-widest opacity-65">ZHIHENG</span></div>
      <div className="py-14">
        <h1 className="text-4xl leading-snug font-medium lg:text-5xl">每一个选股想法，<br />都应该有据可查。</h1>
        <p className="mt-6 max-w-md text-sm leading-7 opacity-65">把研究想法转成可编辑条件，并查看每只股票的判断原因。</p>
      </div><p className="text-xs opacity-45">沪深300 · 财务、估值与历史价格研究</p>
    </section>
    <section className="flex items-center justify-center bg-background px-8 py-16">
      <div className="w-full max-w-sm"><LockKeyhole className="mb-6 size-7 text-primary" strokeWidth={1.5} />
        <p className="text-xs tracking-widest text-muted-foreground">访问验证</p><h2 className="mt-3 text-2xl font-semibold">进入研究工作台</h2>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">输入访问码即可进入。你的筛选与其他访客相互独立。</p>
        <form className="mt-8 space-y-4" onSubmit={loginForm.handleSubmit(({ code }) => perform('验证访问码', async () => {
          await api.login(code); loginForm.reset(); setBooting(true); setAuthorized(true);
        }))}>
          <label htmlFor="access-code" className="text-sm font-medium">访问码</label>
          <Input id="access-code" type="password" autoComplete="current-password" placeholder="请输入访问码"
            {...loginForm.register('code', { required: true, maxLength: 128 })} />
          <Button className="w-full" size="lg" type="submit" disabled={!!busy || authorized === null}>
            {busy || authorized === null ? <LoaderCircle className="animate-spin" /> : <>开始研究<ArrowRight /></>}</Button>
        </form>
        {error && <div role="alert" className="mt-4 text-sm text-destructive">{error}
          {authorized === null && <Button variant="ghost" size="sm" onClick={() => { setAuthorized(false); setError(''); }}>重试</Button>}</div>}
        <p className="mt-8 flex items-start gap-2 text-xs leading-5 text-muted-foreground"><ShieldCheck className="mt-0.5 size-4 shrink-0" />筛选记录仅属于当前浏览器会话。本工具不提供买卖建议。</p>
      </div>
    </section>
  </main>;

  return <div className="min-h-screen bg-background text-foreground">
    <a href="#research-main" className="sr-only z-50 rounded-md bg-card px-4 py-3 text-sm font-medium text-foreground focus:not-sr-only focus:fixed focus:left-4 focus:top-4">
      跳到研究内容
    </a>
    <aside className="fixed inset-y-0 left-0 z-20 hidden w-20 flex-col items-center gap-8 border-r bg-sidebar py-7 text-sidebar-foreground md:flex">
      <NavLink to="/" aria-label="知衡首页" className="rounded-md focus-visible:!outline-sidebar-foreground"><Compass className="size-8" strokeWidth={1.6} /></NavLink>
      <nav className="flex flex-col gap-4">
        <NavLink to="/" end className={({ isActive }) => `rounded-lg p-3 focus-visible:!outline-sidebar-foreground ${isActive ? 'bg-white/15' : 'opacity-60 hover:opacity-100'}`} aria-label="选股工作台"><Search size={21} /></NavLink>
        <NavLink to="/strategies" className={({ isActive }) => `rounded-lg p-3 focus-visible:!outline-sidebar-foreground ${isActive ? 'bg-white/15' : 'opacity-60 hover:opacity-100'}`} aria-label="策略与跟踪"><Layers3 size={21} /></NavLink>
      </nav>
      <Button className="mt-auto text-sidebar-foreground opacity-70 focus-visible:!outline-sidebar-foreground" size="icon" variant="ghost" aria-label="帮助与说明" onClick={() => setAboutOpen(true)}><CircleHelp /></Button>
    </aside>
    <div className="md:ml-20">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b bg-card px-5 py-4 lg:px-10">
        <div className="flex items-center gap-5"><NavLink to="/" className="text-xl font-semibold tracking-[0.2em]">知衡</NavLink>
          <span className="hidden border-l pl-5 text-xs text-muted-foreground sm:block">自然语言选股 · 结果可核查</span></div>
        <nav className="flex items-center gap-2 text-sm"><NavLink to="/" end className={({ isActive }) => `flex min-h-11 items-center px-2 md:hidden ${isActive ? 'font-medium text-primary' : 'text-muted-foreground'}`}>工作台</NavLink>
          <NavLink to="/strategies" className={({ isActive }) => `flex min-h-11 items-center px-2 md:hidden ${isActive ? 'font-medium text-primary' : 'text-muted-foreground'}`}>策略与跟踪</NavLink>
          <Button variant="ghost" size="icon" aria-label="帮助与说明" onClick={() => setAboutOpen(true)}><CircleHelp /></Button></nav>
      </header>
      <main id="research-main" tabIndex={-1} className="mx-auto max-w-[1600px] space-y-6 p-5 lg:p-10">
        {error && <div role="alert" className="rounded-lg border border-destructive/20 bg-destructive/5 p-4 text-sm text-destructive">{error}</div>}
        {notice && <div role="status" className="rounded-lg border border-primary/15 bg-primary/5 p-4 text-sm text-primary">{notice}</div>}
        <Suspense fallback={<WorkspaceSkeleton />}>
        {booting ? <WorkspaceSkeleton /> : isLibrary ? <StrategyLibrary versions={versions} monitors={monitors} scheduleEnabled={catalog?.scheduleEnabled ?? false}
          busy={!!busy} onLoad={loadVersion}
          onMonitor={(id) => { void perform('创建监控', async () => { await api.createMonitor(id); setMonitors(await api.monitors()); setNotice('已保存监控设置。'); }); }}
          onCheck={(id) => { void perform('检查条件', async () => { const event = await api.check(id); setMonitors(await api.monitors()); setNotice(event?.message ?? '检查完成'); }); }}
          onToggle={(id, enabled) => { void perform('修改监控', async () => { await api.toggle(id, enabled); setMonitors(await api.monitors()); }); }}
          onReplay={replayVersion} />
          : <>
            <section className="grid gap-6 lg:grid-cols-[0.85fr_1.4fr] lg:gap-12">
              <div className="py-3"><p className="text-xs font-medium tracking-[0.2em] text-primary">选股研究</p>
                <h1 className="mt-4 text-3xl leading-tight font-semibold tracking-tight lg:text-4xl">把选股想法，<br className="hidden lg:block" />变成可验证的条件。</h1>
                <p className="mt-4 text-sm leading-7 text-muted-foreground">在沪深300中描述关注点，再核对指标和阈值。</p>
              </div>
              <div className="rounded-xl border bg-card p-5 shadow-sm">
                <label htmlFor="research-intent" className="flex items-center gap-2 text-sm font-medium"><Sparkles className="size-4 text-primary" />你想寻找什么样的公司？</label>
                <Textarea id="research-intent" value={text} maxLength={2000}
                  onChange={(event) => setText(event.target.value)} disabled={parsing}
                  placeholder="例如：经营改善，估值不要太贵，最近走势相对稳定。" className="mt-3 min-h-24 resize-none border-0 bg-muted/45 text-sm shadow-none" />
                <div className="mt-4 flex flex-wrap items-center justify-end gap-3">
                  {!catalog?.aiConfigured && <span role="status" className="mr-auto text-xs text-warning">智能生成暂不可用，可直接添加条件。</span>}
                  <Button disabled={!!busy || parsing || text.trim().length < 2 || !catalog?.aiConfigured} onClick={doParse}>
                    {parsing ? <><LoaderCircle className="animate-spin" />正在生成</> : <><Sparkles />生成筛选条件</>}</Button></div>
                <div className="mt-4 flex flex-wrap gap-2 border-t pt-3">{EXAMPLES.map((example, index) =>
                  <button key={example} disabled={parsing} className="min-h-11 rounded-full bg-muted px-3 py-1.5 text-[11px] text-muted-foreground hover:text-primary"
                    onClick={() => setText(example)}>{['经营改善', '成长与估值', '回撤与流动性'][index]}</button>)}</div>
              </div>
            </section>
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card px-4 py-3 text-xs">
              <div className="flex flex-wrap items-center gap-x-5 gap-y-2"><span className="flex items-center gap-2 font-medium"><Database size={14} className="text-primary" />数据</span>
                <span>{snapshot ? `行情 ${snapshot.quoteDate}${snapshot.marketClosed ? ' · 当日休市' : ''}` : '行情尚未就绪'}</span>
                {snapshot && <details className="text-muted-foreground"><summary className="min-h-11 cursor-pointer py-3">查看数据详情</summary>
                  <p className="mt-1 leading-5">{snapshot.completedCount}/{snapshot.memberCount}只已处理 · {snapshot.errorCount}只取数异常 · 数据版本 {snapshot.id.slice(0, 8)}</p>
                  {snapshot.warnings.map((warning) => <p key={warning} className="mt-1 max-w-2xl leading-5">{warning}</p>)}
                </details>}
                {!snapshot && <span className="text-muted-foreground">可以先生成和编辑条件</span>}</div>
              <Button variant="ghost" size="sm" disabled={!!busy} onClick={() => { void perform('检查数据状态', async () => {
                const data = await api.catalog(); setCatalog(data);
                if (!snapshot) setSnapshot(data.snapshot);
                setNotice(data.snapshot ? '数据状态已更新。' : '当前尚无可用数据。');
              }); }}><RefreshCw />刷新状态</Button>
            </div>
            {catalog?.snapshot && snapshot?.id !== catalog.snapshot.id && <Button variant="outline" size="sm"
              onClick={() => { setSnapshot(catalog.snapshot); setNotice('已切换到最新数据，筛选后会生成一组新结果。'); }}>使用最新数据</Button>}
            {draft && <div className="rounded-xl border bg-card p-5">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                <span className="flex items-center gap-2 font-semibold"><Check className="size-4 text-primary" />已生成 {enabledConditionCount} 条条件</span>
                <span className="text-muted-foreground">{draft.intentSummary}</span>
              </div>
              {draft.clarifications.length > 0 && <div className="mt-3 rounded-md bg-warning/5 p-3 text-sm">
                <p className="font-medium text-warning">有 {draft.clarifications.length} 处需要你判断</p>
                {draft.clarifications.map((item) => <p key={item} className="mt-2 leading-6">{item}</p>)}
                <p className="mt-2 text-xs text-muted-foreground">可直接修改下方阈值，或补充描述后重新生成。</p>
              </div>}
              {draft.unsupportedRequests.length > 0 && <div className="mt-3 rounded-md bg-warning/5 p-3 text-sm leading-6">
                <span className="font-medium text-warning">本次未纳入：</span>{draft.unsupportedRequests.join('；')}。筛选按钮只执行下方条件。
              </div>}
              {draft.warnings.length > 0 && <details className="mt-3 text-xs leading-5 text-muted-foreground">
                <summary className="min-h-11 cursor-pointer py-3">查看其他提醒（{draft.warnings.length}）</summary>
                <div className="mt-1 space-y-1">{draft.warnings.map((warning) => <p key={warning}>{warning}</p>)}</div>
              </details>}
            </div>}
            <div className="grid items-start gap-6 xl:grid-cols-[320px_minmax(0,1fr)]">
              <div className="space-y-4"><ConditionEditor conditions={conditions} onChange={edit} disabled={!!busy || parsing} />
                <div className="rounded-xl border bg-card p-4">
                  <Button className="w-full" size="lg" disabled={!executable} onClick={execute}>
                    {busy === '执行筛选' ? <LoaderCircle className="animate-spin" /> : <Search />}
                    {enabledConditionCount ? `筛选 ${enabledConditionCount} 条条件` : '请先添加条件'}</Button>
                  {!snapshot && <p className="mt-3 text-xs leading-5 text-muted-foreground">数据尚未就绪，可先生成并编辑条件。</p>}
                </div>
              </div>
              <div className="min-w-0 space-y-4"><ResultsPanel key={run?.id ?? 'empty'} run={run} dirty={dirty}
                loading={busy === '执行筛选'} onDetail={(codes) => { if (run) void perform('读取证据', async () => setEvidence(await api.stocks(run.id, codes))); }} />
                {run && <div className={`flex flex-wrap items-center gap-3 rounded-xl border bg-card p-4 ${activeVersion ? 'justify-between' : 'justify-end'}`}>
                  {activeVersion && <div className="text-xs text-muted-foreground">已打开：{activeVersion.name} · v{activeVersion.version}</div>}
                  <div className="flex flex-wrap gap-2">{comparison && <Button variant="outline" disabled={!!busy} onClick={() => setCompareOpen(true)}><Layers3 />查看结果变化</Button>}
                    <Button variant="outline" disabled={!!busy || !conditions.length} onClick={share}><Share2 />复制条件链接</Button>
                    <Button disabled={!!busy || dirty} onClick={() => { setSaveName(activeVersion?.name ?? (draft?.intentSummary || '我的研究策略').slice(0, 40)); setSaveOpen(true); }}><ArrowDownToLine />保存本次筛选</Button></div>
                </div>}
                <p className="px-1 text-xs leading-6 text-muted-foreground">低估值不等于低估，历史稳定不代表未来低风险。结果用于条件核验，不构成买卖建议。</p>
              </div>
            </div>
          </>}
        </Suspense>
      </main>
      <footer className="mx-5 border-t py-6 text-[11px] text-muted-foreground lg:mx-10">数据来源：扶摇</footer>
    </div>
    {busy && <div role="status" className="fixed bottom-5 right-5 z-50 flex items-center gap-2 rounded-full border bg-card px-5 py-3 text-xs shadow-lg"><LoaderCircle className="size-4 animate-spin text-primary" />{busy}</div>}
    {evidence && <Suspense fallback={null}><EvidenceDialog data={evidence} onClose={() => setEvidence(null)} /></Suspense>}
    <Dialog open={saveOpen} onOpenChange={setSaveOpen}><DialogContent className="bg-card"><DialogHeader>
      <DialogTitle>保存本次筛选</DialogTitle><DialogDescription>保存当前条件、结果和数据日期，之后可随时再次打开。</DialogDescription></DialogHeader>
      <label htmlFor="strategy-name" className="text-sm">策略名称</label><Input id="strategy-name" value={saveName} maxLength={80} onChange={(event) => setSaveName(event.target.value)} />
      <div className="flex flex-wrap justify-end gap-2">{activeVersion && <Button variant="outline" disabled={!!busy || !saveName.trim()} onClick={() => save(true)}>另存为新策略</Button>}
        <Button disabled={!!busy || !saveName.trim()} onClick={() => save(false)}>{activeVersion ? `保存新版本 v${activeVersion.version + 1}` : '保存'}</Button></div>
    </DialogContent></Dialog>
    <Dialog open={compareOpen} onOpenChange={setCompareOpen}><DialogContent className="max-h-[85vh] max-w-4xl overflow-auto bg-card"><DialogHeader>
      <DialogTitle>条件修改后的结果变化</DialogTitle><DialogDescription>两次筛选使用同一份数据，只比较条件变化。各条件的单独影响不能直接相加。</DialogDescription></DialogHeader>
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
    <Dialog open={!!replay} onOpenChange={(open) => { if (!open) setReplay(null); }}><DialogContent className="max-h-[85vh] max-w-4xl overflow-auto bg-card">
      <DialogHeader><DialogTitle>不同数据日期下的结果</DialogTitle>
        <DialogDescription>{replay?.strategyName} · 使用相同条件重新筛选系统已保存的数据</DialogDescription></DialogHeader>
      <div className="space-y-3">{replay?.entries.map((entry, index) => <section key={entry.snapshot.id} className="rounded-lg border p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div><h3 className="font-medium">行情 {entry.snapshot.quoteDate}</h3>
            <p className="mt-1 text-xs text-muted-foreground">快照 {entry.snapshot.id.slice(0, 8)} · {entry.snapshot.universeVersion}</p></div>
          <span className="text-xs text-muted-foreground">{index ? `较上个日期变化 ${entry.changedCount} 只` : '最早记录'}</span>
        </div>
        <div className="mt-4 grid grid-cols-3 gap-3 sm:grid-cols-6">
          {[['入选', entry.coverage.pass], ['排除', entry.coverage.fail], ['待核实', entry.coverage.unknown],
            ['新入选', entry.entered], ['明确移出', entry.exited], ['变为待核实', entry.becameUnknown]].map(([name, value]) =>
            <div key={name} className="rounded-md bg-muted/60 p-3"><p className="text-[11px] text-muted-foreground">{name}</p>
              <strong className="mt-1 block text-lg tabular-nums">{value}</strong></div>)}
        </div>
        {!!entry.examples.length && <details className="mt-3 text-xs"><summary className="min-h-11 cursor-pointer py-3">查看前{entry.examples.length}条变化示例</summary>
          <div className="mt-2 divide-y">{entry.examples.map((change) => <p key={change.code} className="py-2 leading-5">
            {change.name} {change.code} · {VERDICT_LABEL[change.before]} → {VERDICT_LABEL[change.after]}</p>)}</div>
        </details>}
      </section>)}</div>
      <p className="text-xs leading-5 text-muted-foreground">{replay?.note}</p>
    </DialogContent></Dialog>
    <Dialog open={aboutOpen} onOpenChange={setAboutOpen}><DialogContent className="max-h-[85vh] max-w-2xl overflow-auto bg-card"><DialogHeader><DialogTitle>帮助与说明</DialogTitle>
      <DialogDescription>快速找到操作方法、结果含义和问题反馈入口。</DialogDescription></DialogHeader>
      <div className="space-y-4 text-sm leading-7">
        <section><h3 className="font-semibold">快速开始</h3>
          <ol className="mt-2 space-y-1 text-muted-foreground">
            <li>1. 描述选股想法，或直接添加条件。</li>
            <li>2. 核对指标与阈值，点击“筛选 N 条条件”。</li>
            <li>3. 在结果中查看判断原因，按需保存、分享或导出。</li>
          </ol>
        </section>
        <details className="border-t">
          <summary className="min-h-11 cursor-pointer py-3 font-medium">结果状态说明</summary>
          <p className="pb-3 text-muted-foreground">“入选”表示全部启用条件满足；“排除”表示至少一条不满足；“待核实”表示没有已知不满足，但存在缺失或不适用数据；“只差一条”表示仅一条条件不满足。</p>
        </details>
        <details className="border-t">
          <summary className="min-h-11 cursor-pointer py-3 font-medium">保存、分享和导出的区别</summary>
          <div className="space-y-2 pb-3 text-muted-foreground">
            <p><span className="font-medium text-foreground">保存：</span>保留条件、结果和数据日期；记录保留30天，仅当前浏览器访客可访问。</p>
            <p><span className="font-medium text-foreground">分享：</span>复制想法和条件链接，不包含访问码、股票名单或历史结果；打开者仍需访问码。</p>
            <p><span className="font-medium text-foreground">导出：</span>将当前分类及搜索结果下载为CSV。</p>
          </div>
        </details>
        <details className="border-t">
          <summary className="min-h-11 cursor-pointer py-3 font-medium">常见问题</summary>
          <div className="space-y-2 pb-3 text-muted-foreground">
            <p>智能生成不可用时，仍可直接添加和编辑条件。</p>
            <p>数值“—”表示缺失或不适用，不代表0。</p>
            <p>没有入选结果时，可查看“只差一条”和排除原因，再调整阈值。</p>
            <p>修改条件后，旧结果会保留到重新筛选，避免新旧结果混淆。</p>
          </div>
        </details>
        <details className="border-t">
          <summary className="min-h-11 cursor-pointer py-3 font-medium">数据与计算规则</summary>
          <div className="space-y-2 pb-3 text-muted-foreground">
            <p>范围为筛选时的沪深300，支持{catalog?.metrics.length ?? 10}项指标，所有启用条件需同时满足。</p>
            <p>财报只使用研究时点前已披露且可比的数据；行情使用已完成交易日的前复权日线。个股指标可继续展开原始输入、日期、计算方式和来源。</p>
            <p>历史变化只使用系统真实保存的数据重新筛选，不补造数据，也不计算投资收益。估值需结合行业理解，历史波动不代表未来风险。</p>
            <p>本工具不预测涨跌、不承诺收益，也不执行交易。规则版本：{catalog?.rulesVersion ?? '加载中'}。</p>
          </div>
        </details>
        <section className="border-t pt-4"><h3 className="font-semibold">帮助资源</h3>
          <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1">
            <a className="inline-flex min-h-11 items-center gap-1 text-primary underline" href="https://github.com/barradasnuno312-collab/zhiheng-stock-screener#readme" target="_blank" rel="noreferrer">
              使用说明与源码<ExternalLink size={13} /></a>
            <a className="inline-flex min-h-11 items-center gap-1 text-primary underline" href="https://github.com/barradasnuno312-collab/zhiheng-stock-screener/issues/new" target="_blank" rel="noreferrer">
              提交问题或建议<ExternalLink size={13} /></a>
            <a className="inline-flex min-h-11 items-center gap-1 text-primary underline" href="https://fuyao.aicubes.cn/docs/" target="_blank" rel="noreferrer">
              数据接口文档<ExternalLink size={13} /></a>
          </div>
        </section>
      </div>
    </DialogContent></Dialog>
  </div>;
};
export default ResearchPage;
