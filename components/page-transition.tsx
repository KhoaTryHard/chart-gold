'use client';

import type { ReactNode } from 'react';
import { usePathname } from 'next/navigation';

/**
 * Keeps route content connected with a deterministic CSS transition. The
 * runtime feature detection that React ViewTransition requires can disagree
 * between the server and browser bundles, so the fallback is the canonical
 * path and avoids hydration mismatches.
 */
export function PageTransition({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  return (
    <div key={pathname} className="page-transition" data-route={pathname}>
      {children}
    </div>
  );
}
