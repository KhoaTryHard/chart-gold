import type { Metadata } from 'next';
import { ExternalLink } from 'lucide-react';

import { LegalPage } from '@/components/legal-page';

export const metadata: Metadata = {
  title: 'Điều khoản sử dụng — Kim Tuyến',
  description:
    'Điều khoản sử dụng dashboard giá vàng SJC và Phân tích AI của Kim Tuyến.',
};

export default function TermsPage() {
  return (
    <LegalPage
      eyebrow="Kim Tuyến · Sử dụng dịch vụ"
      title="Điều khoản sử dụng"
      intro="Các điều khoản dưới đây giúp làm rõ phạm vi của dashboard giá vàng SJC và khu vực Phân tích AI."
    >
      <section>
        <h2 className="font-heading text-lg font-semibold tracking-[-0.03em]">
          1. Dashboard công khai
        </h2>
        <p className="mt-2 text-muted-foreground">
          Kim Tuyến cung cấp biểu đồ và chỉ số tham khảo từ dữ liệu giá SJC,
          cùng các liên kết để đối chiếu nguồn. Dữ liệu có thể được cập nhật
          chậm, tạm thời không khả dụng hoặc hiển thị bản dự phòng; hãy kiểm tra
          nguồn chính thức trước khi sử dụng.
        </p>
      </section>

      <section>
        <h2 className="font-heading text-lg font-semibold tracking-[-0.03em]">
          2. Phân tích AI dành cho quản trị viên
        </h2>
        <p className="mt-2 text-muted-foreground">
          Phân tích AI chỉ dành cho tài khoản quản trị nằm trong allowlist và
          đăng nhập bằng Google. Bạn không được cố gắng vượt qua bước đăng nhập,
          kiểm tra quyền hoặc giới hạn kỹ thuật của dịch vụ.
        </p>
      </section>

      <section>
        <h2 className="font-heading text-lg font-semibold tracking-[-0.03em]">
          3. Tính chất tham khảo
        </h2>
        <p className="mt-2 text-muted-foreground">
          Biểu đồ, tín hiệu xu hướng, nguồn liên kết và câu trả lời AI chỉ có
          mục đích thông tin, không phải tư vấn đầu tư, tư vấn tài chính hay lời
          đề nghị mua bán. Kim Tuyến không cam kết rằng dữ liệu, dự báo hoặc
          phản hồi AI luôn đầy đủ, chính xác, kịp thời hay phù hợp với hoàn cảnh
          của bạn. Bạn tự đánh giá thông tin và tự chịu trách nhiệm cho quyết
          định của mình.
        </p>
      </section>

      <section>
        <h2 className="font-heading text-lg font-semibold tracking-[-0.03em]">
          4. Nhà cung cấp và liên kết bên ngoài
        </h2>
        <p className="mt-2 flex items-start gap-2 text-muted-foreground">
          Dữ liệu giá và nguồn tham khảo có thể đến từ các trang bên ngoài.
          Gemini được gọi ở phía máy chủ cho Phân tích AI theo cấu hình triển
          khai. Các dịch vụ bên ngoài có điều khoản và chính sách riêng; hãy xem
          xét chúng trước khi mở liên kết hoặc cung cấp thông tin.
          <ExternalLink className="mt-1 size-3.5 shrink-0" />
        </p>
      </section>

      <section>
        <h2 className="font-heading text-lg font-semibold tracking-[-0.03em]">
          5. Liên hệ
        </h2>
        <p className="mt-2 text-muted-foreground">
          Góp ý hoặc câu hỏi về dịch vụ:
          <a
            href="mailto:khoadangntpcl@gmail.com"
            className="ml-1 font-semibold text-foreground underline-offset-4 hover:underline"
          >
            khoadangntpcl@gmail.com
          </a>
          .
        </p>
      </section>
    </LegalPage>
  );
}
