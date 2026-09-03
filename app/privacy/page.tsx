import type { Metadata } from 'next';
import { ExternalLink } from 'lucide-react';

import { LegalPage } from '@/components/legal-page';

export const metadata: Metadata = {
  title: 'Chính sách bảo mật — Kim Tuyến',
  description:
    'Thông tin về dữ liệu được xử lý khi sử dụng dashboard giá vàng SJC Kim Tuyến.',
};

export default function PrivacyPage() {
  return (
    <LegalPage
      eyebrow="Kim Tuyến · Minh bạch dữ liệu"
      title="Chính sách bảo mật"
      intro="Trang này mô tả ngắn gọn dữ liệu Kim Tuyến xử lý khi bạn xem dashboard giá vàng SJC hoặc sử dụng Phân tích AI."
    >
      <section>
        <h2 className="font-heading text-lg font-semibold tracking-[-0.03em]">
          1. Phạm vi dịch vụ
        </h2>
        <p className="mt-2 text-muted-foreground">
          Dashboard SJC là phần công khai, có thể xem mà không cần đăng nhập.
          Phân tích AI là khu vực chỉ dành cho tài khoản quản trị được cấp
          quyền. Việc đăng nhập dùng Google OAuth để xác nhận tài khoản; quyền
          sử dụng được kiểm tra bằng danh sách email quản trị của hệ thống.
        </p>
      </section>

      <section>
        <h2 className="font-heading text-lg font-semibold tracking-[-0.03em]">
          2. Dữ liệu được xử lý
        </h2>
        <ul className="mt-2 list-disc space-y-2 pl-5 text-muted-foreground">
          <li>
            Khi đăng nhập, hệ thống nhận thông tin nhận diện cơ bản từ Google
            cần cho phiên đăng nhập và kiểm tra quyền quản trị.
          </li>
          <li>
            Khi quản trị viên gửi câu hỏi, nội dung câu hỏi và một phần ngữ cảnh
            trò chuyện gần đây được gửi đến máy chủ để tạo phản hồi.
          </li>
          <li>
            Ứng dụng không lưu API key trong trình duyệt và không gửi API key
            đến trình duyệt. Khóa kết nối nhà cung cấp AI được cấu hình ở phía
            máy chủ.
          </li>
        </ul>
      </section>

      <section>
        <h2 className="font-heading text-lg font-semibold tracking-[-0.03em]">
          3. Lịch sử trò chuyện trên thiết bị
        </h2>
        <p className="mt-2 text-muted-foreground">
          Với tài khoản quản trị, lịch sử Phân tích AI được lưu trong
          <code className="mx-1 rounded bg-muted px-1.5 py-0.5 text-xs">
            localStorage
          </code>
          của trình duyệt trên thiết bị đang dùng. Bạn có thể xóa lịch sử bằng
          nút “Xóa lịch sử” trong panel hoặc xóa dữ liệu trang web của trình
          duyệt. Khi gửi câu hỏi mới, một phần lịch sử gần đây có thể được gửi
          cùng câu hỏi để giữ ngữ cảnh trả lời.
        </p>
      </section>

      <section>
        <h2 className="font-heading text-lg font-semibold tracking-[-0.03em]">
          4. Xử lý Phân tích AI
        </h2>
        <p className="mt-2 text-muted-foreground">
          Phân tích AI được xử lý ở phía máy chủ; cấu hình mặc định sử dụng
          Gemini. Máy chủ kiểm tra phiên Google và quyền quản trị trước khi
          chuyển câu hỏi đến nhà cung cấp AI. Phản hồi có thể kèm liên kết đến
          nguồn bên ngoài để bạn tự đối chiếu.
        </p>
      </section>

      <section>
        <h2 className="font-heading text-lg font-semibold tracking-[-0.03em]">
          5. Liên kết nguồn bên ngoài
        </h2>
        <p className="mt-2 flex items-start gap-2 text-muted-foreground">
          Dashboard và phản hồi AI có thể hiển thị liên kết đến nguồn dữ liệu
          hoặc trang web khác. Khi mở các liên kết đó, bạn đang truy cập dịch vụ
          của bên thứ ba và nên xem chính sách của họ.
          <ExternalLink className="mt-1 size-3.5 shrink-0" />
        </p>
      </section>

      <section>
        <h2 className="font-heading text-lg font-semibold tracking-[-0.03em]">
          6. Liên hệ
        </h2>
        <p className="mt-2 text-muted-foreground">
          Nếu có câu hỏi về dữ liệu hoặc cách sử dụng dịch vụ, hãy liên hệ{' '}
          <a
            href="mailto:khoadangntpcl@gmail.com"
            className="font-semibold text-foreground underline-offset-4 hover:underline"
          >
            khoadangntpcl@gmail.com
          </a>
          .
        </p>
      </section>
    </LegalPage>
  );
}
