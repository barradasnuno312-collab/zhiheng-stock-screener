import { BadRequestException, Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import type { DatasetSnapshot, SnapshotSummary, StockFacts } from '../../../shared/api.interface';
import { StorageService } from './storage.service';
import { SHARED_OWNER } from './research-utils';

@Injectable()
export class DatasetService {
  constructor(@Inject(StorageService) private readonly storage: StorageService) {}
  async latest(): Promise<SnapshotSummary | null> {
    const snapshots: SnapshotSummary[] = await this.storage.listObjects('snapshot', SHARED_OWNER, undefined, 1);
    return snapshots[0] ?? null;
  }
  async load(id: string): Promise<DatasetSnapshot> {
    const summary: SnapshotSummary = await this.storage.getObject(id, 'snapshot', SHARED_OWNER);
    if (!['ready', 'partial'].includes(summary.status)) throw new ServiceUnavailableException('数据尚未就绪');
    const stocks: StockFacts[] = await this.storage.listObjects('stock', SHARED_OWNER, id, 301);
    if (stocks.length !== 300 || summary.memberCount !== 300) {
      throw new BadRequestException('当前快照股票池不完整，无法筛选');
    }
    return { ...summary, stocks };
  }
}
