# Ảnh biên tập có logo và tiêu đề — 15/10/2026

Luồng tạo ảnh thực tế nằm tại `C:/Users/LENOVO/kim-tuyen-ai`; website tiếp nhận ảnh qua bridge hiện có.

## Thay đổi

- Lượt biên tập tạo `imageHeadline` 6–12 từ, tối đa 90 ký tự. Kiểm chứng đối chiếu cùng hồ sơ nguồn; digest và kiểm nội dung được gắn với đúng tiêu đề ảnh.
- Brief v3 dùng bốn phong cách, ba bố cục và hai cách dựng cảnh cho mỗi concept. Lựa chọn, tiêu đề và logo chính thức được lưu và hash ngay khi checkpoint đã kiểm chứng được giữ lại, trước dispatch; ba tổ hợp gần nhất được tránh. Lịch sử dùng thời điểm lựa chọn bất biến, không đổi thứ tự khi review được cập nhật. Checkpoint v2 giữ cách dựng và kiểm cũ.
- AI dựng toàn bộ ảnh có logo tham chiếu và tiêu đề. Codex và Gemini nhận PNG chính thức; xAI bị bỏ qua khi tham chiếu đòi model khác. Codex host lấy từ model đã cấu hình của bot thay cho host cũ hardcode trong adapter Hermes; không sửa Hermes core hoặc đổi model ảnh.
- Bộ kiểm ảnh quan sát ảnh cuối cùng và logo, đối chiếu nguyên văn chữ/dấu, nhận diện, độ rõ và vùng an toàn 6%. Brief mới có `safeFrameInset=0.06`: toàn bộ ảnh AI được thu vào khung 1056×593, đặt giữa canvas 1200×675 màu thương hiệu để bảo đảm viền an toàn. Không vẽ lại chữ hoặc logo. Brief đã lưu trước cải tiến này giữ nguyên cách chuẩn hóa. PNG tối đa 4 MB; giới hạn năm dispatch trên cùng `contentHash` giữ nguyên.
- Prompt xuất thủ công dùng cùng brief và gửi kèm logo. Upload mới lưu brief đã chọn; tái sử dụng ảnh kiểm tra binding bản cha và đầy đủ kết quả kiểm ảnh.
- Website hiển thị ảnh thật 16:9 không phủ chữ/logo, chú thích nằm ngoài ảnh. Metadata ảnh bài dùng 1200×675; ảnh chia sẻ mặc định giữ 1200×630. Không migration hoặc đổi API công khai.

## Kiểm chứng

- Website: 481 kiểm thử đạt, 40 bỏ qua theo môi trường; lint, TypeScript và production build đạt. Thêm 16 kiểm thử cover gồm Chromium desktop/mobile.
- Bot: toàn bộ 697 kiểm thử đạt, 4 bỏ qua theo môi trường. Sau các chỉnh sửa cuối, nhóm phát hành 152 kiểm thử đạt, 1 bỏ qua; gồm khung an toàn, giữ lựa chọn đã lưu, upload/reuse/binding, tiêu đề/nguồn, truyền logo và thời gian chờ Codex tối đa 120 giây trong tổng 180 giây. Sửa thêm việc worker làm tắt logging của tiến trình gọi khi chạy trong cùng interpreter.
- Vercel production `dpl_Bp1tDRVY8DDXZBtTtjWjqu57duVY` READY, alias `https://www.vanghomnay.online`. Kiểm tra `/`, `/nhip-vang`, `/bien-tap` và bài đang công khai trả 200. Desktop 1280 px/mobile 390 px xác nhận ảnh đúng tỷ lệ, tải được, không overlay và metadata đúng.
- Bằng chứng website: `outputs/brand-images-20261015/production-verification.json` và ảnh chụp tương ứng. Bằng chứng bot và backup: `C:/Users/LENOVO/kim-tuyen-ai/outputs/brand-images-20261015/`.

## Nghiệm thu ảnh thật

Đã có bốn ảnh đạt qua worker/provider và bộ kiểm ảnh thực tế: tích lũy vàng, danh mục tài sản, sức mua và quản trị rủi ro. Cả bốn đã xem đầy đủ và ở kích thước điện thoại; gọi lại checkpoint trả đúng ảnh cũ, không tạo lại. Ảnh và prompt được đóng gói tại `outputs/brand-images-20261015/preview.html`, ảnh tổng hợp desktop/mobile và thư mục `posters/`.

Mẫu so sánh và lãi suất trước cải tiến khung an toàn bị loại vì logo sát mép; các lần thử tương thích/timeout/review đã dùng hết năm dispatch cho từng nội dung. Checkpoint, ảnh và lý do được giữ nguyên, không đặt lại hạn mức hoặc nâng cấp tự động brief đang xử lý. Gemini vẫn trả 429 quota; các ảnh đạt được tạo bằng Codex sau sửa host và thời gian chờ.

Gateway fanpage được nạp lại qua Scheduled Task hiện có khi không có lease/tác vụ xuất bản. Các profile khác được giữ hoạt động; kiểm tra fingerprint các bảng drafts, runs, audit, publication_channels, dual_approvals và publication_attempts xác nhận không thay đổi sau lần nạp lại.

Không tự phê duyệt hoặc đăng ảnh nghiệm thu lên website/Facebook.
