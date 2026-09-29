import { Module } from '@nestjs/common';
import { RatesService } from './rates.service';
import { UploadStepService } from './upload-step.service';
import { UploadsController } from './uploads.controller';

/** Page 3: task workspace step 1 "Upload data" and group exchange rates. */
@Module({
  controllers: [UploadsController],
  providers: [UploadStepService, RatesService],
})
export class UploadsModule {}
