import { Global, Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env';
import { resolveFromRepoRoot } from '../config/paths';
import { LocalStorageService } from './local-storage.service';
import { StorageService } from './storage.service';

/** Provides StorageService; the back-end is chosen by STORAGE_DRIVER. */
@Global()
@Module({
  providers: [
    {
      provide: StorageService,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): StorageService => {
        const driver = config.get('STORAGE_DRIVER', { infer: true });
        switch (driver) {
          case 'local': {
            const root = resolveFromRepoRoot(config.get('STORAGE_LOCAL_DIR', { infer: true }));
            Logger.log(`File storage: local folder ${root}`, 'StorageModule');
            return new LocalStorageService(root);
          }
          default:
            throw new Error(`Unsupported STORAGE_DRIVER "${String(driver)}"`);
        }
      },
    },
  ],
  exports: [StorageService],
})
export class StorageModule {}
