import { BadRequestException, Inject, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type {
  IntentDraft, JobStatus, ParseRequest, SnapshotSummary, StockFacts,
} from '../../../shared/api.interface';
import { StorageService } from './storage.service';
import type { JobRow, ObjectRow } from './storage.service';
import { FuyaoService } from './fuyao.service';
import type { UniverseData } from './fuyao.service';
import { IntentService } from './intent.service';
import { MonitorService } from './monitor.service';
import type { StoredMonitor } from './monitor.service';
import { FuyaoError } from './source-contract';
import { SHARED_OWNER, stableId } from './research-utils';
import { chinaDay } from './metrics';

interface RefreshPayload {
  source: 'manual' | 'schedule';
  universe?: UniverseData;
  valuations?: Record<string, Pick<StockFacts['metrics'], 'pe_ttm' | 'pb_mrq'>>;
  next?: { kind: 'valuation' | 'stock' | 'finalize'; index: number };
  blockedReason?: string;
}
interface ChildPayload { parentId: string; index: number }
interface MonitorPayload { monitorId: string; checkId: string; forcedStatus?: 'closed' | 'failed' }

@Injectable()
export class JobService {
  private readonly logger = new Logger(JobService.name);
  constructor(
    @Inject(StorageService) private readonly storage: StorageService,
    @Inject(FuyaoService) private readonly fuyao: FuyaoService,
    @Inject(IntentService) private readonly intent: IntentService,
    @Inject(MonitorService) private readonly monitors: MonitorService,
  ) {}
  private async enqueue(id: string, kind: string, ownerId: string, payload: unknown): Promise<void> {
    await this.storage.insertJob({ id, kind, ownerId, payload, status: 'pending',
      message: '等待处理', createdMs: Date.now(), updatedMs: Date.now() });
  }
  async parse(ownerId: string, input: ParseRequest): Promise<JobStatus> {
    const checked: ParseRequest = await this.intent.reserve(ownerId, input);
    const id: string = randomUUID();
    await this.enqueue(id, 'intent', ownerId, checked);
    return this.status(id, ownerId);
  }
  async status(id: string, ownerId?: string): Promise<JobStatus> {
    const job: JobRow = await this.storage.getJob(id, ownerId);
    if (!['intent', 'refresh'].includes(job.kind)) throw new BadRequestException('不能查询内部任务');
    return { id, kind: job.kind as JobStatus['kind'], status: job.status as JobStatus['status'],
      progress: job.progress, message: job.message, createdAt: new Date(job.createdMs).toISOString(),
      result: job.result ? job.result as IntentDraft | SnapshotSummary : undefined };
  }
  async refresh(source: 'manual' | 'schedule'): Promise<JobStatus> {
    const latest: JobRow | null = await this.storage.latestRefresh();
    if (latest && ['pending', 'running'].includes(latest.status) && Date.now() - latest.updatedMs < 7200000) {
      return this.status(latest.id);
    }
    if (!this.fuyao.configured) throw new ServiceUnavailableException('数据访问尚未配置');
    const id: string = source === 'schedule'
      ? stableId('daily-refresh', chinaDay(new Date())) : randomUUID();
    if (latest?.id === id) return this.status(id);
    if (!await this.storage.acquireLock('market-refresh', id, 7200000)) {
      throw new BadRequestException('已有数据刷新任务，请稍后再试');
    }
    try {
      const hour: number = Math.floor(Date.now() / 3600000);
      await this.storage.consumeLimit(`refresh:${hour}`, 1, (hour + 1) * 3600000);
      await this.enqueue(id, 'refresh', SHARED_OWNER, { source } satisfies RefreshPayload);
      return this.status(id);
    } catch (error: unknown) {
      await this.storage.releaseLock('market-refresh', id);
      throw error;
    }
  }
  async work(id: string): Promise<void> {
    const job: JobRow | null = await this.storage.claimJob(id);
    if (!job) return;
    try {
      switch (job.kind) {
        case 'intent': {
          const result: IntentDraft = await this.intent.parse(job.ownerId, id, job.payload as ParseRequest);
          await this.storage.updateJob(id, { result, status: 'succeeded', progress: 100, message: '条件草稿已生成，请确认' });
          break;
        }
        case 'refresh': await this.initialize(job); break;
        case 'valuation': await this.valuation(job); break;
        case 'stock': await this.stock(job); break;
        case 'finalize': await this.finalize(job); break;
        case 'monitor': {
          const payload = job.payload as MonitorPayload;
          await this.monitors.check(job.ownerId, payload.monitorId, 'schedule', payload.checkId, payload.forcedStatus);
          await this.done(job.id);
          break;
        }
        default: throw new Error('未知任务类型');
      }
    } catch (error: unknown) {
      const message: string = error instanceof FuyaoError ? error.message
        : job.kind === 'intent' ? '智能解析未完成，请重试或使用手动条件' : '数据任务未完成，保留已有结果';
      this.logger.error({ jobId: id, kind: job.kind, errorType: error instanceof Error ? error.name : 'unknown',
        message, stack: error instanceof Error ? error.stack?.split('\n').slice(1, 5).join('\n') : undefined });
      await this.storage.updateJob(id, { status: 'failed', message });
      const parentId: string | undefined = job.kind === 'refresh' ? id : (job.payload as Partial<ChildPayload>).parentId;
      if (parentId) {
        await this.storage.updateJob(parentId, { status: 'failed', message });
        await this.storage.releaseLock('market-refresh', parentId);
        await this.queueMonitors(parentId, 'failed');
      }
    }
  }
  /** Platform recovery trigger; never run during startup or a browser status request. */
  async recover(): Promise<number> {
    const jobs: JobRow[] = await this.storage.unfinishedJobs();
    // One bounded unit per invocation; prefer an outstanding child over its waiting parent.
    const job: JobRow | undefined = jobs.find((item: JobRow) => item.kind !== 'refresh') ?? jobs[0];
    if (job) await this.work(job.id);
    return job ? 1 : 0;
  }
  private async done(id: string): Promise<void> {
    await this.storage.updateJob(id, { status: 'succeeded', progress: 100, message: '完成' });
  }
  private async initialize(job: JobRow): Promise<void> {
    const payload = job.payload as RefreshPayload;
    if (!payload.universe) payload.universe = await this.fuyao.universe(new Date(job.createdMs));
    if (payload.source === 'schedule' && payload.universe.marketClosed) {
      await this.queueMonitors(job.id, 'closed');
      await this.storage.updateJob(job.id, { status: 'succeeded', progress: 100, message: '今日休市，无新交易日' });
      await this.storage.releaseLock('market-refresh', job.id);
      return;
    }
    await this.advance(job.id, payload, payload.next ?? { kind: 'valuation', index: 0 }, 0);
  }
  private async parent(job: JobRow): Promise<{ row: JobRow; data: RefreshPayload } | null> {
    const payload = job.payload as ChildPayload;
    const row: JobRow = await this.storage.getJob(payload.parentId);
    if (row.status === 'failed' || row.status === 'succeeded') { await this.done(job.id); return null; }
    const data = row.payload as RefreshPayload;
    if (data.next?.kind !== job.kind || data.next.index !== payload.index) {
      await this.done(job.id);
      return null;
    }
    if (!await this.storage.acquireLock('market-refresh', row.id, 7200000)) throw new Error('刷新锁已失效');
    return { row, data };
  }
  private async advance(
    parentId: string, payload: RefreshPayload, next: NonNullable<RefreshPayload['next']>, progress: number,
  ): Promise<void> {
    await this.storage.updateJob(parentId, { status: 'running', payload: { ...payload, next },
      progress, leaseUntilMs: Date.now() + 120000,
      message: next.kind === 'stock' ? `正在核对股票 ${next.index + 1}/300`
        : next.kind === 'valuation' ? '正在取得估值数据' : '正在完成数据核对' });
    await this.enqueue(stableId(parentId, `${next.kind}:${next.index}`), next.kind, SHARED_OWNER,
      { parentId, index: next.index } satisfies ChildPayload);
  }
  private async valuation(job: JobRow): Promise<void> {
    const parent = await this.parent(job);
    if (!parent) return;
    const { row, data } = parent;
    const index: number = (job.payload as ChildPayload).index;
    const members = data.universe!.members.slice(index * 100, (index + 1) * 100);
    let values: NonNullable<RefreshPayload['valuations']>;
    try { values = await this.fuyao.valuations(members.map((member) => member.code)); }
    catch (error: unknown) {
      const reason: string = error instanceof FuyaoError ? error.message : '估值数据本批次不可用';
      values = Object.fromEntries(members.map((member) => {
        const empty = this.fuyao.emptyStock(member, reason);
        return [member.code, { pe_ttm: empty.metrics.pe_ttm, pb_mrq: empty.metrics.pb_mrq }];
      }));
      if (error instanceof FuyaoError && !error.retryable && error.code !== 5003) data.blockedReason = reason;
    }
    data.valuations = { ...data.valuations, ...values };
    await this.advance(row.id, data, index < 2 && !data.blockedReason
      ? { kind: 'valuation', index: index + 1 } : { kind: 'stock', index: 0 }, 1);
    await this.done(job.id);
  }
  private async stock(job: JobRow): Promise<void> {
    const parent = await this.parent(job);
    if (!parent) return;
    const { row, data } = parent;
    const index: number = (job.payload as ChildPayload).index;
    const member = data.universe!.members[index];
    const stockId: string = stableId(row.id, member.code);
    if (!await this.storage.objectExists(stockId, 'stock', SHARED_OWNER)) {
      let facts: StockFacts;
      try {
        facts = data.blockedReason ? this.fuyao.emptyStock(member, data.blockedReason)
          : await this.fuyao.stock(member, data.universe!, new Date(row.createdMs), data.valuations?.[member.code]);
      } catch (error: unknown) {
        if (!(error instanceof FuyaoError)) throw error;
        data.blockedReason = error.message;
        facts = this.fuyao.emptyStock(member, error.message);
      }
      await this.storage.insertObject(stockId, 'stock', SHARED_OWNER, facts, row.id);
    }
    await this.advance(row.id, data, index < 299
      ? { kind: 'stock', index: index + 1 } : { kind: 'finalize', index: 0 },
    Math.floor((index + 1) / 300 * 98) + 1);
    await this.done(job.id);
  }
  private async finalize(job: JobRow): Promise<void> {
    const parent = await this.parent(job);
    if (!parent) return;
    const { row, data } = parent;
    const stocks: StockFacts[] = await this.storage.listObjects('stock', SHARED_OWNER, row.id, 301);
    if (stocks.length !== 300 || new Set(stocks.map((stock) => stock.code)).size !== 300) {
      throw new Error('股票池不完整');
    }
    const errorCount: number = stocks.filter((stock) => stock.errors.length > 0).length;
    const available: boolean = stocks.some((stock) => Object.values(stock.metrics).some((metric) => metric.status === 'available'));
    const staleValuations: number = stocks.filter((stock) => {
      const timestamp: string | null = stock.metrics.pe_ttm.sourceTimestamp;
      return timestamp && chinaDay(timestamp) < data.universe!.quoteDate;
    }).length;
    const summary: SnapshotSummary = {
      id: row.id, universeVersion: data.universe!.universeVersion, universeName: '沪深300',
      memberCount: 300, quoteDate: data.universe!.quoteDate, fetchedAt: new Date().toISOString(),
      status: !available ? 'failed' : errorCount ? 'partial' : 'ready',
      completedCount: 300, errorCount, marketClosed: data.universe!.marketClosed,
      warnings: [
        ...(errorCount ? [`${errorCount}只股票存在取数异常，相关指标显示待核实`] : []),
        ...(process.env.FUYAO_CUMULATIVE_VERIFIED !== 'true' ? ['财报累计口径尚未完成实源核验，财务同比暂不可用'] : []),
        ...(staleValuations ? [`${staleValuations}只股票所在估值响应的最大时间早于目标行情日，估值可能过时`] : []),
        '估值接口仅提供响应级最大时间，个股字段时间不完全可知',
      ],
    };
    if (available) await this.storage.insertObject(row.id, 'snapshot', SHARED_OWNER, summary);
    await this.queueMonitors(row.id, available ? undefined : 'failed');
    await this.storage.updateJob(row.id, { result: summary, progress: 100,
      status: available ? 'succeeded' : 'failed', message: available ? '数据版本已就绪' : '所有指标不可用，保留上个数据版本' });
    await this.storage.releaseLock('market-refresh', row.id);
    await this.done(job.id);
    await this.storage.pruneSnapshots();
  }
  private async queueMonitors(checkId: string, forcedStatus?: 'closed' | 'failed'): Promise<void> {
    const rows: ObjectRow[] = await this.storage.objectRows('monitor');
    for (const row of rows) {
      if (!(row.payload as StoredMonitor).enabled) continue;
      await this.enqueue(stableId(checkId, `monitor-job:${row.id}`), 'monitor', row.ownerId,
        { monitorId: row.id, checkId, forcedStatus } satisfies MonitorPayload);
    }
  }
}
