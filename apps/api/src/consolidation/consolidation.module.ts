import { Module } from '@nestjs/common';
import { ConfigurationModule } from '../configuration/configuration.module';
import { ConsolidationConfigController } from './consolidation-config.controller';
import { ConsolidationController } from './consolidation.controller';
import { ConsolidationService } from './consolidation.service';

/** CFS workspace (page 9) and its configuration: intercompany pairs, acquisitions register. */
@Module({
  imports: [ConfigurationModule],
  controllers: [ConsolidationController, ConsolidationConfigController],
  providers: [ConsolidationService],
})
export class ConsolidationModule {}
