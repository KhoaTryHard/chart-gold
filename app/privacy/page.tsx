import type { Metadata } from 'next';
import { ExternalLink } from 'lucide-react';

import { LegalPage } from '@/components/legal-page';
import { getRequestLocale } from '@/lib/request-locale';
import { pageMetadata } from '@/lib/seo';

export const metadata: Metadata = pageMetadata(
  '/privacy',
  'Chính sách bảo mật',
  'Thông tin về dữ liệu được xử lý khi sử dụng bảng giá, Sổ vàng và Phân tích AI Kim Tuyến.',
);

export default async function PrivacyPage() {
  const english = (await getRequestLocale()) === 'en';
  return (
    <LegalPage
      eyebrow={english ? 'Kim Tuyến · Data transparency' : 'Kim Tuyến · Minh bạch dữ liệu'}
      title={english ? 'Privacy policy' : 'Chính sách bảo mật'}
      intro={english
        ? 'This page summarizes the data Kim Tuyến handles when you view prices, use the account Gold Ledger, read Gold Pulse, or use AI Analysis.'
        : 'Trang này mô tả ngắn gọn dữ liệu Kim Tuyến xử lý khi bạn xem bảng giá, dùng Sổ vàng theo tài khoản, đọc Nhịp vàng hoặc sử dụng Phân tích AI.'}
      updatedAt="13/09/2026"
      locale={english ? 'en' : 'vi'}
    >
      <section>
        <h2 className="font-heading text-lg font-semibold tracking-[-0.03em]">{english ? '1. Service scope' : '1. Phạm vi dịch vụ'}</h2>
        <p className="mt-2 text-muted-foreground">{english ? 'The gold price table is public. Gold Ledger requires a verified Google account so transactions can sync across your devices. AI Analysis also checks the session, access, plan, and quota before processing a question.' : 'Bảng giá vàng là phần công khai. Sổ vàng yêu cầu tài khoản Google đã xác minh để đồng bộ giao dịch giữa các thiết bị. Phân tích AI cũng kiểm tra phiên, quyền, gói và quota trước khi xử lý câu hỏi.'}</p>
      </section>
      <section>
        <h2 className="font-heading text-lg font-semibold tracking-[-0.03em]">{english ? '2. Data processed' : '2. Dữ liệu được xử lý'}</h2>
        <ul className="mt-2 list-disc space-y-2 pl-5 text-muted-foreground">
          {english ? <><li>When you sign in, the service receives basic identity information from Google for the session, billing account, and access reconciliation.</li><li>When you submit a question, its content and a small amount of recent chat context are sent to the server to create a response. The server records quota, provider, model, and token events; it does not store question content in operational logs.</li><li>Payment and donation records retain only the data needed for reconciliation, support, fraud prevention, accounting, and legal obligations.</li><li>The application does not store or send AI API keys to the browser. Provider credentials are configured on the server.</li></> : <><li>Khi đăng nhập, hệ thống nhận thông tin nhận diện cơ bản từ Google cần cho phiên đăng nhập, tài khoản billing và đối soát quyền.</li><li>Khi người dùng gửi câu hỏi, nội dung câu hỏi và một phần ngữ cảnh trò chuyện gần đây được gửi đến máy chủ để tạo phản hồi; server lưu sự kiện quota, provider, model và token, không lưu câu hỏi vào log vận hành.</li><li>Dữ liệu thanh toán và ủng hộ chỉ giữ thông tin cần thiết cho đối soát, hỗ trợ, phòng chống gian lận, kế toán và nghĩa vụ pháp lý.</li><li>Ứng dụng không lưu API key trong trình duyệt và không gửi API key đến trình duyệt. Khóa kết nối nhà cung cấp AI được cấu hình ở phía máy chủ.</li></>}
        </ul>
      </section>
      <section>
        <h2 className="font-heading text-lg font-semibold tracking-[-0.03em]">{english ? '3. Account history and ledger cache' : '3. Lịch sử tài khoản và cache sổ'}</h2>
        {english ? <><p className="mt-2 text-muted-foreground">For signed-in accounts, new AI conversations are stored on the server under the Google account for 30 days after the latest accepted question. Viewing history does not extend that period. Old browser <code className="mx-1 rounded bg-muted px-1.5 py-0.5 text-xs">localStorage</code> history is not imported into the server history.</p><p className="mt-2 text-muted-foreground">The Gold Ledger at <code className="mx-1 rounded bg-muted px-1.5 py-0.5 text-xs">/so-vang</code> is stored on the server under your Google account and cached locally for offline viewing. A transaction is confirmed only after the server accepts it. JSON backups remain available for recovery.</p><p className="mt-2 text-muted-foreground">An investment profile is optional and is stored only after you save it. If you choose to use it with AI Analysis, the profile is sent with that question for personalization and is not synchronized to the app database.</p></> : <><p className="mt-2 text-muted-foreground">Với tài khoản đã đăng nhập, các cuộc trò chuyện Hỏi AI mới được lưu trên máy chủ theo tài khoản Google trong 30 ngày kể từ câu hỏi gần nhất được chấp nhận. Chỉ xem lịch sử không gia hạn thời hạn này. Lịch sử cũ trong <code className="mx-1 rounded bg-muted px-1.5 py-0.5 text-xs">localStorage</code> của trình duyệt không được tự nhập vào lịch sử máy chủ.</p><p className="mt-2 text-muted-foreground">Sổ vàng tại <code className="mx-1 rounded bg-muted px-1.5 py-0.5 text-xs">/so-vang</code> được lưu trên máy chủ theo tài khoản Google và có cache cục bộ để xem khi mất mạng. Giao dịch chỉ được xác nhận sau khi máy chủ nhận thành công. Bản sao JSON vẫn dùng được để khôi phục sổ.</p><p className="mt-2 text-muted-foreground">Hồ sơ đầu tư là tùy chọn và chỉ được lưu khi bạn bấm Lưu. Nếu chọn dùng hồ sơ với Phân tích AI, hồ sơ được gửi cùng câu hỏi để cá nhân hóa và không đồng bộ lên cơ sở dữ liệu ứng dụng.</p></>}
      </section>
      <section>
        <h2 className="font-heading text-lg font-semibold tracking-[-0.03em]">{english ? '4. AI Analysis processing' : '4. Xử lý Phân tích AI'}</h2>
        <p className="mt-2 text-muted-foreground">{english ? 'AI Analysis is processed server-side. The server checks the Google session, entitlement, and quota before sending a question to a configured AI provider. A response can include external links for you to verify.' : 'Phân tích AI được xử lý ở phía máy chủ. Máy chủ kiểm tra phiên Google, entitlement và quota trước khi gửi câu hỏi đến nhà cung cấp AI được cấu hình. Phản hồi có thể kèm liên kết bên ngoài để bạn tự đối chiếu.'}</p>
      </section>
      <section>
        <h2 className="font-heading text-lg font-semibold tracking-[-0.03em]">{english ? '5. External sources and links' : '5. Liên kết nguồn bên ngoài'}</h2>
        <p className="mt-2 flex items-start gap-2 text-muted-foreground">{english ? 'The dashboard and AI responses can show links to sources or other websites. Opening a link visits a third-party service, so review its policy.' : 'Dashboard và phản hồi AI có thể hiển thị liên kết đến nguồn dữ liệu hoặc trang web khác. Khi mở liên kết, bạn đang truy cập dịch vụ bên thứ ba và nên xem chính sách của họ.'}<ExternalLink className="mt-1 size-3.5 shrink-0" /></p>
        <p className="mt-2 text-muted-foreground">{english ? 'The World gold chart may load TradingView and OANDA data under its widget configuration. The app does not send AI history, investment profile, or account information to that widget.' : 'Biểu đồ Vàng thế giới có thể tải TradingView và dữ liệu OANDA theo cấu hình widget. Ứng dụng không gửi lịch sử AI, hồ sơ đầu tư hoặc thông tin tài khoản vào widget đó.'}</p>
      </section>
      <section>
        <h2 className="font-heading text-lg font-semibold tracking-[-0.03em]">{english ? '6. Retention and requests' : '6. Lưu trữ và yêu cầu dữ liệu'}</h2>
        <p className="mt-2 text-muted-foreground">{english ? 'Operational records are retained only as long as needed for support, fraud prevention, accounting, and legal obligations. You can clear on-device history, profile, and ledger from the app or browser. To request account deletion or an export of server records, contact us and include the account email; payment records may be retained where law requires.' : 'Dữ liệu vận hành chỉ được lưu trong thời gian cần thiết cho hỗ trợ, phòng chống gian lận, kế toán và nghĩa vụ pháp lý. Bạn có thể xóa lịch sử, hồ sơ và sổ trên thiết bị từ ứng dụng hoặc trình duyệt. Để yêu cầu xóa tài khoản hoặc xuất dữ liệu máy chủ, hãy liên hệ và cung cấp email tài khoản; dữ liệu thanh toán có thể phải lưu theo quy định pháp luật.'}</p>
      </section>
      <section>
        <h2 className="font-heading text-lg font-semibold tracking-[-0.03em]">{english ? '7. Contact' : '7. Liên hệ'}</h2>
        <p className="mt-2 text-muted-foreground">{english ? 'For questions about data or use of the service, contact' : 'Nếu có câu hỏi về dữ liệu hoặc cách sử dụng dịch vụ, hãy liên hệ'} <a href="mailto:khoadangnguyen.dev@gmail.com" className="font-semibold text-foreground underline-offset-4 hover:underline">khoadangnguyen.dev@gmail.com</a>.</p>
      </section>
    </LegalPage>
  );
}
