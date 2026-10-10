# Triển khai Composio và tạo bài kèm ảnh — 04/10/2026

## Kết quả đã thực hiện

Mã bot ở `C:/Users/LENOVO/kim-tuyen-ai` đã bổ sung chủ đề trong lệnh, checkpoint nội dung trước ảnh, kiểm tra pixels bằng Hermes, tiếp tục bước ảnh và phiên bản đổi ảnh. Giữ lịch 07:00/12:00/18:00 và bridge schema v2. Không thay mã Next.js, API hoặc cơ sở dữ liệu website trong đợt này.

```text
/vang@Manager_Dang_bot moi Chênh lệch mua–bán ảnh hưởng điểm hòa vốn thế nào?
/vang@Manager_Dang_bot tieptuc <MÃ_LƯỢT>
/vang@Manager_Dang_bot doi_anh <MÃ_BÀI>
```

Lệnh không có chủ đề tiếp tục tự chọn đề tài. Chủ đề được lưu trước worker; thiếu nguồn đúng chủ đề thì dừng, không đổi đề tài. Mỗi bản có bài website, caption Facebook và ảnh PNG 1200×675 không chữ/logo. Ảnh được tạo theo visual brief của bài rồi kiểm tra chủ đề, chi tiết bắt buộc, yếu tố giả và bố cục. Alt lấy từ kết quả quan sát ảnh.

Ảnh sai chủ đề được sửa tối đa một lần tự động. Timeout/JSON review lỗi giữ candidate để tiếp tục từ cùng ảnh. Nút Đổi ảnh tạo phiên bản mới; chỉ áp dụng bản còn chờ duyệt. Bài, caption, brief và ảnh được gắn với gói duyệt. Bridge có thể nén lại PNG: so sánh pixels RGB để giữ kết quả kiểm tra ảnh, đồng thời canonical package giữ SHA256 của tệp cuối. Pixels thay đổi thì chặn.

Đã sửa kiểm tra evergreen cũ chặn nhầm phần giải thích chung “niêm yết” và câu “không phải giá hiện tại”. Các bài website dùng bộ quy tắc chung đã kiểm tra nguồn/ngày/claim; caption legacy tiếp tục dùng bộ chặn cũ.

## Kết nối Composio

Kiểm tra qua chính `publisher.connect()` của bot, không chỉ kết nối trong chat:

| Dịch vụ | Kết quả thật |
| --- | --- |
| Facebook | ACTIVE, tài khoản mặc định và Page 1262243656966414 có CREATE_CONTENT/ANALYZE/MANAGE |
| Sheets | ACTIVE; bảng theo dõi đã tạo, ghi–đọc lại 34 bản ghi; không trùng khóa bài/phiên bản |
| Search Console | ACTIVE; chưa có property phù hợp với vanghomnay.online trong tài khoản đã kết nối |
| Google Analytics | ACTIVE; chưa có GA4 property/web stream của website; chưa cài tracking |

Bảng thật: [Kim Tuyến — Theo dõi bài đăng](https://docs.google.com/spreadsheets/d/1HwZjnnDLAp21tJhxWtbDXkEcmqQ3hVln8WOUbYJ9O9I/edit). Bảng riêng tư thuộc tài khoản Google của chủ dự án; cần mở bằng tài khoản đã kết nối. Người dùng đã xác nhận chưa tạo property Search Console/GA4.

CLI `connect_composio_channels.py` có `status`, `connect`, `initialize`, `sync`. Sau OAuth, initialize chọn tài sản phù hợp nếu duy nhất; thiếu hoặc nhiều property được báo rõ. Bảng Sheets có cấu trúc/style và thử ghi–đọc lại khi tài khoản ACTIVE. ID cấu hình lưu tại `data/composio-integrations.local.json`, credentials vẫn do Hermes quản lý.

Reporting dùng outbox SQLite, một dòng theo mã bài/phiên bản, retries có lease và đọc lại. Lỗi Sheets không tạo lại bài website/Facebook. Sau khi bảng được khởi tạo, bot đồng bộ báo cáo ở worker riêng và tick hiện hành; chưa tạo scheduler mới.

## Nghiệm thu thật

- Ba chủ đề ảnh thật: hòa vốn, tích lũy và so sánh nhẫn–miếng. Cả ba qua vision review và được xem trực tiếp.
- Một bài thật đã nghiên cứu, biên tập, kiểm chứng, sửa, lưu checkpoint, tiếp tục từ checkpoint và gửi Telegram. Mã bài **97D01C1DCB**, mã lượt **34e76e07d78949df9092ddfaca0876be**, trạng thái `pending/awaiting_approval`. Ảnh và message bản duyệt đều có ID đã lưu.
- Nội dung thử: “Cơ chế thị trường vàng: Chênh lệch mua–bán ảnh hưởng điểm hòa vốn thế nào?”. Chủ trang phải xem và bấm duyệt trước khi xuất bản. Chưa nghiệm thu một bài công khai mới từ gói này.
- Bộ unittest bot gồm 203 trường hợp; một symlink được bỏ qua do quyền Windows. Kiểm thử nguồn hết tuổi, duplicate event/approval, lỗi ảnh, giới hạn tạo lại, binding ảnh–bài, PNG nén lại, outbox và khởi tạo Google.
- Các lượt thật chưa có phí provider xác minh; `actualCostVnd=null`, không diễn giải thành miễn phí. Ledger ghi riêng lượt tạo và kiểm tra ảnh. Trần tiền chỉ được kiểm soát đủ khi có unit cost; chưa thể bảo đảm lịch ba lượt/ngày nằm trong 150.000đ/tháng.

Bằng chứng máy đọc ở thư mục `outputs/composio-one-command` của dự án. Các PNG và checkpoint đầy đủ vẫn ở bot. Backup trước sửa: `C:/Users/LENOVO/kim-tuyen-ai/backups/composio-one-command-20261004-210429`.

## Phần còn chờ

1. Tạo và xác minh property Search Console, tạo GA4 property/web stream và bổ sung tracking website. OAuth cả ba dịch vụ đã hoàn tất; đây là bước cấu hình tài sản và website riêng.
2. Chủ trang duyệt bản 97D01C1DCB trong Telegram; sau đó kiểm tra website, Facebook và đúng ảnh từ receipts/read-back.
3. Đối chiếu chi phí/quota thực để xác nhận ngân sách, không tự tăng trần hoặc chuyển provider.

Toàn bộ kế hoạch chưa được ghi nhận hoàn tất khi các mục này còn chờ. Phần mã đã kiểm thử không đồng nghĩa các tài khoản Google hoặc bài công khai mới đã hoạt động.

## Bổ sung sau khi OAuth hoàn tất

Đã xác nhận ACTIVE từ runtime bot, khởi tạo Sheets và đồng bộ 34 bản ghi, gồm 97D01C1DCB. Sửa giới hạn khởi tạo 55 giây thành 240 giây, lưu tiến độ định dạng để tiếp tục đúng bảng đã tạo. Retry timeout giữ các dòng đã đồng bộ thành công. Worker báo cáo dùng đúng Python venv của Hermes và không được chạy từ SQLite kiểm thử/copy. Một lượt kiểm thử ban đầu khởi động thừa worker đồng bộ; chúng đã kết thúc và bộ chặn được kiểm thử để không lặp lại. Chỉ lịch sử bài thật được đồng bộ, không phát sinh thao tác xuất bản.

Đã khởi động lại riêng Gateway quan-tri-fanpage sau kiểm thử. Bằng chứng kết nối và Sheet ở `outputs/composio-one-command/google-connections.json`. Search Console/GA4 chưa có tài sản để đo; không coi trạng thái ACTIVE là dữ liệu analytics đã hoạt động.
