'use client';

import { useEffect, useRef, type ReactNode } from 'react';

// Reopening the route in this document preserves navigation restoration.
let entryHandled = false;

export function ChartEntryViewport({ children }: { children: ReactNode }) {
  const entry = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (entryHandled) return;
    const navigation = performance.getEntriesByType('navigation')[0] as
      | PerformanceNavigationTiming
      | undefined;
    if (
      window.location.hash ||
      new URLSearchParams(window.location.search).get('ai') === 'open' ||
      navigation?.type === 'back_forward' ||
      window.scrollY > 0
    ) {
      entryHandled = true;
      return;
    }

    let cancelled = false;
    let frame = 0;
    const cancel = () => {
      cancelled = true;
      entryHandled = true;
      window.cancelAnimationFrame(frame);
    };
    const events = [
      'pointerdown',
      'touchstart',
      'wheel',
      'keydown',
      'hashchange',
      'popstate',
    ] as const;
    events.forEach((event) =>
      window.addEventListener(event, cancel, { passive: true }),
    );

    // Wait for font metrics and the initial layout before positioning the view.
    void document.fonts.ready.then(() => {
      if (cancelled) return;
      frame = window.requestAnimationFrame(() => {
        frame = window.requestAnimationFrame(() => {
          if (
            cancelled ||
            !entry.current ||
            window.location.hash ||
            window.scrollY > 0
          )
            return;
          entryHandled = true;
          const headerBottom =
            document.querySelector('.site-header')?.getBoundingClientRect()
              .bottom ?? 0;
          const target =
            entry.current.getBoundingClientRect().top +
            window.scrollY -
            headerBottom -
            12;
          window.scrollTo({ top: Math.max(0, target), behavior: 'instant' });
        });
      });
    });

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
      events.forEach((event) => window.removeEventListener(event, cancel));
    };
  }, []);

  return (
    <div ref={entry} data-testid="domestic-chart-entry">
      {children}
    </div>
  );
}
