import { HttpStatus, Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Response } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { HealthController } from './health.controller';

function fakeResponse(): Response & { statusCode?: number } {
  const res = {} as Response & { statusCode?: number };
  res.status = jest.fn((code: number) => {
    res.statusCode = code;
    return res;
  }) as unknown as Response['status'];
  return res;
}

async function controllerWith(queryRaw: jest.Mock): Promise<HealthController> {
  const moduleRef = await Test.createTestingModule({
    controllers: [HealthController],
    providers: [{ provide: PrismaService, useValue: { $queryRaw: queryRaw } }],
  }).compile();
  return moduleRef.get(HealthController);
}

describe('HealthController', () => {
  beforeAll(() => Logger.overrideLogger(false));

  it('reports ok when the database answers', async () => {
    const controller = await controllerWith(jest.fn().mockResolvedValue([{ '?column?': 1 }]));
    const res = fakeResponse();

    await expect(controller.check(res)).resolves.toEqual({ status: 'ok', db: 'ok' });
    expect(res.status).not.toHaveBeenCalled();
  });

  it('reports error with HTTP 503 when the database is unreachable', async () => {
    const controller = await controllerWith(
      jest.fn().mockRejectedValue(new Error('connection refused')),
    );
    const res = fakeResponse();

    await expect(controller.check(res)).resolves.toEqual({ status: 'error', db: 'error' });
    expect(res.statusCode).toBe(HttpStatus.SERVICE_UNAVAILABLE);
  });
});
