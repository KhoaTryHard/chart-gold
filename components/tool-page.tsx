'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { PageTransition } from '@/components/page-transition';
import { useLocale } from '@/components/locale-provider';

export function ToolPage({
  eyebrow,
  title,
  description,
  showGuideLink = true,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  showGuideLink?: boolean;
  children: ReactNode;
}) {
  const { locale } = useLocale();
  return (
    <PageTransition>
      <main id="main-content" tabIndex={-1} className="tool-page-content" aria-labelledby="tool-page-title">
          <div className="tool-intro">
            <p className="tool-eyebrow">
              <span aria-hidden="true" />
              {eyebrow}
            </p>
            <h1 id="tool-page-title">{title}</h1>
            <p className="tool-description">{description}</p>
            {showGuideLink ? (
              <Link
                href="/huong-dan#cac-cong-cu"
                className="mt-4 inline-flex min-h-10 items-center rounded-full border border-border bg-card/70 px-4 text-xs font-semibold text-foreground transition-colors hover:bg-card"
              >
                {locale === 'en'
                  ? 'New here? See the step-by-step guide'
                  : 'Chưa quen dùng? Xem hướng dẫn từng bước'}
              </Link>
            ) : null}
          </div>
          {children}
      </main>
    </PageTransition>
  );
}
