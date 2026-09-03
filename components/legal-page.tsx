import Link from 'next/link';
import { ArrowLeft, Landmark } from 'lucide-react';

type LegalPageProps = {
  eyebrow: string;
  title: string;
  intro: string;
  children: React.ReactNode;
};

export function LegalPage({ eyebrow, title, intro, children }: LegalPageProps) {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border/80 bg-background/90 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-[1440px] items-center justify-between px-4 sm:px-6 lg:px-10">
          <Link href="/" className="flex items-center gap-3">
            <span className="grid size-9 place-items-center rounded-xl bg-primary text-primary-foreground shadow-[0_8px_24px_rgba(30,74,62,.18)]">
              <Landmark className="size-[18px]" strokeWidth={1.8} />
            </span>
            <span>
              <span className="block font-heading text-[17px] font-semibold tracking-[-0.03em]">
                Kim Tuyến
              </span>
              <span className="block text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                SJC Market View
              </span>
            </span>
          </Link>
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" />
            Về dashboard
          </Link>
        </div>
      </header>

      <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-14">
        <article className="rounded-[22px] border border-border bg-card p-6 shadow-[0_18px_60px_rgba(28,46,40,.06)] sm:p-10">
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

        <footer className="mt-5 flex flex-col gap-2 border-t border-border/70 pt-5 text-xs leading-5 text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <span>Cập nhật: 03/09/2026</span>
          <a
            href="mailto:khoadangntpcl@gmail.com"
            className="font-semibold text-foreground underline-offset-4 hover:underline"
          >
            khoadangntpcl@gmail.com
          </a>
        </footer>
      </div>
    </main>
  );
}
