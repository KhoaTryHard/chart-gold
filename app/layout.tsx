import type { Metadata, Viewport } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import { Analytics } from '@vercel/analytics/next';
import { SpeedInsights } from "@vercel/speed-insights/next";
import { AuthSessionProvider } from '@/components/auth/session-provider';
import { AppShell } from '@/components/app-shell';
import { LocaleProvider } from '@/components/locale-provider';
import { ThemeProvider } from '@/components/theme-provider';
import { SiteFooter } from '@/components/site-footer';
import { GoogleAnalytics } from '@/components/google-analytics';
import { htmlLang } from '@/lib/i18n';
import { getRequestLocale } from '@/lib/request-locale';
import { siteUrl } from '@/lib/seo';
import './globals.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin', 'vietnamese'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: 'Kim Tuyến — Giá vàng Việt Nam',
    template: '%s | Kim Tuyến',
  },
  applicationName: 'Kim Tuyến',
  authors: [{ name: 'Kim Tuyến' }],
  creator: 'Kim Tuyến',
  verification: { google: process.env.GOOGLE_SITE_VERIFICATION || undefined },
  publisher: 'Kim Tuyến',
  keywords: [
    'giá vàng hôm nay',
    'giá vàng SJC',
    'giá vàng Việt Nam',
    'biểu đồ giá vàng',
    'so sánh giá vàng',
    'tính hòa vốn vàng',
    'biểu đồ nến vàng thế giới',
    'XAU/USD',
  ],
  description:
    'Theo dõi giá mua vào, bán ra của các thương hiệu vàng Việt Nam, xem biểu đồ, so sánh giá và tính hòa vốn miễn phí.',
  alternates: { canonical: '/' },
  robots: {
    index: true,
    follow: true,
    googleBot: { 'max-image-preview': 'large' },
  },
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: '16x16 32x32 48x48', type: 'image/x-icon' },
      { url: '/favicon.svg', sizes: 'any', type: 'image/svg+xml' },
    ],
    apple: [{ url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
  },
  openGraph: {
    type: 'website',
    locale: 'vi_VN',
    siteName: 'Kim Tuyến',
    title: 'Kim Tuyến — Giá vàng Việt Nam',
    description:
      'Nhìn giá vàng, thấy cả xu hướng với dữ liệu cập nhật theo thương hiệu.',
    images: [
      {
        url: '/og.png',
        width: 1200,
        height: 630,
        alt: 'Kim Tuyến — Giá vàng Việt Nam',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Kim Tuyến — Giá vàng Việt Nam',
    description:
      'Theo dõi giá vàng Việt Nam và các công cụ tính toán miễn phí.',
    images: ['/og.png'],
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f7f6f2' },
    { media: '(prefers-color-scheme: dark)', color: '#191d18' },
  ],
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await getRequestLocale();

  return (
    <html lang={htmlLang(locale)} suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var p=localStorage.getItem('kim-tuyen-theme');p=p==='light'||p==='dark'||p==='system'?p:'system';var d=p==='dark'||p==='system'&&matchMedia('(prefers-color-scheme: dark)').matches;document.documentElement.classList.toggle('dark',d);document.documentElement.dataset.theme=p;document.documentElement.style.colorScheme=d?'dark':'light'}catch(e){}})();`,
          }}
        />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <LocaleProvider initialLocale={locale}>
          <ThemeProvider>
            <AuthSessionProvider>
              <AppShell footer={<SiteFooter />}>{children}</AppShell>
            </AuthSessionProvider>
          </ThemeProvider>
        </LocaleProvider>
        <SpeedInsights />
        <Analytics />
        <GoogleAnalytics measurementId={process.env.NEXT_PUBLIC_GA4_MEASUREMENT_ID} />
      </body>
    </html>
  );
}
