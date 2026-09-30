import { Module } from '@nestjs/common';
import { ChartOfAccountsService } from './chart-of-accounts.service';
import { ComparativeSourceService } from './comparative-source.service';
import { ComparativesController } from './comparatives.controller';
import { ComparativesService } from './comparatives.service';
import { MappingController } from './mapping.controller';
import { MappingStepService } from './mapping-step.service';
import { RatesService } from './rates.service';
import { TranslationController } from './translation.controller';
import { TranslationService } from './translation.service';
import { UploadStepService } from './upload-step.service';
import { UploadsController } from './uploads.controller';

/** SFS workspace: step 1 "Upload data" (page 3), step 2 "Review and map" (page 4),
 * step 3 "Comparatives" (page 5), and rates. */
@Module({
  controllers: [
    UploadsController,
    MappingController,
    ComparativesController,
    TranslationController,
  ],
  providers: [
    UploadStepService,
    RatesService,
    MappingStepService,
    ChartOfAccountsService,
    ComparativeSourceService,
    ComparativesService,
    TranslationService,
  ],
})
export class UploadsModule {}
