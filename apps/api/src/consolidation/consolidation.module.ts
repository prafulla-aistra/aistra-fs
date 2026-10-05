import { Module } from '@nestjs/common';
import { ConfigurationModule } from '../configuration/configuration.module';
import { UploadsModule } from '../uploads/uploads.module';
import { CfsLevelController } from './cfs-level.controller';
import { CfsLevelService } from './cfs-level.service';
import { ConsolidationConfigController } from './consolidation-config.controller';
import { ConsolidationController } from './consolidation.controller';
import { ConsolidationService } from './consolidation.service';

/** CFS workspace (pages 9–10): levels, eliminations, statements, notes, review; configuration. */
@Module({
  imports: [ConfigurationModule, UploadsModule],
  controllers: [ConsolidationController, ConsolidationConfigController, CfsLevelController],
  providers: [ConsolidationService, CfsLevelService],
})
export class ConsolidationModule {}
