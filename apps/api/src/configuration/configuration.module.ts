import { Module } from '@nestjs/common';
import { CalendarController } from './calendar/calendar.controller';
import { CalendarService } from './calendar/calendar.service';
import { ControlsController } from './controls.controller';
import { CurrenciesController } from './currencies.controller';
import { CurrenciesService } from './currencies.service';
import { EntitiesController } from './entities.controller';
import { EntitiesService } from './entities.service';
import { FormatsController } from './formats.controller';
import { NoteTemplatesController } from './note-templates.controller';
import { FormatsService } from './formats.service';
import { ReferenceController } from './reference.controller';
import { ReferenceService } from './reference.service';

/** Step 2 configuration: currencies, entities, group structure, calendar and due dates. */
@Module({
  controllers: [
    CurrenciesController,
    EntitiesController,
    CalendarController,
    NoteTemplatesController,
    ControlsController,
    ReferenceController,
    FormatsController,
  ],
  providers: [
    CurrenciesService,
    EntitiesService,
    CalendarService,
    ReferenceService,
    FormatsService,
  ],
  exports: [EntitiesService, CalendarService],
})
export class ConfigurationModule {}
