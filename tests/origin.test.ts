import { describe, expect, it } from 'vitest';
import { isTrustedOrigin } from '@/lib/server/origin';

function request(origin: string, url = 'http://localhost:3000/api/analysis') {
  return new Request(url, {
    headers: {
      origin,
      host: '127.0.0.1:3000',
      'x-forwarded-proto': 'http',
      'x-forwarded-host': '127.0.0.1:3000',
    },
  });
}

describe('trusted browser origin', () => {
  it('accepts a forwarded host when Next uses an internal URL', () => {
    expect(isTrustedOrigin(request('http://127.0.0.1:3000'))).toBe(true);
  });

  it('accepts the forwarded public site origin', () => {
    const publicRequest = new Request('http://internal:3000/api/analysis', {
      headers: {
        origin: 'https://vanghomnay.online',
        host: 'internal:3000',
        'x-forwarded-proto': 'https',
        'x-forwarded-host': 'vanghomnay.online',
      },
    });
    expect(isTrustedOrigin(publicRequest)).toBe(true);
  });

  it('rejects foreign or missing origins', () => {
    expect(isTrustedOrigin(request('https://attacker.example'))).toBe(false);
    expect(
      isTrustedOrigin(new Request('http://localhost:3000/api/analysis')),
    ).toBe(false);
  });
});
