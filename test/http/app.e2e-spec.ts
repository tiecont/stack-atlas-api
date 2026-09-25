import { INestApplication } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { configureHttp } from '../../src/app.config';
import { AppModule } from '../../src/app.module';
import { DATABASE_POOL } from '../../src/database/database.constants';

describe('API foundation HTTP contract', () => {
  let app: INestApplication;
  let failReadiness = false;
  const notFoundFixture = JSON.parse(
    readFileSync(
      resolve(process.cwd(), 'test/fixtures/problem-details.v1.json'),
      'utf8',
    ),
  ) as Record<string, unknown>;

  beforeAll(async () => {
    const pool = {
      query: vi.fn().mockImplementation(async () => {
        if (failReadiness)
          throw new Error('database password should not be exposed');
        return { rows: [{ '?column?': 1 }] };
      }),
      end: vi.fn().mockResolvedValue(undefined),
    };
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DATABASE_POOL)
      .useValue(pool)
      .compile();
    app = moduleRef.createNestApplication();
    configureHttp(app);
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('serves a liveness route without querying PostgreSQL', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/health')
      .expect(200)
      .expect({ status: 'ok' });
  });

  it('serves PostgreSQL readiness separately from liveness', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/health/ready')
      .expect(200)
      .expect({ status: 'ok', dependencies: { postgres: 'ok' } });
  });

  it('allows browser access only from configured Web origins', async () => {
    const allowed = await request(app.getHttpServer())
      .options('/api/v1/health')
      .set('Origin', 'https://learn.example')
      .set('Access-Control-Request-Method', 'GET')
      .expect(204);
    expect(allowed.headers['access-control-allow-origin']).toBe(
      'https://learn.example',
    );
    expect(allowed.headers['access-control-allow-credentials']).toBe('true');

    const rejected = await request(app.getHttpServer())
      .options('/api/v1/health')
      .set('Origin', 'https://other.example')
      .set('Access-Control-Request-Method', 'GET')
      .expect(204);
    expect(rejected.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('returns a safe RFC 9457 response when PostgreSQL readiness fails', async () => {
    failReadiness = true;
    try {
      const response = await request(app.getHttpServer())
        .get('/api/v1/health/ready')
        .expect(503)
        .expect('Content-Type', /application\/problem\+json/);
      expect(response.body).toEqual({
        type: 'about:blank',
        title: 'Service Unavailable',
        status: 503,
        instance: '/api/v1/health/ready',
        requestId: response.headers['x-request-id'],
      });
      expect(response.body.requestId).toMatch(/^[0-9a-f-]{36}$/);
      expect(JSON.stringify(response.body)).not.toContain('password');
    } finally {
      failReadiness = false;
    }
  });

  it('documents the implemented route and its RFC 9457 failure response', async () => {
    const response = await request(app.getHttpServer())
      .get('/docs-json')
      .expect(200);
    expect(response.body.openapi).toMatch(/^3\./);
    expect(response.body.paths['/api/v1/health']).toBeDefined();
    expect(response.body.paths['/api/v1/account'].post).toBeDefined();
    expect(response.body.paths['/api/v1/auth/login'].post).toBeDefined();
    expect(
      response.body.components.securitySchemes.sessionCookie,
    ).toMatchObject({
      type: 'apiKey',
      in: 'cookie',
      name: 'stack_atlas_session',
    });
    expect(
      response.body.paths['/api/v1/auth/login'].post.responses['401'].content[
        'application/problem+json'
      ].schema,
    ).toMatchObject({ $ref: '#/components/schemas/ProblemDetailsDto' });
    expect(
      response.body.paths['/api/v1/health/ready'].get.responses['503'].content[
        'application/problem+json'
      ].schema,
    ).toMatchObject({ $ref: '#/components/schemas/ProblemDetailsDto' });
  });

  it('returns unknown routes as RFC 9457 problem details', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/articles/missing?token=should-not-leak')
      .expect(404)
      .expect('Content-Type', /application\/problem\+json/)
      .expect('Cache-Control', 'no-store');

    expect(response.body).toMatchObject(notFoundFixture);
    expect(response.body.requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(response.headers['x-request-id']).toBe(response.body.requestId);
  });
});
