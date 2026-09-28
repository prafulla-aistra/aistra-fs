import { Module } from '@nestjs/common';
import { CalendarController } from './calendar/calendar.controller';
import { CalendarService } from './calendar/calendar.service';
import { CurrenciesController } from './currencies.controller';
import { CurrenciesService } from './currencies.service';
import { EntitiesController } from './entities.controller';
import { EntitiesService } from './entities.service';

/** Step 2 configuration: currencies, entities, group structure, calendar and due dates. */
@Module({
  controllers: [CurrenciesController, EntitiesController, CalendarController],
  providers: [CurrenciesService, EntitiesService, CalendarService],
})
export class ConfigurationModule {}
