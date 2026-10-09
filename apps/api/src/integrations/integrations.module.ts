import { Module } from '@nestjs/common';
import { IntegrationsController } from './integrations.controller';
import { ZohoClient } from './zoho-client.service';
import { ZohoService } from './zoho.service';

/** ERP integrations: Zoho Books today (Xero later, behind the same upload-step flow). */
@Module({
  controllers: [IntegrationsController],
  providers: [ZohoClient, ZohoService],
  exports: [ZohoService],
})
export class IntegrationsModule {}
