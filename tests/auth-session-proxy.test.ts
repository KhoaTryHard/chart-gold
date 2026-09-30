import { afterEach, expect, it, vi } from 'vitest';
import { Auth } from '@auth/core';
import { encode } from 'next-auth/jwt';
import type { NextAuthConfig } from 'next-auth';

const captured = vi.hoisted(() => ({ config: null as NextAuthConfig | null }));
vi.mock('next-auth', () => ({
  default: (config: NextAuthConfig) => {
    captured.config = config;
    return { handlers: {}, auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn() };
  },
}));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

it('reads a valid secure Google session behind an HTTP proxy on Vercel without re-login', async () => {
  vi.stubEnv('VERCEL', '1');
  vi.stubEnv('AUTH_TRUST_HOST', 'true');
  vi.stubEnv('AUTH_SECRET', 'local-test-proxy-secret');
  vi.stubEnv('ADMIN_EMAILS', 'proxy-admin@example.test');
  vi.stubEnv('B2C_AI_ENABLED', 'false');
  await import('@/auth');
  const config = captured.config!;
  expect(config.useSecureCookies).toBe(true);
  const token = await encode({
    secret: 'local-test-proxy-secret',
    salt: '__Secure-authjs.session-token',
    token: { sub: 'test-google-sub', email: 'proxy-admin@example.test' },
  });
  const request = new Request('http://internal.example/api/auth/session', {
    headers: {
      cookie: `__Secure-authjs.session-token=${token}`,
      'x-forwarded-proto': 'http',
    },
  });
  const response = await Auth(request, { ...config, trustHost: true });
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    user: { email: 'proxy-admin@example.test', isAdmin: true, canUseAi: true },
  });
});

it('does not grant access to an invalid cookie', async () => {
  vi.stubEnv('VERCEL', '1');
  vi.stubEnv('AUTH_SECRET', 'local-test-proxy-secret');
  await import('@/auth');
  const response = await Auth(
    new Request('http://internal.example/api/auth/session', {
      headers: { cookie: '__Secure-authjs.session-token=invalid' },
    }),
    { ...captured.config!, trustHost: true, logger: { error: vi.fn() } },
  );
  expect(await response.json()).toBeNull();
});

it('accepts every Google account with a verified email regardless of sales flags', async () => {
  vi.stubEnv('B2C_AI_ENABLED', 'false');
  vi.stubEnv('DONATIONS_ENABLED', 'false');
  await import('@/auth');
  const callback = captured.config!.callbacks?.signIn;
  expect(callback).toBeTypeOf('function');
  await expect(
    callback!({
      user: { id: 'google-subject', email: 'member@example.test' },
      profile: { email_verified: true },
      account: null,
      credentials: undefined,
      email: undefined,
    } as never),
  ).resolves.toBe(true);
  await expect(
    callback!({
      user: { id: 'unverified', email: 'member@example.test' },
      profile: { email_verified: false },
      account: null,
      credentials: undefined,
      email: undefined,
    } as never),
  ).resolves.toBe(false);
});

it('persists the stable Google provider subject across JWT refreshes', async () => {
  vi.stubEnv('B2C_AI_ENABLED', 'true');
  vi.stubEnv('AUTH_SECRET', 'local-test-proxy-secret');
  await import('@/auth');
  const callbacks = captured.config!.callbacks!;
  const jwt = callbacks.jwt!;
  const session = callbacks.session!;
  const first = await jwt({
    token: { sub: 'random-authjs-user-id', email: 'member@example.test' },
    account: {
      provider: 'google',
      providerAccountId: 'google-subject-123',
      type: 'oauth',
    },
    profile: { sub: 'google-subject-123', email: 'member@example.test' },
    user: { id: 'random-authjs-user-id', email: 'member@example.test' },
    trigger: 'signIn',
  } as never);
  const refreshed = await jwt({ token: first, trigger: 'update' } as never);
  expect((refreshed as { googleSubject?: string }).googleSubject).toBe(
    'google-subject-123',
  );

  const shaped = await session({
    session: {
      expires: '2030-01-01',
      user: { email: 'member@example.test' },
    },
    token: refreshed,
  } as never);
  expect(
    (shaped.user as { googleSubject?: string } | undefined)?.googleSubject,
  ).toBe('google-subject-123');
});
