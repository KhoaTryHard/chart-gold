import { describe, expect, it, vi } from 'vitest';
import { publicPageView, recordPublicPageView, validMeasurementId } from '@/lib/google-analytics';

describe('public Google audience measurement', () => {
  it('validates measurement IDs and never tracks previews', () => {
    expect(validMeasurementId('G-ABC1234567')).toBe('G-ABC1234567');
    expect(validMeasurementId('G-ABC";<script>')).toBeNull();
    expect(publicPageView('/', 'https://chart-gold-preview.vercel.app')).toBeNull();
  });

  it.each(['/so-vang', '/phan-tich', '/admin', '/bien-tap', '/donate', '/api/auth', '/account', '/nhip-vang/private?email=me@example.com', '/nhip-vang/../so-vang'])('does not emit data for %s', path => {
    expect(publicPageView(path, 'https://www.vanghomnay.online')).toBeNull();
  });

  it('records one event for an initial page and each actual navigation, including Strict Mode reruns', () => {
    const gtag = vi.fn();
    const state = {};
    const origin = 'https://www.vanghomnay.online';
    for (const path of ['/', '/', '/nhip-vang', '/nhip-vang', '/nhip-vang/vang-sjc', '/nhip-vang/vang-sjc']) {
      recordPublicPageView(gtag, state, path, origin, 'G-ABC1234567');
    }
    expect(gtag).toHaveBeenCalledTimes(3);
    expect(gtag).toHaveBeenLastCalledWith('event', 'page_view', {
      page_location: `${origin}/nhip-vang/vang-sjc`,
      page_title: 'Bài viết Nhịp vàng | Kim Tuyến',
      page_referrer: `${origin}/nhip-vang`,
      send_to: 'G-ABC1234567',
    });
  });

  it('does not use private page URLs or user content as referrers or titles', () => {
    const gtag = vi.fn();
    const state = {};
    const origin = 'https://www.vanghomnay.online';
    for (const path of ['/', '/so-vang', '/']) recordPublicPageView(gtag, state, path, origin, 'G-ABC1234567');
    expect(gtag).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(gtag.mock.calls)).not.toContain('so-vang');
  });
});
