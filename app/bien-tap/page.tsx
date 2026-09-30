import type { Metadata } from 'next';
import Link from 'next/link';
import { pageMetadata } from '@/lib/seo';
import { getRequestLocale } from '@/lib/request-locale';

export const metadata: Metadata = pageMetadata(
  '/bien-tap',
  'Phương pháp biên tập Nhịp vàng',
  'Cách Nhịp vàng sử dụng dữ liệu, nguồn tham khảo và AI hỗ trợ để tạo bài viết thị trường vàng rõ ràng, có thể kiểm tra.',
);

export default async function EditorialMethodPage() {
  const english = (await getRequestLocale()) === 'en';
  return (
    <main
      id="main-content"
      className="tool-page-content"
      aria-labelledby="editorial-method-title"
    >
      <div className="tool-intro">
        <p className="tool-eyebrow">
          <span aria-hidden="true" />
          {english ? 'Content transparency' : 'Minh bạch nội dung'}
        </p>
        <h1 id="editorial-method-title">{english ? 'Gold Pulse editorial method' : 'Phương pháp biên tập Nhịp vàng'}</h1>
        <p className="tool-description">
          {english ? 'Every article helps readers understand data and make their own decisions. It is not an invitation to buy or sell.' : 'Mỗi bài viết nhằm giúp người đọc hiểu dữ liệu và tự đưa ra quyết định phù hợp; không phải lời mời mua hoặc bán.'}
        </p>
      </div>
      <article className="glass-panel editorial-prose p-5 sm:p-8">
        <h2>{english ? 'Who is responsible?' : 'Ai chịu trách nhiệm?'}</h2>
        <p>
          {english ? 'Kim Tuyến is responsible for editing and publishing content. AI can assist with structure or drafting, but an administrator must check the work before publication.' : 'Kim Tuyến chịu trách nhiệm biên tập và phát hành nội dung. Bản nháp có thể được AI hỗ trợ tạo cấu trúc hoặc diễn đạt, nhưng luôn cần người quản trị kiểm tra trước khi xuất bản.'}
        </p>
        <h2>{english ? 'How we use sources' : 'Chúng tôi dùng nguồn thế nào?'}</h2>
        <p>
          {english ? 'Gold prices, observation times, and calculations are identified with their source. Policy and rate information prioritizes official documents. Articles and blogs are used only for context; we do not copy their text or imagery.' : 'Giá vàng, thời điểm quan sát và phép tính được ghi cùng nguồn. Thông tin chính sách hoặc lãi suất ưu tiên văn bản chính thức. Bài báo và blog chỉ được dùng để đối chiếu bối cảnh; không sao chép nguyên văn hoặc hình ảnh.'}
        </p>
        <h2>{english ? 'AI assistance and publishing' : 'AI hỗ trợ và lịch xuất bản'}</h2>
        <p>
          {english ? 'The system can collect sources, create drafts, suggest metadata, and create illustrations. An administrator reviews the exact version, sources, facts, image, and schedule before public release. Any changed content or image requires review again.' : 'Hệ thống có thể thu thập nguồn, tạo bản nháp, gợi ý metadata và ảnh minh họa. Admin duyệt chính xác phiên bản, nguồn, dữ kiện, ảnh và lịch đăng trước khi bài xuất hiện công khai. Nếu nội dung hoặc ảnh thay đổi, phiên bản mới phải được duyệt lại.'}
        </p>
        <p>
          {english ? 'AI-generated images are clearly labelled as illustrations. They are never presented as event photography, actual price data, or proof of a market claim.' : 'Ảnh tạo bằng AI được ghi rõ là ảnh minh họa. Chúng không được trình bày như ảnh sự kiện, dữ liệu giá thực tế hoặc bằng chứng cho một tuyên bố thị trường.'}
        </p>
        <h2>{english ? 'Corrections' : 'Đính chính'}</h2>
        <p>
          {english ? 'If we identify an incorrect fact or source, the article is updated with its revision time. Content based on fallback data is always labelled as reference material, not a current price.' : 'Nếu phát hiện sai dữ kiện hoặc nguồn, bài sẽ được cập nhật kèm thời gian sửa. Nội dung dựa trên dữ liệu dự phòng luôn được ghi rõ là tham khảo và không phải giá hiện tại.'}
        </p>
        <p>
          <Link
            href="/nhip-vang"
            className="font-semibold text-primary underline"
          >
            {english ? 'Read Gold Pulse' : 'Đọc Nhịp vàng'}
          </Link>
        </p>
      </article>
    </main>
  );
}
