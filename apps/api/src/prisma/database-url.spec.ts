import { withConnectionDefaults } from './database-url';

describe('withConnectionDefaults', () => {
  it('adds generous timeouts and a small pool for the local embedded server', () => {
    const url = new URL(
      withConnectionDefaults('postgresql://u:p@localhost:54329/db?schema=public'),
    );
    expect(Object.fromEntries(url.searchParams)).toEqual({
      schema: 'public',
      connect_timeout: '30',
      pool_timeout: '30',
      connection_limit: '5',
    });
  });

  it('leaves the pool size alone for remote servers such as AWS RDS', () => {
    const url = new URL(
      withConnectionDefaults('postgresql://u:p@db.example.rds.amazonaws.com:5432/db'),
    );
    expect(url.searchParams.get('connect_timeout')).toBe('30');
    expect(url.searchParams.has('connection_limit')).toBe(false);
  });

  it('never overrides settings already in the URL', () => {
    const url = new URL(
      withConnectionDefaults('postgresql://u:p@localhost/db?connect_timeout=5&connection_limit=20'),
    );
    expect(url.searchParams.get('connect_timeout')).toBe('5');
    expect(url.searchParams.get('connection_limit')).toBe('20');
  });
});
