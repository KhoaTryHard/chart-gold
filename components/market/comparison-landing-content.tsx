'use client';

import Link from 'next/link';
import { ComparePanel } from '@/components/market/compare-panel';
import { ToolPage } from '@/components/tool-page';
import { useLocale } from '@/components/locale-provider';
import { getComparisonLandingForLocale } from '@/lib/compare-seo';

export function ComparisonLandingContent({ slug }: { slug: string }) {
  const { locale } = useLocale();
  const landing = getComparisonLandingForLocale(slug, locale);
  if (!landing) return null;
  const english = locale === 'en';
  const faqJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: landing.faqs.map((faq) => ({
      '@type': 'Question',
      name: faq.question,
      acceptedAnswer: { '@type': 'Answer', text: faq.answer },
    })),
  };

  return (
    <ToolPage eyebrow={landing.eyebrow} title={landing.title} description={landing.description}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(faqJsonLd).replace(/</g, '\\u003c'),
        }}
      />
      <article className="glass-panel p-5 sm:p-7">
        <p className="max-w-3xl text-sm leading-7 text-muted-foreground">
          {landing.intro}
        </p>
        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <section aria-labelledby="comparison-method">
            <h2 id="comparison-method" className="font-heading text-lg font-semibold">
              {english ? 'How to read the result' : 'Cách đọc kết quả'}
            </h2>
            <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-6 text-muted-foreground">
              {landing.method.map((item) => <li key={item}>{item}</li>)}
            </ul>
          </section>
          <section aria-labelledby="comparison-limits">
            <h2 id="comparison-limits" className="font-heading text-lg font-semibold">
              {english ? 'Comparison limits' : 'Giới hạn so sánh'}
            </h2>
            <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-6 text-muted-foreground">
              {landing.limits.map((item) => <li key={item}>{item}</li>)}
            </ul>
          </section>
        </div>
      </article>

      <ComparePanel initialSet={landing.set} />

      <section className="glass-panel p-5 sm:p-7" aria-labelledby="comparison-faq">
        <h2 id="comparison-faq" className="font-heading text-xl font-semibold">
          {english ? 'Frequently asked questions' : 'Câu hỏi thường gặp'}
        </h2>
        <div className="mt-4 divide-y divide-border/70">
          {landing.faqs.map((faq) => (
            <details key={faq.question} className="py-4 first:pt-0 last:pb-0">
              <summary className="cursor-pointer text-sm font-semibold">
                {faq.question}
              </summary>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">{faq.answer}</p>
            </details>
          ))}
        </div>
      </section>

      <nav aria-label={english ? 'Related topics' : 'Chủ đề liên quan'} className="flex flex-wrap gap-2 text-sm">
        <Link href="/cong-cu-vang#so-sanh" className="rounded-full border border-border bg-card/70 px-4 py-2 font-semibold hover:bg-card">
          {english ? 'Open comparison tool' : 'Mở công cụ so sánh'}
        </Link>
        <Link href="/cong-cu-vang#hoa-von" className="rounded-full border border-border bg-card/70 px-4 py-2 font-semibold hover:bg-card">
          {english ? 'Calculate profit, loss, and break-even' : 'Tính lãi/lỗ và hòa vốn'}
        </Link>
        <Link href="/huong-dan#so-sanh" className="rounded-full border border-border bg-card/70 px-4 py-2 font-semibold hover:bg-card">
          {english ? 'View the guide' : 'Xem hướng dẫn'}
        </Link>
      </nav>
    </ToolPage>
  );
}
