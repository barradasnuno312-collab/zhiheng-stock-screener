import { Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { isAxiosError } from 'axios';
import { firstValueFrom } from 'rxjs';
import { randomUUID, createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import type { MetricEvidence, MetricId, StockFacts } from '../../../shared/api.interface';
import { METRICS } from '../../../shared/metric-catalog';
import {
  chinaDay, completedTradingDays, emptyEvidence, financialMetrics, normalizePrices,
  normalizeReports, numeric, priceMetrics, valuationMetric,
} from './metrics';
import type { SourceMeta } from './metrics';
import { StorageService } from './storage.service';
import { decodeResponse, FuyaoError } from './source-contract';
import type { SourceResponse } from './source-contract';

export const SOURCE_ENDPOINTS = {
  calendar: '/api/a-share/calendar/trading-days',
  universe: '/api/a-share-index/constituents/ths-stock-list',
  valuation: '/api/a-share/valuations/snapshot',
  prices: '/api/a-share/prices/historical',
  income: '/api/a-share/financials/income-statements',
} as const;
export interface UniverseMember { code: string; name: string }
export interface UniverseData {
  members: UniverseMember[];
  tradingDays: string[];
  universeVersion: string;
  quoteDate: string;
  marketClosed: boolean;
  universeSource: SourceMeta;
  calendarSource: SourceMeta;
}
@Injectable()
export class FuyaoService {
  constructor(
    @Inject(HttpService) private readonly http: HttpService,
    @Inject(StorageService) private readonly storage: StorageService,
  ) {}
  get configured(): boolean { return !!process.env.FUYAO_API_KEY?.trim(); }

  private async throttle(): Promise<void> {
    const holder: string = randomUUID();
    for (let attempt = 0; attempt < 40; attempt += 1) {
      if (await this.storage.acquireLock('fuyao-request-spacing', holder, 550)) return;
      await delay(200);
    }
    throw new ServiceUnavailableException('数据请求繁忙，请稍后重试');
  }
  async request(endpoint: string, params: Record<string, string | number> = {}): Promise<SourceResponse> {
    if (!this.configured) throw new ServiceUnavailableException('尚未配置扶摇数据访问密钥');
    if (!Object.values(SOURCE_ENDPOINTS).includes(endpoint as typeof SOURCE_ENDPOINTS[keyof typeof SOURCE_ENDPOINTS])) {
      throw new Error('数据接口不在白名单内');
    }
    for (let attempt = 0; attempt <= 2; attempt += 1) {
      await this.throttle();
      try {
        const response = await firstValueFrom(this.http.get<unknown>(
          `https://fuyao.aicubes.cn${endpoint}`, {
            params, headers: { 'X-api-key': process.env.FUYAO_API_KEY },
            timeout: 6000, maxRedirects: 0, maxContentLength: 5 * 1024 * 1024,
          },
        ));
        return decodeResponse(response.data, endpoint, new Date().toISOString());
      } catch (error: unknown) {
        // Never log Axios errors: their config may contain the API key.
        const safeError: FuyaoError = error instanceof FuyaoError ? error
          : new FuyaoError(isAxiosError(error) ? error.response?.status ?? 5002 : 5003,
            isAxiosError(error) && (!error.response || error.response.status === 429 || error.response.status >= 500),
            null);
        if (!safeError.retryable || attempt === 2) throw safeError;
        await delay(1000 * 2 ** attempt);
      }
    }
    throw new FuyaoError(5003, false, null);
  }
  async universe(now = new Date()): Promise<UniverseData> {
    const calendar: SourceResponse = await this.request(SOURCE_ENDPOINTS.calendar);
    const sourceDays: string[] = calendar.items.map((row: Record<string, unknown>) => {
      const timestamp: number | null = numeric(row.date_ms);
      if (!timestamp) throw new Error('交易日历缺少有效时间');
      const day: string = chinaDay(timestamp);
      if (row.date !== day.replaceAll('-', '')) throw new Error('交易日历日期与时间戳不一致');
      return day;
    });
    const tradingDays: string[] = completedTradingDays(sourceDays, now);
    if (tradingDays.length < 61) throw new Error('交易日历不足61个已完成交易日');
    const universe: SourceResponse = await this.request(SOURCE_ENDPOINTS.universe, { thscode: '000300.SH' });
    const members: UniverseMember[] = universe.items.map((row: Record<string, unknown>) => {
      if (typeof row.thscode !== 'string' || !/^\d{6}\.(SH|SZ)$/.test(row.thscode)) {
        throw new Error('沪深300成分代码无效');
      }
      return { code: row.thscode, name: typeof row.name === 'string' && row.name ? row.name : row.thscode };
    }).sort((a: UniverseMember, b: UniverseMember) => a.code.localeCompare(b.code));
    if (members.length !== 300 || new Set(members.map((item: UniverseMember) => item.code)).size !== 300) {
      throw new Error(`成分股接口返回${members.length}条，尚不能确认完整沪深300股票池`);
    }
    return {
      members, tradingDays, quoteDate: tradingDays.at(-1)!,
      marketClosed: !sourceDays.includes(chinaDay(now)),
      universeVersion: createHash('sha256').update(members.map((item) => item.code).join(',')).digest('hex').slice(0, 20),
      universeSource: universe.meta, calendarSource: calendar.meta,
    };
  }
  async valuations(codes: string[]): Promise<Record<string, Pick<StockFacts['metrics'], 'pe_ttm' | 'pb_mrq'>>> {
    const result: Record<string, Pick<StockFacts['metrics'], 'pe_ttm' | 'pb_mrq'>> = {};
    for (let i = 0; i < codes.length; i += 100) {
      const batch: string[] = codes.slice(i, i + 100);
      const response: SourceResponse = await this.request(SOURCE_ENDPOINTS.valuation, { thscodes: batch.join(',') });
      const byCode = new Map(response.items.map((row: Record<string, unknown>) => [row.thscode, row]));
      for (const code of batch) {
        const row = byCode.get(code);
        result[code] = {
          pe_ttm: valuationMetric('pe_ttm', row?.pe_ttm, response.meta),
          pb_mrq: valuationMetric('pb_mrq', row?.pb_mrq, response.meta),
        };
      }
    }
    return result;
  }
  emptyStock(member: UniverseMember, reason: string): StockFacts {
    const metrics = Object.fromEntries(METRICS.map((metric) => [metric.id, emptyEvidence(metric.id, {
      endpoint: '', requestId: null, fetchedAt: new Date().toISOString(), timestamp: null,
    }, reason)])) as Record<MetricId, MetricEvidence>;
    return { ...member, metrics, prices: [], errors: [reason] };
  }
  async stock(
    member: UniverseMember, universe: UniverseData, asOf: Date,
    valuation: Pick<StockFacts['metrics'], 'pe_ttm' | 'pb_mrq'> | undefined,
  ): Promise<StockFacts> {
    const result: StockFacts = this.emptyStock(member, '数据尚未返回');
    result.errors = [];
    if (valuation) Object.assign(result.metrics, valuation);
    if (!valuation || Object.values(valuation).some((metric) => metric.status === 'missing' || metric.status === 'error')) {
      result.errors.push('估值字段缺失或本批次取数失败');
    }
    try {
      const response: SourceResponse = await this.request(SOURCE_ENDPOINTS.income, {
        thscode: member.code, period: 'quarterly', limit: 12,
      });
      if (response.items.some((row) => row.thscode !== member.code)) throw new Error('财务响应股票代码不匹配');
      Object.assign(result.metrics, financialMetrics(
        normalizeReports(response.items), response.meta, asOf, process.env.FUYAO_CUMULATIVE_VERIFIED === 'true',
      ));
    } catch (error: unknown) {
      if (error instanceof FuyaoError && !error.retryable && error.code !== 5003) throw error;
      const reason = error instanceof Error ? error.message : '财务数据失败';
      result.errors.push(reason);
      for (const id of ['revenue_yoy_pct', 'revenue_yoy_delta_pp', 'parent_profit_yoy_pct'] as const) {
        result.metrics[id] = { ...result.metrics[id], status: 'error', reason, sourceEndpoint: SOURCE_ENDPOINTS.income };
      }
    }
    try {
      const response: SourceResponse = await this.request(SOURCE_ENDPOINTS.prices, {
        thscode: member.code, interval: '1d', adjust: 'forward',
        start: new Date(`${universe.tradingDays.at(-70) ?? universe.tradingDays[0]}T00:00:00+08:00`).getTime(),
        end: new Date(`${universe.quoteDate}T23:59:59+08:00`).getTime(),
      });
      result.prices = normalizePrices(response.items).filter((point) => point.date <= universe.quoteDate);
      Object.assign(result.metrics, priceMetrics(result.prices, universe.tradingDays, response.meta));
    } catch (error: unknown) {
      if (error instanceof FuyaoError && !error.retryable && error.code !== 5003) throw error;
      const reason = error instanceof Error ? error.message : '历史行情数据失败';
      result.errors.push(reason);
      for (const id of ['volatility_60d_pct', 'max_drawdown_60d_pct', 'avg_turnover_20d_cny'] as const) {
        result.metrics[id] = { ...result.metrics[id], status: 'error', reason, sourceEndpoint: SOURCE_ENDPOINTS.prices };
      }
    }
    return result;
  }
}
