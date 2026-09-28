import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';

/** Settings shared by the real server (main.ts) and the API tests. */
export function configureApp(app: NestExpressApplication): void {
  app.setGlobalPrefix('api');
  app.use(cookieParser());
  // Only proxies on this machine (the Vite dev server) may set X-Forwarded-For, so the IP in
  // the audit log is the real client's. On AWS, set this to the load balancer's network.
  app.set('trust proxy', 'loopback');
}
