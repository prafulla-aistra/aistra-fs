const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

/**
 * Adds connection settings to DATABASE_URL unless it already sets them.
 *
 * Measured on a Windows laptop: PostgreSQL starts a new process per connection, so a single
 * connection takes ~1.7 s and a burst of 25 up to ~11 s — beyond Prisma's default 5 s
 * connect timeout, which surfaced as random "can't reach database" errors. So:
 *   - connect_timeout / pool_timeout = 30 s everywhere (harmless on AWS RDS);
 *   - on the local embedded server, a small pool (5), since each connection is expensive
 *     and connections are reused once open.
 */
export function withConnectionDefaults(databaseUrl: string): string {
  let url: URL;
  try {
    url = new URL(databaseUrl);
  } catch {
    return databaseUrl; // validated elsewhere
  }
  const set = (key: string, value: string) => {
    if (!url.searchParams.has(key)) url.searchParams.set(key, value);
  };
  set('connect_timeout', '30');
  set('pool_timeout', '30');
  if (LOCAL_HOSTS.has(url.hostname)) set('connection_limit', '5');
  return url.toString();
}
