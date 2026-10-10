'use client';

import Script from 'next/script';
import { usePathname } from 'next/navigation';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { publicPageView, recordPublicPageView, validMeasurementId, type GoogleTag, type PageViewState } from '@/lib/google-analytics';

type GoogleRuntime = PageViewState & { configured: boolean };
const subscribeToOrigin = () => () => {};
const browserOrigin = () => window.location.origin;
const serverOrigin = () => '';
declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: GoogleTag;
    kimTuyenGoogle?: Record<string, GoogleRuntime>;
  }
}

export function GoogleAnalytics({ measurementId }: { measurementId?: string }) {
  const id = validMeasurementId(measurementId);
  const pathname = usePathname();
  const [ready, setReady] = useState(false);
  const origin = useSyncExternalStore(subscribeToOrigin, browserOrigin, serverOrigin);
  const allowed = Boolean(publicPageView(pathname, origin));

  useEffect(() => {
    if (!id) return;
    const page = publicPageView(pathname, window.location.origin);
    // Also stop automatic engagement events on account, AI and payment routes.
    Object.assign(window, { [`ga-disable-${id}`]: !page });
    window.kimTuyenGoogle ??= {};
    const state = window.kimTuyenGoogle[id] ??= { configured: false };
    if (!page) {
      state.lastLocation = undefined;
      return;
    }
    if (!ready) return;
    window.dataLayer ??= [];
    window.gtag ??= (...args) => { window.dataLayer?.push(args); };
    if (!state.configured) {
      window.gtag('js', new Date());
      window.gtag('config', id, {
        send_page_view: false,
        allow_google_signals: false,
        allow_ad_personalization_signals: false,
        page_location: page.page_location,
        page_referrer: '',
        page_title: page.page_title,
      });
      state.configured = true;
    }
    recordPublicPageView(window.gtag, state, pathname, window.location.origin, id);
  }, [id, pathname, ready]);

  if (!id || !allowed) return null;
  return (
    <Script
      id="kim-tuyen-ga4"
      src={`https://www.googletagmanager.com/gtag/js?id=${id}`}
      strategy="afterInteractive"
      onReady={() => setReady(true)}
    />
  );
}
