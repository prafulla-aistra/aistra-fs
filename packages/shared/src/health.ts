/** Response body of GET /api/health. */
export type ComponentStatus = 'ok' | 'error';

export interface HealthResponse {
  status: ComponentStatus;
  db: ComponentStatus;
}
