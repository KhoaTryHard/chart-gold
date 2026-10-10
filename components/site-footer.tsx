'use client';

import Link from 'next/link';
import { BrandMark } from '@/components/brand-mark';
import { useLocale } from '@/components/locale-provider';

const linkProps = { prefetch: false } as const;

function FooterLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <li>
      <Link href={href} {...linkProps} className="site-footer__link">
        {children}
      </Link>
    </li>
  );
}

export function SiteFooter() {
  const { locale } = useLocale();
  const year = new Date().getFullYear();
  const copy =
    locale === 'en'
      ? {
          caption: 'Vietnam gold prices',
          description:
            'Follow dealer prices, calculate gains and losses, and catch up on market news.',
          explore: 'Explore',
          priceTable: 'Gold price table',
          ledger: 'Gold ledger',
          tools: 'Gold tools',
          pulse: 'Gold Pulse',
          analysis: 'AI Analysis',
          support: 'Support',
          guide: 'User guide',
          editorial: 'Editorial method',
          donate: 'Support the project',
          contact: 'Contact & feedback',
          privacy: 'Privacy policy',
          terms: 'Terms of use',
          policies: 'Policies',
          noticeText:
            'Gold prices, articles, calculations, and AI content are for information only, not investment advice.',
          noticeLink: 'Disclaimer',
        }
      : {
          caption: 'Giá vàng Việt Nam',
          description:
            'Theo dõi giá mua bán, tính lãi/lỗ và cập nhật tin tức thị trường.',
          explore: 'Khám phá',
          priceTable: 'Bảng giá vàng',
          ledger: 'Sổ vàng',
          tools: 'Công cụ vàng',
          pulse: 'Nhịp vàng',
          analysis: 'Phân tích AI',
          support: 'Hỗ trợ',
          guide: 'Hướng dẫn sử dụng',
          editorial: 'Phương pháp biên tập',
          donate: 'Ủng hộ dự án',
          contact: 'Liên hệ & góp ý',
          privacy: 'Chính sách bảo mật',
          terms: 'Điều khoản sử dụng',
          policies: 'Chính sách',
          noticeText:
            'Giá vàng, bài viết, phép tính và nội dung AI chỉ để tham khảo, không phải tư vấn đầu tư.',
          noticeLink: 'Miễn trừ trách nhiệm',
        };

  return (
    <footer className="site-footer" aria-labelledby="site-footer-title">
      <div className="site-footer__inner">
        <div className="site-footer__grid">
          <section className="site-footer__brand">
            <Link href="/" {...linkProps} className="site-footer__brand-link">
              <span className="site-footer__brand-mark" aria-hidden="true">
                <BrandMark size={44} />
              </span>
              <span>
                <span
                  id="site-footer-title"
                  className="site-footer__brand-name"
                >
                  Kim Tuyến
                </span>
                <span className="site-footer__brand-caption">
                  {copy.caption}
                </span>
              </span>
            </Link>
            <p className="site-footer__description">{copy.description}</p>
          </section>
          <nav aria-label={copy.explore}>
            <h2 className="site-footer__heading">{copy.explore}</h2>
            <ul className="site-footer__links">
              <FooterLink href="/">{copy.priceTable}</FooterLink>
              <FooterLink href="/so-vang">{copy.ledger}</FooterLink>
              <FooterLink href="/cong-cu-vang">{copy.tools}</FooterLink>
              <FooterLink href="/nhip-vang">{copy.pulse}</FooterLink>
              <FooterLink href="/phan-tich">{copy.analysis}</FooterLink>
            </ul>
          </nav>
          <nav aria-label={copy.support}>
            <h2 className="site-footer__heading">{copy.support}</h2>
            <ul className="site-footer__links">
              <FooterLink href="/huong-dan">{copy.guide}</FooterLink>
              <FooterLink href="/bien-tap">{copy.editorial}</FooterLink>
              <FooterLink href="/donate">{copy.donate}</FooterLink>
              <FooterLink href="/terms#lien-he">{copy.contact}</FooterLink>
            </ul>
          </nav>
        </div>
        <div className="site-footer__meta">
          <div className="site-footer__notice">
            <p>{copy.noticeText}</p>
            <Link
              href="/terms#mien-tru-trach-nhiem"
              {...linkProps}
              className="site-footer__notice-link"
            >
              {copy.noticeLink}
            </Link>
          </div>
          <div className="site-footer__bottom">
            <span>© {year} Kim Tuyến · vanghomnay.online</span>
            <nav aria-label={copy.policies} className="site-footer__policies">
              <Link
                href="/privacy"
                {...linkProps}
                className="site-footer__link"
              >
                {copy.privacy}
              </Link>
              <Link href="/terms" {...linkProps} className="site-footer__link">
                {copy.terms}
              </Link>
            </nav>
          </div>
        </div>
      </div>
    </footer>
  );
}
