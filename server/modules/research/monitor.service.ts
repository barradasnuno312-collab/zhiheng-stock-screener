import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Monitor, MonitorEvent, SavedVersion, ScreenRun, SnapshotSummary } from '../../../shared/api.interface';
import { StorageService } from './storage.service';
import { DatasetService } from './dataset.service';
import { screen, resultChanges } from './screening';
import { chinaDay } from './metrics';
import { stableId } from './research-utils';

export interface StoredMonitor extends Omit<Monitor, 'events'> { baselineRunId: string }
@Injectable()
export class MonitorService {
  constructor(
    @Inject(StorageService) private readonly storage: StorageService,
    @Inject(DatasetService) private readonly datasets: DatasetService,
  ) {}
  async create(ownerId: string, versionId: string): Promise<Monitor> {
    const version: SavedVersion = await this.storage.getObject(versionId, 'version', ownerId);
    const id: string = stableId(ownerId, `monitor:${versionId}`);
    if (await this.storage.objectExists(id, 'monitor', ownerId)) return this.get(ownerId, id);
    await this.storage.consumeLimit(`monitor-total:${ownerId}`, 20, Date.now() + 365 * 86400000);
    const monitor: StoredMonitor = {
      id, versionId, name: `${version.name} · v${version.version}`, enabled: true,
      schedule: '每日16:30（北京时间），按交易日历检查', lastCheckedAt: null, baselineRunId: version.runId,
    };
    await this.storage.insertObject(id, 'monitor', ownerId, monitor, versionId);
    return { ...monitor, events: [] };
  }
  async get(ownerId: string, id: string): Promise<Monitor> {
    const stored: StoredMonitor = await this.storage.getObject(id, 'monitor', ownerId);
    const events: MonitorEvent[] = await this.storage.listObjects('event', ownerId, id, 30);
    const { baselineRunId: _baselineRunId, ...monitor } = stored;
    return { ...monitor, events };
  }
  async list(ownerId: string): Promise<Monitor[]> {
    const monitors: StoredMonitor[] = await this.storage.listObjects('monitor', ownerId, undefined, 20);
    const result: Monitor[] = [];
    for (const monitor of monitors) result.push(await this.get(ownerId, monitor.id));
    return result;
  }
  async toggle(ownerId: string, id: string, enabled: boolean): Promise<Monitor> {
    const holder: string = randomUUID();
    if (!await this.storage.acquireLock(`monitor:${id}`, holder, 60000)) throw new ConflictException('监控正在检查');
    try {
      const monitor: StoredMonitor = await this.storage.getObject(id, 'monitor', ownerId);
      await this.storage.updateObject(id, 'monitor', ownerId, { ...monitor, enabled });
      return this.get(ownerId, id);
    } finally { await this.storage.releaseLock(`monitor:${id}`, holder); }
  }
  async check(
    ownerId: string, id: string, source: 'manual' | 'schedule', checkId: string,
    forcedStatus?: 'closed' | 'failed',
  ): Promise<MonitorEvent | null> {
    const holder: string = randomUUID();
    if (!await this.storage.acquireLock(`monitor:${id}`, holder, 60000)) throw new ConflictException('监控正在检查');
    try {
      const monitor: StoredMonitor = await this.storage.getObject(id, 'monitor', ownerId);
      if (source === 'schedule' && !monitor.enabled) return null;
      const eventId: string = stableId(checkId, id);
      if (await this.storage.objectExists(eventId, 'event', ownerId)) {
        const event: MonitorEvent = await this.storage.getObject(eventId, 'event', ownerId);
        // Crash recovery: event persistence may have completed before baseline update.
        await this.commitMonitor(ownerId, monitor, event);
        return event;
      }
      if (source === 'manual') {
        const minute: number = Math.floor(Date.now() / 60000);
        await this.storage.consumeLimit(`monitor-check:${ownerId}:${minute}`, 5, (minute + 1) * 60000);
      }
      const version: SavedVersion = await this.storage.getObject(monitor.versionId, 'version', ownerId);
      const latest: SnapshotSummary | null = await this.datasets.latest();
      const event: MonitorEvent = {
        id: eventId, monitorId: id, source, checkedAt: new Date().toISOString(),
        status: forcedStatus ?? 'pending', changes: [], runId: null,
        message: forcedStatus === 'closed' ? '交易日历显示今日休市，无新交易日'
          : forcedStatus === 'failed' ? '本次数据刷新失败，保留上次结果' : '最新数据尚未就绪，保留上次结果',
      };
      const stale: boolean = !latest || chinaDay(new Date(latest.fetchedAt)) !== chinaDay(new Date());
      if (!forcedStatus && latest && !stale) {
        const before: ScreenRun = await this.storage.getObject(monitor.baselineRunId, 'run', ownerId);
        if (before.snapshot.id === latest.id) {
          event.status = latest.marketClosed ? 'closed' : 'unchanged';
          event.message = latest.marketClosed ? '今日休市，数据版本未变化' : '检查完成，数据版本未变化';
        } else {
          const run: ScreenRun = screen(await this.datasets.load(latest.id), version.conditions,
            stableId(eventId, 'run'), event.checkedAt, version.intent);
          await this.storage.insertObject(run.id, 'run', ownerId, run, latest.id);
          event.runId = run.id;
          event.changes = resultChanges(before.results, run.results);
          event.status = event.changes.length ? 'changed' : 'unchanged';
          event.message = event.changes.length
            ? `${event.changes.length}只股票状态变化；数据缺失与明确移出分别记录`
            : '检查完成，筛选名单无变化';
        }
      }
      await this.storage.insertObject(event.id, 'event', ownerId, event, id);
      await this.commitMonitor(ownerId, monitor, event);
      return event;
    } finally { await this.storage.releaseLock(`monitor:${id}`, holder); }
  }
  private async commitMonitor(ownerId: string, monitor: StoredMonitor, event: MonitorEvent): Promise<void> {
    if (monitor.lastCheckedAt && monitor.lastCheckedAt > event.checkedAt) return;
    await this.storage.updateObject(monitor.id, 'monitor', ownerId, {
      ...monitor, lastCheckedAt: event.checkedAt, baselineRunId: event.runId ?? monitor.baselineRunId,
    });
  }
}
