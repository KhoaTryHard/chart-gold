# Khôi phục duyệt đăng — 10/10/2026

Đã triển khai `editorial_release.mode="owner_review"` cho tất cả bài đang chờ và bài mới. Thiếu hồ sơ pháp lý chỉ là cảnh báo; `status` vẫn là `pending_legal_review`, các trường bằng chứng và người xác nhận vẫn để trống.

## Kết quả thực tế

- Cập nhật thành công 8/8 tin nhắn Telegram đang chờ bằng sửa tin nhắn hiện có; không gửi tin mới hoặc tạo bản nháp thay thế.
- 7/8 bản có nút duyệt. Telegram trả lại message `642` của bài `7B02409BB4` với nút duyệt hiện diện; nội dung giải thích đã chuyển sang cảnh báo: “Hồ sơ pháp lý chưa được xác nhận; chủ trang xem xét trước khi đăng.”
- Bài `01637C1EBF` vẫn bị chặn vì nguồn thời sự quá 24 giờ, hiển thị đúng “Nguồn chưa đủ điều kiện”. Đây là điều kiện nguồn, không phải hồ sơ pháp lý.
- So sánh trước/sau xác nhận mọi trường nội dung, digest, bundle, trạng thái, hạn duyệt và mã tin nhắn của 8 bản giữ nguyên. Số phê duyệt chủ trang, lần phát hành và phê duyệt hai kênh giữ nguyên.

## Thay đổi và kiểm chứng

- Chính sách được dùng chung tại giao diện, callback duyệt, đăng Facebook một kênh và đăng hai kênh. Cấu hình thiếu chế độ mới tiếp tục dùng chế độ nghiêm ngặt.
- Kiểm chứng nội dung, nguồn độc lập còn hạn, hash gói, kiểm tra ảnh, quyền chủ trang và callback Telegram tiếp tục được thực thi.
- Thông báo phân biệt thiếu hồ sơ, lỗi kiểm chứng, nguồn quá hạn, ảnh lỗi và gói thay đổi/thiếu dữ liệu. Tin đã hết hạn giữ nút tạo bản cập nhật.
- 578 kiểm thử bot: 574 đạt, 4 bỏ qua, 0 lỗi. 22/22 kiểm thử website về Hermes v3, review và xác thực tích hợp đạt.
- Chỉ gateway `quan-tri-fanpage` được nạp lại. API website/Hermes v2/v3 không đổi; không chỉnh hoặc triển khai lại mã website trong nhiệm vụ này.
- Production `/`, `/nhip-vang`, `/bien-tap` trả HTTP 200. Signed rejection probes xác nhận kiểm tra miền và digest vẫn hoạt động, không tạo dữ liệu phát hành.

## Bằng chứng

- Backup trước sửa: `C:/Users/LENOVO/kim-tuyen-ai/backups/owner-review-20261010-144849`.
- Phản hồi Telegram và đối chiếu dữ liệu: `C:/Users/LENOVO/kim-tuyen-ai/outputs/owner-review-20261010/telegram-refresh.json`.
- Kiểm thử, diff, thay đổi chính sách và hash: `C:/Users/LENOVO/kim-tuyen-ai/outputs/owner-review-20261010/`.

Việc đăng công khai bắt đầu khi chủ trang bấm nút duyệt đúng phiên bản. Nhiệm vụ này cập nhật quyền duyệt, không tự duyệt hoặc phát hành.
