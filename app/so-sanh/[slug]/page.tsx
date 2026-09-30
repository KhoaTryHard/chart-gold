import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ComparisonLandingContent } from '@/components/market/comparison-landing-content';
import { comparisonLandings, getComparisonLanding } from '@/lib/compare-seo';
import { pageMetadata } from '@/lib/seo';

export function generateStaticParams() {
  return comparisonLandings.map(({ slug }) => ({ slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const landing = getComparisonLanding((await params).slug);
  if (!landing) return {};
  return pageMetadata(
    `/so-sanh/${landing.slug}`,
    landing.title,
    landing.description,
  );
}

export default async function ComparisonLandingPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const landing = getComparisonLanding(slug);
  if (!landing) notFound();

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
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(faqJsonLd).replace(/</g, '\\u003c'),
        }}
      />
      <ComparisonLandingContent slug={slug} />
    </>
  );
}
