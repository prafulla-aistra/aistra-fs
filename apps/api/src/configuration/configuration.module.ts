import { Module } from '@nestjs/common';
import { CalendarController } from './calendar/calendar.controller';
import { CalendarService } from './calendar/calendar.service';
import { CurrenciesController } from './currencies.controller';
import { CurrenciesService } from './currencies.service';
import { EntitiesController } from './entities.controller';
import { EntitiesService } from './entities.service';
import { ReferenceController } from './reference.controller';

/** Step 2 configuration: currencies, entities, group structure, calendar and due dates. */
@Module({
  controllers: [CurrenciesController, EntitiesController, CalendarController, ReferenceController],
  providers: [CurrenciesService, EntitiesService, CalendarService],
  exports: [EntitiesService, CalendarService],
})
export class ConfigurationModule {}
