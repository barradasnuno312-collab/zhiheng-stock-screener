import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { StorageService } from './storage.service';
import { FuyaoService } from './fuyao.service';
import { IntentService } from './intent.service';
import { AccessService, SessionGuard } from './access.service';
import { DatasetService } from './dataset.service';
import { StrategyService } from './strategy.service';
import { MonitorService } from './monitor.service';
import { JobService } from './job.service';
import { AccessController, MaintenanceController, ResearchController } from './research.controller';
import { ResearchAutomation } from './research.automation';

@Module({
  // An isolated HTTP client keeps API-key headers out of the template's development request logger.
  imports: [HttpModule.register({ timeout: 6000, maxRedirects: 0 })],
  controllers: [AccessController, ResearchController, MaintenanceController],
  providers: [
    StorageService, FuyaoService, IntentService, AccessService, SessionGuard, DatasetService,
    StrategyService, MonitorService, JobService, ResearchAutomation,
  ],
  exports: [StorageService, FuyaoService, IntentService],
})
export class ResearchModule {}
