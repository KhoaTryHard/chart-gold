# Quy tắc tạo bài và ảnh dự phòng — 13/10/2026

**Cập nhật sau triển khai:** backend nghiên cứu đã chuyển sang tìm/đọc HTTPS
công khai để xử lý toolkit Composio không khả dụng. Xem
[bản sửa công cụ đọc nguồn](editorial-public-web-repair-2026-10-13.md).
Các ghi nhận Composio chưa được khôi phục bên dưới là trạng thái của lần triển
khai chính sách/ảnh trước đó.

Bot ở `C:/Users/LENOVO/kim-tuyen-ai`; website nhận gói Hermes đã kiểm chứng.

## Nội dung

Run mới dùng `editorial-2026-10-13-v2`. Tin thời sự nhận nguồn trong 72 giờ;
nguồn chỉ có ngày nhận hôm nay và hai ngày trước theo lịch Việt Nam, không tạo
giờ giả. Nguồn kiến thức/nền giữ 10 năm. Bài website 120–600 từ, mục tiêu 200–350.

Một nguồn chính thống chỉ đủ cho thông tin do đơn vị đó công bố: NHNN/Fed/BLS
về quyết định/số liệu; WGC về nghiên cứu; SJC/PNJ/BTMC/Vietinbankgold về giá/sản
phẩm của mình. Claim phải có quy thuộc và verifier xác nhận phạm vi công bố.
Tin tổng hợp/nhận định còn yêu cầu hai nguồn gốc độc lập. Toàn văn, thời điểm,
phạm vi dữ kiện và cả hai kênh vẫn được kiểm chứng.

Dữ liệu cũ giữ chính sách cũ. Chính sách được lưu trong hồ sơ và hash kiểm chứng.
Không nhận phiên bản không biết. Bản thất bại/từ chối/hết hạn không khóa chủ đề;
receipt đã đăng vẫn được tính. Tin cập nhật phải có sự kiện/số liệu mới có chứng
cứ; đổi tên, thêm URL hoặc diễn đạt lại không làm thành bài mới.

## Ảnh và prompt

- Tối đa năm yêu cầu tạo ảnh thực tế cho cùng nội dung, gồm fallback, timeout
  và kết quả chưa rõ. Bộ đếm giữ qua restart, Tiếp tục và sửa riêng ảnh. Kiểm tra
  ảnh/upload không tính lượt tạo. Giữ ngân sách tháng hiện có.
- Ảnh do bot tạo vẫn qua AI kiểm tra. Ảnh chủ trang upload bỏ qua AI kiểm duyệt
  nội dung và không ghi AI PASS giả: `origin=owner_upload`,
  `reviewMode=owner_upload_exempt`.
- Bấm **Upload ảnh dự phòng**, trả lời đúng tin của bot trong 30 phút bằng một
  JPEG/PNG/WebP ≤10 MB, ≥640×360, ≤20 MP. Bot chuẩn hóa PNG 1200×675 ≤4 MB,
  bỏ metadata, đóng băng hash. Không kiểm tra thẩm mỹ, liên quan nội dung hay
  tính độc nhất của ảnh upload. Ảnh được chọn ngay và dừng các lần tạo AI tiếp.
- Có thể thêm mô tả trong chú thích; thiếu thì dùng mô tả trung tính theo tiêu
  đề. Telegram/website ghi **Ảnh do chủ trang cung cấp**. Upload không phê duyệt
  đăng; thay ảnh tạo phiên bản mới và làm mất hiệu lực gói duyệt cũ.
- **Lấy prompt tạo ảnh** dùng được khi có bản thảo đã kiểm chứng. Prompt tiếng
  Việt dựa trên đúng bài/phiên bản, kèm `.txt`, không gọi AI và không tiêu lượt.
  Khung 16:9, chủ thể trọn vẹn ở trung tâm; hướng dẫn tránh dữ liệu giả là chỉ
  dẫn tạo ảnh bên ngoài, không được dùng để kiểm duyệt ảnh upload.

## Tích hợp và vận hành

Manifest Hermes có trường tùy chọn `imageOrigin` (`owner_upload` hoặc
`ai_generated`). Trường có mặt được đưa vào gói/hash duyệt và quyết định nhãn
website. Gói v2/v3 cũ thiếu trường giữ cách chuẩn hóa/digest cũ.

Lỗi Composio toolkit không khả dụng được phân loại `web_tools_unavailable`,
dừng thu thập sớm và giữ checkpoint; không báo thành thiếu hai nguồn và không
chuyển đề tài vì lỗi kết nối. Đợt này không thay backend tìm/đọc nguồn.

Phát hành vẫn cần nguồn còn hạn, kiểm chứng nội dung đúng phiên bản và chủ
trang duyệt. Không tự đăng bài nghiệm thu. Sao lưu trước thay đổi, chạy checks,
deploy project Vercel `chart-gold`, nạp lại riêng gateway fanpage và đọc lại
production. Giữ ledger, approval và receipt khi rollback.

## Kết quả triển khai

- Bot: 594 ca, 590 đạt và 4 bỏ qua theo môi trường. Website: 449 đạt,
  32 bỏ qua vì thiếu môi trường DB test riêng. Lint, TypeScript và build đạt.
- Production `dpl_6Kudrycd8ZRwJMpouVbXgPNWP5tT` Ready, alias
  `https://www.vanghomnay.online`. Signed rejection probes xác nhận hai nguồn
  gốc ảnh hợp lệ được nhận và giá trị sai bị chặn trước ghi dữ liệu. Ba trang
  `/`, `/nhip-vang`, `/bien-tap` trả HTTP 200. Không tạo draft/publication probe.
- Gateway `quan-tri-fanpage` đã nạp lại, PID 7308, Telegram connected. Hai
  gateway default và nghiên cứu giữ PID cũ. Plugin đang chạy có hash trùng
  source đã kiểm thử.
- Sao lưu tại `C:/Users/LENOVO/kim-tuyen-ai/backups/editorial-relaxation-20261013-182741`.
  Bằng chứng production tại `outputs/editorial-relaxation-20261013` của bot.
  Chưa nghiệm thu một lần upload thật qua Telegram hoặc tạo bài thật; công cụ
  Composio tìm/đọc của lượt trong ảnh vẫn cần khôi phục riêng.
