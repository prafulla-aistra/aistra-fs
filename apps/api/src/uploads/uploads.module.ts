import { Module } from '@nestjs/common';
import { ConfigurationModule } from '../configuration/configuration.module';
import { IntegrationsModule } from '../integrations/integrations.module';
import { ChartOfAccountsService } from './chart-of-accounts.service';
import { ComparativeSourceService } from './comparative-source.service';
import { ComparativesController } from './comparatives.controller';
import { ConfigDataController } from './config-data.controller';
import { ComparativesService } from './comparatives.service';
import { MappingController } from './mapping.controller';
import { MappingStepService } from './mapping-step.service';
import { RateConfigService } from './rate-config.service';
import { RateFeedService } from './rate-feed.service';
import { RatesService } from './rates.service';
import { EditAccessController } from './edit-access.controller';
import { EditAccessService } from './edit-access.service';
import { NotesController } from './notes.controller';
import { NotificationsController, NotificationsService } from './notifications.service';
import { ReviewController } from './review.controller';
import { ReviewService } from './review.service';
import { SubmissionGuard } from './submission-guard.service';
import { NotesService } from './notes.service';
import { StatementFiguresService } from './statement-figures';
import { StatementsController } from './statements.controller';
import { StatementsService } from './statements.service';
import { TranslationController } from './translation.controller';
import { TranslationService } from './translation.service';
import { UploadStepService } from './upload-step.service';
import { UploadsController } from './uploads.controller';

/** SFS workspace: step 1 "Upload data" (page 3), step 2 "Review and map" (page 4),
 * step 3 "Comparatives" (page 5), and rates. */
@Module({
  imports: [ConfigurationModule, IntegrationsModule],
  controllers: [
    UploadsController,
    MappingController,
    ComparativesController,
    TranslationController,
    ConfigDataController,
    StatementsController,
    NotesController,
    EditAccessController,
    NotificationsController,
    ReviewController,
  ],
  providers: [
    UploadStepService,
    RatesService,
    RateFeedService,
    RateConfigService,
    MappingStepService,
    ChartOfAccountsService,
    ComparativeSourceService,
    ComparativesService,
    TranslationService,
    StatementFiguresService,
    StatementsService,
    NotesService,
    EditAccessService,
    NotificationsService,
    SubmissionGuard,
    ReviewService,
  ],
  exports: [NotesService, NotificationsService, EditAccessService, StatementFiguresService],
})
export class UploadsModule {}
