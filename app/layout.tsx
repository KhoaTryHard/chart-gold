import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import { AuthSessionProvider } from '@/components/auth/session-provider';
import './globals.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : 'http://localhost:3000',
  ),
  title: 'Kim Tuyến — Biểu đồ giá vàng Việt Nam',
  description:
    'Theo dõi giá vàng các thương hiệu uy tín tại Việt Nam theo ngày, tháng và năm với góc nhìn trực quan dành cho nhà đầu tư.',
  openGraph: {
    title: 'Kim Tuyến — Biểu đồ giá vàng Việt Nam',
    description:
      'Nhìn giá vàng, thấy cả xu hướng với dữ liệu theo ngày, tháng và năm.',
    images: [{ url: '/og.png', width: 1200, height: 630 }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Kim Tuyến — Biểu đồ giá vàng Việt Nam',
    description:
      'Nhìn giá vàng, thấy cả xu hướng với dữ liệu theo ngày, tháng và năm.',
    images: ['/og.png'],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="vi">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <AuthSessionProvider>{children}</AuthSessionProvider>
      </body>
    </html>
  );
}
