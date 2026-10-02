import { Inject, Logger } from '@nestjs/common';
import { Automation, BindTrigger } from '@lark-apaas/fullstack-nestjs-core';
import { z } from 'zod';
import { JobService } from './job.service';

interface TaskHandlerArgs {
  attributes: { trigger: string; triggerType: 'record_change' | 'cron' | 'webhook'; instanceID: string };
  content: { input: string };
}
@Automation()
export class ResearchAutomation {
  private readonly logger = new Logger(ResearchAutomation.name);
  constructor(@Inject(JobService) private readonly jobs: JobService) {}

  @BindTrigger('zhResearchJob')
  async handleJob(event: TaskHandlerArgs): Promise<void> {
    if (typeof event.content?.input !== 'string') throw new Error('任务事件缺少输入');
    let raw: unknown;
    try { raw = JSON.parse(event.content.input) as unknown; }
    catch { throw new Error('任务事件JSON无效'); }
    const parsed = z.object({
      table: z.literal('zh_jobs'), type: z.literal('INSERT'), after: z.object({ id: z.uuid() }),
    }).safeParse(raw);
    if (!parsed.success) throw new Error('任务事件结构无效');
    this.logger.log({ event: 'job-trigger', jobId: parsed.data.after.id });
    await this.jobs.work(parsed.data.after.id);
  }
  @BindTrigger('zhDailyMonitor')
  async dailyMonitor(): Promise<void> {
    if (process.env.ZH_SCHEDULE_ENABLED !== 'true') return;
    this.logger.log({ event: 'daily-monitor-trigger' });
    await this.jobs.refresh('schedule');
  }
  @BindTrigger('zhRecovery')
  async recover(): Promise<void> {
    this.logger.log({ event: 'recovery-trigger', processed: await this.jobs.recover() });
  }
}
