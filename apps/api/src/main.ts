import 'reflect-metadata';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { NextFunction, Request, Response } from 'express';
import { AppModule } from './app.module';
import type { Env } from './config/env';
import { resolveFromRepoRoot } from './config/paths';
import { configureApp } from './configure-app';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const config = app.get<ConfigService<Env, true>>(ConfigService);

  configureApp(app);
  serveWebApp(app, config.get('WEB_DIST_DIR', { infer: true }));
  app.enableCors({ origin: config.get('CORS_ORIGINS', { infer: true }), credentials: true });
  app.enableShutdownHooks();

  const port = config.get('PORT', { infer: true });
  await app.listen(port);
  Logger.log(`API listening on http://localhost:${port}/api`, 'Bootstrap');
}

/**
 * Deployed on one server (nginx → one port), the API also serves the built web app
 * (apps/web/dist). Hashed files under /assets are cached for a year; every other non-API
 * GET returns index.html so the browser router handles the path. Off when WEB_DIST_DIR is
 * empty (local development: Vite serves the web app).
 */
function serveWebApp(app: NestExpressApplication, webDistDir: string): void {
  if (!webDistDir) return;
  const root = resolveFromRepoRoot(webDistDir);
  const indexHtml = path.join(root, 'index.html');
  if (!existsSync(indexHtml)) {
    throw new Error(`WEB_DIST_DIR: ${indexHtml} not found (run "npm run build" first)`);
  }
  app.useStaticAssets(root, {
    index: false,
    setHeaders: (res, filePath) => {
      const immutable = filePath.startsWith(path.join(root, 'assets') + path.sep);
      res.setHeader('Cache-Control', immutable ? 'public, max-age=31536000, immutable' : 'no-cache');
    },
  });
  app.use((req: Request, res: Response, next: NextFunction) => {
    if ((req.method !== 'GET' && req.method !== 'HEAD') || /^\/api(\/|$)/.test(req.path)) {
      next();
      return;
    }
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(indexHtml);
  });
  Logger.log(`Serving the web app from ${root}`, 'Bootstrap');
}

void bootstrap();
