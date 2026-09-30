'use client';

import Link from 'next/link';
import { BrandMark } from '@/components/brand-mark';
import { useLocale } from '@/components/locale-provider';

const linkProps = { prefetch: false } as const;

function FooterLink({ href, children }: { href: string; children: React.ReactNode }) {
  return <li><Link href={href} {...linkProps} className="site-footer__link">{children}</Link></li>;
}

export function SiteFooter() {
  const { locale } = useLocale();
  const year = new Date().getFullYear();
  const copy = locale === 'en' ? {
    caption: 'Vietnam gold prices',
    description: 'Follow Vietnam gold prices, compare dealer prices, and calculate gains, losses, and break-even points. Explore Gold Pulse and AI Analysis to make sense of market data and movement.',
    explore: 'Explore', priceTable: 'Gold price table', ledger: 'Gold ledger', pulse: 'Gold Pulse', articles: 'All articles', worldGold: 'World gold chart', analysis: 'AI Analysis', guide: 'User guide',
    tools: 'Gold tools', compare: 'Compare gold prices', breakEven: 'Calculate gains, losses, and break-even', ringCompare: 'Compare 9999 rings', barCompare: 'Compare SJC gold bars', ringBarCompare: '9999 rings and SJC gold bars',
    support: 'Transparency & support', editorial: 'Editorial method', privacy: 'Privacy policy', terms: 'Terms of use', donate: 'Support the project',
    notice: 'Information & AI notice',
    noticeText: 'Gold prices, articles, calculations, and AI responses are provided for information only. They are not investment or financial advice for your circumstances. AI can be wrong or incomplete; forecasts and scenarios do not guarantee future performance or returns. Data can be delayed or a fallback. Check the source, observation time, actual trading price, and fees before making a decision.',
    noticeLink: 'Read the full disclaimer', contact: 'Contact & feedback',
  } : {
    caption: 'Giá vàng Việt Nam',
    description: 'Theo dõi giá vàng Việt Nam, so sánh giá mua bán, tính lãi/lỗ và hòa vốn. Khám phá Nhịp vàng và Phân tích AI để hiểu thêm dữ liệu và chuyển động thị trường.',
    explore: 'Khám phá', priceTable: 'Bảng giá vàng', ledger: 'Sổ vàng', pulse: 'Nhịp vàng', articles: 'Tất cả bài viết', worldGold: 'Biểu đồ vàng thế giới', analysis: 'Phân tích AI', guide: 'Hướng dẫn sử dụng',
    tools: 'Công cụ vàng', compare: 'So sánh giá vàng', breakEven: 'Tính lãi/lỗ và hòa vốn', ringCompare: 'So sánh nhẫn 9999', barCompare: 'So sánh vàng miếng SJC', ringBarCompare: 'Nhẫn 9999 và vàng miếng SJC',
    support: 'Minh bạch & hỗ trợ', editorial: 'Phương pháp biên tập', privacy: 'Chính sách bảo mật', terms: 'Điều khoản sử dụng', donate: 'Ủng hộ dự án',
    notice: 'Thông tin tham khảo & AI',
    noticeText: 'Giá vàng, bài viết, phép tính và phản hồi AI chỉ cung cấp thông tin tham khảo, không thay thế tư vấn đầu tư hoặc tài chính phù hợp với hoàn cảnh của bạn. AI có thể sai hoặc thiếu thông tin; dự báo và kịch bản không bảo đảm diễn biến tương lai hay lợi nhuận. Dữ liệu có thể chậm cập nhật hoặc là bản dự phòng. Hãy đối chiếu nguồn, thời điểm dữ liệu, giá giao dịch thực tế và các khoản phí trước khi quyết định.',
    noticeLink: 'Đọc đầy đủ về miễn trừ trách nhiệm', contact: 'Liên hệ & góp ý',
  };

  return (
    <footer className="site-footer" aria-labelledby="site-footer-title">
      <div className="site-footer__inner">
        <div className="site-footer__grid">
          <section className="site-footer__brand">
            <Link href="/" {...linkProps} className="site-footer__brand-link">
              <span className="site-footer__brand-mark" aria-hidden="true"><BrandMark size={38} /></span>
              <span><span id="site-footer-title" className="site-footer__brand-name">Kim Tuyến</span><span className="site-footer__brand-caption">{copy.caption}</span></span>
            </Link>
            <p className="site-footer__description">{copy.description}</p>
          </section>
          <nav aria-label={copy.explore}><h2 className="site-footer__heading">{copy.explore}</h2><ul className="site-footer__links">
            <FooterLink href="/">{copy.priceTable}</FooterLink><FooterLink href="/so-vang">{copy.ledger}</FooterLink><FooterLink href="/#nhip-vang">{copy.pulse}</FooterLink><FooterLink href="/nhip-vang">{copy.articles}</FooterLink><FooterLink href="/#vang-the-gioi">{copy.worldGold}</FooterLink><FooterLink href="/phan-tich">{copy.analysis}</FooterLink><FooterLink href="/huong-dan">{copy.guide}</FooterLink>
          </ul></nav>
          <nav aria-label={copy.tools}><h2 className="site-footer__heading">{copy.tools}</h2><ul className="site-footer__links">
            <FooterLink href="/cong-cu-vang#so-sanh">{copy.compare}</FooterLink><FooterLink href="/cong-cu-vang#hoa-von">{copy.breakEven}</FooterLink><FooterLink href="/so-sanh/nhan-9999">{copy.ringCompare}</FooterLink><FooterLink href="/so-sanh/vang-mieng-sjc">{copy.barCompare}</FooterLink><FooterLink href="/so-sanh/nhan-9999-va-vang-mieng-sjc">{copy.ringBarCompare}</FooterLink>
          </ul></nav>
          <nav aria-label={copy.support}><h2 className="site-footer__heading">{copy.support}</h2><ul className="site-footer__links">
            <FooterLink href="/bien-tap">{copy.editorial}</FooterLink><FooterLink href="/privacy">{copy.privacy}</FooterLink><FooterLink href="/terms">{copy.terms}</FooterLink><FooterLink href="/donate">{copy.donate}</FooterLink>
          </ul></nav>
        </div>
        <section className="site-footer__notice" aria-labelledby="site-footer-notice-title"><div>
          <h2 id="site-footer-notice-title" className="site-footer__heading">{copy.notice}</h2><p>{copy.noticeText}</p>
        </div><Link href="/terms#mien-tru-trach-nhiem" {...linkProps} className="site-footer__notice-link">{copy.noticeLink}</Link></section>
        <div className="site-footer__bottom"><span>© {year} Kim Tuyến · vanghomnay.online</span><Link href="/terms#lien-he" {...linkProps} className="site-footer__contact-link">{copy.contact}</Link></div>
      </div>
    </footer>
  );
}
