import type { NextConfig } from 'next';

const reportOnlyCsp = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "script-src 'self' 'unsafe-inline' https://s3.tradingview.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://vietqr.app",
  "font-src 'self' data:",
  "connect-src 'self' https://edge-cf-api.pnj.io https://www.vang.today https://sjc.com.vn https://btmc.vn https://gold.phuquy.com.vn https://vietinbankgold.vn https://www.tradingview.com https://s.tradingview.com https://www.tradingview-widget.com https://data.tradingview.com https://symbol-search.tradingview.com https://scanner.tradingview.com",
  'frame-src https://www.tradingview.com https://s.tradingview.com https://www.tradingview-widget.com',
].join('; ');

const nextConfig: NextConfig = {
  async redirects() {
    return [
      {
        source: '/so-sanh',
        destination: '/cong-cu-vang?tool=so-sanh#so-sanh',
        permanent: true,
      },
      {
        source: '/quy-doi',
        destination: '/cong-cu-vang?tool=lai-lo#hoa-von',
        permanent: true,
      },
    ];
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          {
            key: 'Permissions-Policy',
            value:
              'camera=(), microphone=(), geolocation=(), browsing-topics=()',
          },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Content-Security-Policy-Report-Only', value: reportOnlyCsp },
        ],
      },
    ];
  },
};

export default nextConfig;
