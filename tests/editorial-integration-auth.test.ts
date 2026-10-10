import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import {
  integrationSignature,
  verifyIntegrationRequest,
} from '@/lib/editorial/integration-auth';
const key = 'integration-audit-secret-32-characters';
function request(
  body = '{}',
  timestamp = String(Math.floor(Date.now() / 1000)),
  signingKey = key,
) {
  const path = '/api/editorial/integrations/hermes/prepare';
  return new Request('https://www.vanghomnay.online' + path, {
    method: 'POST',
    body,
    headers: {
      'x-editorial-client': 'kim-tuyen-newsroom',
      'x-editorial-timestamp': timestamp,
      'x-editorial-signature': integrationSignature(
        signingKey,
        'POST',
        path,
        timestamp,
        Buffer.from(body),
      ),
    },
  });
}
beforeEach(() => {
  vi.stubEnv('HERMES_EDITORIAL_ENABLED', 'true');
  vi.stubEnv('HERMES_EDITORIAL_SECRET', key);
});
afterEach(() => vi.unstubAllEnvs());
describe('Hermes bridge raw-body authentication', () => {
  it('verifies exact raw bytes', async () =>
    expect((await verifyIntegrationRequest(request())).toString()).toBe('{}'));
  it('rejects unsigned calls', async () =>
    await expect(
      verifyIntegrationRequest(
        new Request(
          'https://www.vanghomnay.online/api/editorial/integrations/hermes/prepare',
        ),
      ),
    ).rejects.toMatchObject({ status: 401 }));
  it('rejects stale timestamp', async () =>
    await expect(
      verifyIntegrationRequest(
        request('{}', String(Math.floor(Date.now() / 1000) - 301)),
      ),
    ).rejects.toMatchObject({ status: 401 }));
  it('rejects wrong secret', async () =>
    await expect(
      verifyIntegrationRequest(
        request('{}', undefined, 'incorrect-signing-key-32-characters'),
      ),
    ).rejects.toMatchObject({ status: 401 }));
  it('rejects altered method/path/body', async () => {
    const valid = request();
    const body = await valid.text();
    await expect(
      verifyIntegrationRequest(
        new Request(
          'https://www.vanghomnay.online/api/editorial/integrations/hermes/prepare?changed=1',
          { method: 'POST', headers: valid.headers, body: body + ' ' },
        ),
      ),
    ).rejects.toMatchObject({ status: 401 });
  });
  it('accepts key rotation', async () => {
    vi.stubEnv(
      'HERMES_EDITORIAL_SECRET',
      'different-current-secret-32-characters',
    );
    vi.stubEnv('HERMES_EDITORIAL_NEXT_SECRET', key);
    expect((await verifyIntegrationRequest(request())).toString()).toBe('{}');
  });
  it('honors kill switch', async () => {
    vi.stubEnv('HERMES_EDITORIAL_ENABLED', 'false');
    await expect(verifyIntegrationRequest(request())).rejects.toMatchObject({
      status: 503,
    });
  });
});
