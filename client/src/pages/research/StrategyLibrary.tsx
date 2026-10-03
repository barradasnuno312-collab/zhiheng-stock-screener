import React from 'react';
import { Bell, Bookmark, Clock3, FolderOpen, History, Play, RefreshCw } from 'lucide-react';
import type { Monitor, SavedVersion } from '../../../../shared/api.interface';
import { Button } from '../../components/ui/button';
import { Switch } from '../../components/ui/switch';
import { displayTime, VERDICT_LABEL } from './research-format';

interface StrategyLibraryProps {
  versions: SavedVersion[];
  monitors: Monitor[];
  scheduleEnabled: boolean;
  busy: boolean;
  onLoad: (id: string) => void;
  onMonitor: (id: string) => void;
  onCheck: (id: string) => void;
  onToggle: (id: string, enabled: boolean) => void;
  onReplay: (id: string) => void;
}
const StrategyLibrary: React.FC<StrategyLibraryProps> = (props) => {
  const groups: Map<string, SavedVersion[]> = new Map();
  for (const version of props.versions) groups.set(version.strategyId, [...(groups.get(version.strategyId) ?? []), version]);
  return <div className="space-y-8">
    <div><p className="text-xs font-medium tracking-widest text-primary">策略与跟踪</p>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight">继续上次的筛选</h1>
      <p className="mt-3 text-sm text-muted-foreground">打开已保存的条件，或查看它们在新数据下是否仍然成立。</p></div>
    <section className="rounded-xl border bg-card">
      <h2 className="flex items-center gap-2 border-b p-5 font-semibold"><Bookmark size={17} />已保存的筛选<span className="ml-1 text-sm font-normal text-muted-foreground">{groups.size}</span></h2>
      {!groups.size && <div className="px-6 py-14 text-center"><FolderOpen className="mx-auto mb-4 size-8 text-muted-foreground" />
        <p className="font-medium">还没有保存的筛选</p><p className="mt-2 text-sm text-muted-foreground">完成筛选后点击“保存本次筛选”，条件、结果和数据日期会一同保留。</p></div>}
      <div className="divide-y">{[...groups.entries()].map(([id, versions]) => <div key={id} className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-4"><div>
          <h3 className="font-semibold">{versions[0].name}<span className="ml-2 text-xs font-normal text-muted-foreground">v{versions[0].version}</span></h3>
          <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">{versions[0].intent || '手动条件策略'}</p>
          <p className="mt-2 text-xs text-muted-foreground">行情 {versions[0].snapshot.quoteDate} · {versions[0].conditions.filter((item) => item.enabled).length}条条件 · {displayTime(versions[0].createdAt)}</p>
        </div><div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" disabled={props.busy} onClick={() => props.onLoad(versions[0].id)}><Play />打开</Button>
          <Button size="sm" variant="outline" disabled={props.busy} onClick={() => props.onReplay(versions[0].id)}><History />历史变化</Button>
          <Button size="sm" disabled={props.busy} onClick={() => props.onMonitor(versions[0].id)}><Bell />跟踪此版本</Button>
        </div></div>
        {versions.length > 1 && <details className="mt-4 text-xs text-muted-foreground"><summary className="min-h-11 cursor-pointer py-3">历史版本（{versions.length - 1}）</summary>
          <div className="mt-2 flex flex-wrap gap-2">{versions.slice(1).map((version) =>
            <Button size="sm" variant="ghost" key={version.id} disabled={props.busy}
              onClick={() => props.onLoad(version.id)}>v{version.version} · {version.name} · {version.snapshot.quoteDate}</Button>)}</div>
        </details>}
      </div>)}</div>
    </section>
    <section className="rounded-xl border bg-card">
      <div className="border-b p-5"><h2 className="flex items-center gap-2 font-semibold"><Bell size={17} />跟踪记录</h2>
        <p className="mt-2 text-xs leading-5 text-muted-foreground">{props.scheduleEnabled
          ? '每个交易日北京时间16:30自动检查，并在此记录结果。'
          : '自动检查尚未启用，可以手动更新到最新可用数据。'}</p></div>
      {!props.monitors.length && <p className="p-10 text-center text-sm text-muted-foreground">可为已保存的固定版本开启跟踪。</p>}
      <div className="divide-y">{props.monitors.map((monitor: Monitor) => <div key={monitor.id} className="space-y-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-4"><div><h3 className="font-medium">{monitor.name}</h3>
          <p className="mt-2 flex items-center gap-1 text-xs text-muted-foreground"><Clock3 size={12} />
            {monitor.lastCheckedAt ? `最近检查 ${displayTime(monitor.lastCheckedAt)}` : '尚未检查'}</p></div>
          <div className="flex items-center gap-4"><label className="flex items-center gap-2 text-xs">
            <Switch checked={monitor.enabled} disabled={props.busy} aria-label={`${monitor.name}监控开关`}
              onCheckedChange={(enabled) => props.onToggle(monitor.id, enabled)} />{monitor.enabled ? '已开启' : '已暂停'}</label>
            <Button variant="outline" size="sm" disabled={props.busy} onClick={() => props.onCheck(monitor.id)}><RefreshCw />立即更新</Button>
          </div></div>
        <div className="space-y-2">{monitor.events.slice(0, 10).map((event) => <details key={event.id} className="rounded-lg bg-muted/60 px-3 text-xs">
          <summary className="min-h-11 cursor-pointer py-3 leading-5"><span className="mr-2 text-muted-foreground">{displayTime(event.checkedAt)} · {event.source === 'manual' ? '手动' : '定时'}</span>{event.message}</summary>
          {event.changes.length > 0 && <div className="mt-3 space-y-2 border-t pt-3">{event.changes.map((change) => <div key={change.code}>
            <p className="font-medium">{change.name} · {VERDICT_LABEL[change.before]} → {VERDICT_LABEL[change.after]}</p>
            <p className="mt-1 text-muted-foreground">{change.reasons.join('；')}</p></div>)}</div>}
        </details>)}</div>
      </div>)}</div>
    </section>
    <p className="text-xs text-muted-foreground">记录保留30天。清除浏览器 Cookie 或退出后，当前访客将无法再访问这些记录。</p>
  </div>;
};
export default StrategyLibrary;
