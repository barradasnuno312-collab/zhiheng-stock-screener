import { Inject, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { CapabilityService } from '@lark-apaas/fullstack-nestjs-core';
import type { IntentDraft, ParseRequest } from '../../../shared/api.interface';
import { METRICS, RULES_VERSION } from '../../../shared/metric-catalog';
import { draftSchema, parseRequestSchema } from '../../../shared/validation';
import { chinaDay } from './metrics';
import { StorageService } from './storage.service';
import { stableId } from './research-utils';

@Injectable()
export class IntentService {
  private readonly logger = new Logger(IntentService.name);
  constructor(
    @Inject(CapabilityService) private readonly capability: CapabilityService,
    @Inject(StorageService) private readonly storage: StorageService,
  ) {}
  async reserve(ownerId: string, input: ParseRequest): Promise<ParseRequest> {
    if (process.env.ZH_AI_ENABLED !== 'true') throw new ServiceUnavailableException('智能解析暂不可用，可手动编辑条件');
    const checked: ParseRequest = parseRequestSchema.parse(input);
    const day: string = chinaDay(new Date());
    const expires: number = new Date(`${day}T23:59:59.999+08:00`).getTime();
    await this.storage.consumeLimit(`ai-user:${ownerId}:${day}`, 10, expires);
    await this.storage.consumeLimit(`ai-global:${day}`, 100, expires);
    return checked;
  }
  async parse(ownerId: string, requestId: string, input: ParseRequest): Promise<IntentDraft> {
    const checked: ParseRequest = parseRequestSchema.parse(input);
    const invocationId: string = stableId(requestId, 'invocation');
    if (await this.storage.objectExists(invocationId, 'invocation', ownerId)) {
      const prior = await this.storage.getObject<{ status: string; draft?: IntentDraft }>(
        invocationId, 'invocation', ownerId,
      );
      if (prior.status === 'succeeded' && prior.draft) return draftSchema.parse(prior.draft);
      throw new Error('本次解析未成功，请新建解析任务或手动编辑条件');
    }
    const started: number = Date.now();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      // Contract: docs/plugin-contract.md, hydrated from installed plugin 1.0.26.
      const output: unknown = await Promise.race([
        this.capability.load('zh-intent-parser').call('textToJson', {
          text: checked.text, catalog: JSON.stringify(METRICS), previous: JSON.stringify(checked.previousConditions),
        }),
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(() => reject(new Error('解析超过15秒，请重试或手动编辑条件')), 15000);
        }),
      ]);
      const validated = draftSchema.safeParse(output);
      if (!validated.success) {
        this.logger.warn({
          pluginInstanceId: 'zh-intent-parser', actionKey: 'textToJson', outputMode: 'unary',
          inputKeys: ['text', 'catalog', 'previous'], resultType: typeof output,
          resultKeys: output && typeof output === 'object' ? Object.keys(output) : [],
          error: 'Output schema validation failed',
        });
        throw new Error('模型返回的条件未通过指标、单位或范围校验，请重试或手动编辑');
      }
      await this.storage.insertObject(invocationId, 'invocation', ownerId, {
        requestId, promptVersion: RULES_VERSION, modelId: '2015', durationMs: Date.now() - started,
        status: 'succeeded', draft: validated.data,
      });
      return validated.data;
    } catch (error: unknown) {
      const message: string = error instanceof Error && [
        '解析超过15秒，请重试或手动编辑条件',
        '模型返回的条件未通过指标、单位或范围校验，请重试或手动编辑',
      ].includes(error.message) ? error.message : '模型服务未完成解析，请重试或手动编辑条件';
      this.logger.error({
        pluginInstanceId: 'zh-intent-parser', actionKey: 'textToJson', outputMode: 'unary',
        inputKeys: ['text', 'catalog', 'previous'], error: message,
      });
      await this.storage.insertObject(invocationId, 'invocation', ownerId, {
        requestId, promptVersion: RULES_VERSION, modelId: '2015', durationMs: Date.now() - started,
        status: 'failed', error: message,
      });
      throw new Error(message);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }
}
