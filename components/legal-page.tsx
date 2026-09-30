import Link from 'next/link';
import { PageTransition } from '@/components/page-transition';

type LegalPageProps = {
  eyebrow: string;
  title: string;
  intro: string;
  updatedAt: string;
  locale?: 'vi' | 'en';
  children: React.ReactNode;
};

export function LegalPage({
  eyebrow,
  title,
  intro,
  updatedAt,
  locale = 'vi',
  children,
}: LegalPageProps) {
  return (
    <PageTransition>
      <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-14">
        <Link
          href="/"
          className="glass-action inline-flex min-h-11 w-fit items-center gap-1.5 px-4 text-xs font-semibold"
        >
          ← {locale === 'en' ? 'Back to dashboard' : 'Về dashboard'}
        </Link>
        <article className="glass-panel p-6 sm:p-10">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-accent-foreground">
            {eyebrow}
          </p>
          <h1 className="mt-3 font-heading text-[clamp(2rem,5vw,3.2rem)] font-semibold leading-[1.05] tracking-[-0.055em]">
            {title}
          </h1>
          <p className="mt-4 text-sm leading-6 text-muted-foreground">
            {intro}
          </p>
          <div className="mt-9 space-y-8 text-sm leading-6">{children}</div>
        </article>
        <p className="mt-4 text-xs leading-5 text-muted-foreground">
          {locale === 'en' ? 'Content updated' : 'Cập nhật nội dung'}: {updatedAt}
        </p>
      </div>
    </PageTransition>
  );
}
