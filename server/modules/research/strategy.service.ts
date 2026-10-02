import { BadRequestException, ConflictException, Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type {
  CompareRequest, LoadVersionResponse, RunComparison, SavedVersion, SaveStrategyRequest,
  ScreenRequest, ScreenRun, StockCompareResponse,
} from '../../../shared/api.interface';
import { detectConflicts, saveRequestSchema, screenRequestSchema } from '../../../shared/validation';
import { StorageService } from './storage.service';
import { DatasetService } from './dataset.service';
import { conditionEffects, screen } from './screening';
import { validate } from './research-utils';

@Injectable()
export class StrategyService {
  constructor(
    @Inject(StorageService) private readonly storage: StorageService,
    @Inject(DatasetService) private readonly datasets: DatasetService,
  ) {}
  async execute(ownerId: string, input: ScreenRequest): Promise<ScreenRun> {
    const request = validate(screenRequestSchema, input);
    const conflicts = detectConflicts(request.conditions);
    if (conflicts.length) throw new BadRequestException(conflicts.map((item) => item.message).join('；'));
    const snapshot = await this.datasets.load(request.snapshotId);
    if (snapshot.universeVersion !== request.universeVersion) throw new BadRequestException('股票池版本不匹配');
    const hour: number = Math.floor(Date.now() / 3600000);
    await this.storage.consumeLimit(`screen:${ownerId}:${hour}`, 100, (hour + 1) * 3600000);
    const run: ScreenRun = screen(snapshot, request.conditions, randomUUID(), new Date().toISOString(), request.intent);
    await this.storage.insertObject(run.id, 'run', ownerId, run, snapshot.id);
    return run;
  }
  async run(ownerId: string, id: string): Promise<ScreenRun> {
    return this.storage.getObject(validate(z.uuid(), id), 'run', ownerId);
  }
  async compare(ownerId: string, input: CompareRequest): Promise<RunComparison> {
    const request = validate(z.object({ beforeRunId: z.uuid(), afterRunId: z.uuid() }).strict(), input);
    const before: ScreenRun = await this.run(ownerId, request.beforeRunId);
    const after: ScreenRun = await this.run(ownerId, request.afterRunId);
    if (before.snapshot.id !== after.snapshot.id) throw new BadRequestException('请固定同一数据快照后比较条件影响');
    return conditionEffects(await this.datasets.load(before.snapshot.id), before, after);
  }
  async compareStocks(ownerId: string, runId: string, codes: string[]): Promise<StockCompareResponse> {
    validate(z.array(z.string().regex(/^\d{6}\.(SH|SZ)$/)).min(1).max(3)
      .refine((items) => new Set(items).size === items.length), codes);
    const run: ScreenRun = await this.run(ownerId, runId);
    const snapshot = await this.datasets.load(run.snapshot.id);
    const stocks = codes.map((code: string) => snapshot.stocks.find((stock) => stock.code === code));
    if (stocks.some((stock) => !stock)) throw new BadRequestException('股票不在当前快照内');
    return { snapshot: run.snapshot, stocks: stocks.filter((stock) => !!stock),
      results: run.results.filter((stock) => codes.includes(stock.code)) };
  }
  async save(ownerId: string, input: SaveStrategyRequest): Promise<SavedVersion> {
    const request = validate(saveRequestSchema, input);
    const run: ScreenRun = await this.run(ownerId, request.runId);
    const strategyId: string = request.strategyId ?? randomUUID();
    if (request.strategyId) await this.storage.getObject(strategyId, 'strategy', ownerId);
    const holder: string = randomUUID();
    if (!await this.storage.acquireLock(`strategy:${strategyId}`, holder, 30000)) {
      throw new ConflictException('策略正在保存，请稍后再试');
    }
    try {
      const revision: number = await this.storage.latestRevision(strategyId, ownerId) + 1;
      if (revision > 50) throw new BadRequestException('单个策略最多保存50个版本');
      const version: SavedVersion = {
        id: randomUUID(), strategyId, version: revision, name: request.name,
        intent: run.intent, runId: run.id, createdAt: new Date().toISOString(),
        conditions: run.conditions, snapshot: run.snapshot,
      };
      if (!request.strategyId) {
        const strategies = await this.storage.listObjects('strategy', ownerId, undefined, 21);
        if (strategies.length >= 20) throw new BadRequestException('当前访客最多保存20个策略');
        await this.storage.insertObject(strategyId, 'strategy', ownerId, { id: strategyId, name: request.name });
      }
      await this.storage.insertObject(version.id, 'version', ownerId, version, strategyId, revision);
      return version;
    } finally { await this.storage.releaseLock(`strategy:${strategyId}`, holder); }
  }
  async versions(ownerId: string): Promise<SavedVersion[]> {
    return this.storage.listObjects('version', ownerId, undefined, 1000);
  }
  async loadVersion(ownerId: string, id: string): Promise<LoadVersionResponse> {
    const version: SavedVersion = await this.storage.getObject(validate(z.uuid(), id), 'version', ownerId);
    return { version, run: await this.run(ownerId, version.runId) };
  }
}
