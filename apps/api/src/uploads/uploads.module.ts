import { Module } from '@nestjs/common';
import { ChartOfAccountsService } from './chart-of-accounts.service';
import { MappingController } from './mapping.controller';
import { MappingStepService } from './mapping-step.service';
import { RatesService } from './rates.service';
import { UploadStepService } from './upload-step.service';
import { UploadsController } from './uploads.controller';

/** SFS workspace: step 1 "Upload data" (page 3), step 2 "Review and map" (page 4), and rates. */
@Module({
  controllers: [UploadsController, MappingController],
  providers: [UploadStepService, RatesService, MappingStepService, ChartOfAccountsService],
})
export class UploadsModule {}
