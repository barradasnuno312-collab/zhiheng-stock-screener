import {
  Body, Controller, Get, Inject, NotFoundException, Param, Patch, Post, Req, Res, UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type {
  AccessRequest, AccessSession, CatalogResponse, CompareRequest, CreateMonitorRequest, JobStatus,
  LoadVersionResponse, Monitor, MonitorEvent, ParseRequest, RunComparison, SavedVersion,
  SaveStrategyRequest, ScreenRequest, ScreenRun, StockCompareResponse, ToggleMonitorRequest, RecoveryResponse,
} from '../../../shared/api.interface';
import { METRICS, RULES_VERSION } from '../../../shared/metric-catalog';
import { AccessService, SessionGuard } from './access.service';
import { DatasetService } from './dataset.service';
import { FuyaoService } from './fuyao.service';
import { JobService } from './job.service';
import { StrategyService } from './strategy.service';
import { MonitorService } from './monitor.service';
import { validate } from './research-utils';
import { parseRequestSchema } from '../../../shared/validation';

@Controller('api/access')
export class AccessController {
  constructor(@Inject(AccessService) private readonly access: AccessService) {}
  @Get('session')
  session(@Req() req: Request): Promise<AccessSession> { return this.access.session(req); }
  @Post('verify')
  verify(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Body() body: AccessRequest): Promise<AccessSession> {
    const input = validate(z.object({ code: z.string().min(1).max(128) }).strict(), body);
    return this.access.login(req, res, input.code);
  }
  @Post('logout')
  logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<AccessSession> {
    return this.access.logout(req, res);
  }
}

// Access-code sessions are the approved identity boundary. No ownerId is accepted from a client.
@Controller('api/research')
@UseGuards(SessionGuard)
export class ResearchController {
  constructor(
    @Inject(AccessService) private readonly access: AccessService,
    @Inject(DatasetService) private readonly datasets: DatasetService,
    @Inject(FuyaoService) private readonly fuyao: FuyaoService,
    @Inject(JobService) private readonly jobs: JobService,
    @Inject(StrategyService) private readonly strategies: StrategyService,
    @Inject(MonitorService) private readonly monitors: MonitorService,
  ) {}
  @Get('catalog')
  async catalog(): Promise<CatalogResponse> {
    return { metrics: METRICS, rulesVersion: RULES_VERSION, snapshot: await this.datasets.latest(),
      dataConfigured: this.fuyao.configured, aiConfigured: process.env.ZH_AI_ENABLED === 'true',
      scheduleEnabled: process.env.ZH_SCHEDULE_ENABLED === 'true' };
  }
  @Post('intent')
  parse(@Req() req: Request, @Body() body: ParseRequest): Promise<JobStatus> {
    return this.jobs.parse(this.access.owner(req), validate(parseRequestSchema, body));
  }
  @Get('jobs/:id')
  job(@Req() req: Request, @Param('id') id: string): Promise<JobStatus> {
    return this.jobs.status(validate(z.uuid(), id), this.access.owner(req));
  }
  @Post('runs')
  execute(@Req() req: Request, @Body() body: ScreenRequest): Promise<ScreenRun> {
    return this.strategies.execute(this.access.owner(req), body);
  }
  @Post('compare')
  compare(@Req() req: Request, @Body() body: CompareRequest): Promise<RunComparison> {
    return this.strategies.compare(this.access.owner(req), body);
  }
  @Get('runs/:id')
  run(@Req() req: Request, @Param('id') id: string): Promise<ScreenRun> {
    return this.strategies.run(this.access.owner(req), id);
  }
  @Post('runs/:id/stocks')
  stocks(@Req() req: Request, @Param('id') id: string, @Body() body: { codes: string[] }): Promise<StockCompareResponse> {
    const input = validate(z.object({ codes: z.array(z.string()).min(1).max(3) }).strict(), body);
    return this.strategies.compareStocks(this.access.owner(req), id, input.codes);
  }
  @Get('versions')
  versions(@Req() req: Request): Promise<SavedVersion[]> { return this.strategies.versions(this.access.owner(req)); }
  @Post('versions')
  save(@Req() req: Request, @Body() body: SaveStrategyRequest): Promise<SavedVersion> {
    return this.strategies.save(this.access.owner(req), body);
  }
  @Get('versions/:id')
  version(@Req() req: Request, @Param('id') id: string): Promise<LoadVersionResponse> {
    return this.strategies.loadVersion(this.access.owner(req), id);
  }
  @Get('monitors')
  listMonitors(@Req() req: Request): Promise<Monitor[]> { return this.monitors.list(this.access.owner(req)); }
  @Post('monitors')
  createMonitor(@Req() req: Request, @Body() body: CreateMonitorRequest): Promise<Monitor> {
    const input = validate(z.object({ versionId: z.uuid() }).strict(), body);
    return this.monitors.create(this.access.owner(req), input.versionId);
  }
  @Patch('monitors/:id')
  toggle(@Req() req: Request, @Param('id') id: string, @Body() body: ToggleMonitorRequest): Promise<Monitor> {
    const input = validate(z.object({ enabled: z.boolean() }).strict(), body);
    return this.monitors.toggle(this.access.owner(req), validate(z.uuid(), id), input.enabled);
  }
  @Post('monitors/:id/check')
  check(@Req() req: Request, @Param('id') id: string): Promise<MonitorEvent | null> {
    return this.monitors.check(this.access.owner(req), validate(z.uuid(), id), 'manual', randomUUID());
  }
}

@Controller('api/maintenance')
export class MaintenanceController {
  constructor(
    @Inject(AccessService) private readonly access: AccessService,
    @Inject(JobService) private readonly jobs: JobService,
  ) {}
  @Post('refresh')
  refresh(@Req() req: Request): Promise<JobStatus> {
    this.access.requireAdmin(req);
    return this.jobs.refresh('manual');
  }
  @Post('recover')
  async recover(@Req() req: Request): Promise<RecoveryResponse> {
    this.access.requireAdmin(req);
    return { processed: await this.jobs.recover() };
  }
  @Get('jobs/:id')
  status(@Req() req: Request, @Param('id') id: string): Promise<JobStatus> {
    this.access.requireAdmin(req);
    return this.jobs.status(validate(z.uuid(), id));
  }
  @Post('development/work/:id')
  async work(@Req() req: Request, @Param('id') id: string): Promise<{ processed: boolean }> {
    if (process.env.NODE_ENV !== 'development') throw new NotFoundException();
    this.access.requireAdmin(req);
    await this.jobs.work(validate(z.uuid(), id));
    return { processed: true };
  }
}
