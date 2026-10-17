# Mã bot cho đợt chuyển sang R2 Standard

Thư mục này lưu 13 file nguồn đã cài đặt và kiểm thử tại
`C:/Users/LENOVO/kim-tuyen-ai`. Đây là phần bổ sung/thay thế cho ứng dụng bot hiện
có, không phải một ứng dụng độc lập và không được website Next.js import.

- `media_storage.py`: registry riêng, archive/hydrate R2, cache local bảy ngày,
  pin file đang xử lý và worker dọn hằng ngày.
- Các module newsroom/image/video/bridge: giữ nguyên danh tính bản duyệt và dùng
  media trên cloud khi file local đã hết cache.
- `video_upload.mjs`: upload MP4 bằng grant R2 có hạn hoặc giao thức Blob cũ;
  hỗ trợ URL virtual-host và path-style đúng bucket production.
- Hai file `test_*.py` kiểm thử cache, worker, chữ ký và bộ tải video. Các bộ
  kiểm thử nền và các module bot khác nằm trong ứng dụng bot hiện có.
- `requirements-storage.txt` ghi phiên bản dependency đã được kiểm chứng.

`source-manifest.json` chứa SHA-256 của nguồn sau khi chuẩn hóa xuống dòng LF để
đối chiếu giữa Windows và Linux. Không chứa khóa hoặc dữ liệu vận hành.

Thông tin cài đặt, kiểm thử, chính sách dọn và quay lại kho cũ nằm trong
[báo cáo R2](../../docs/r2-migration-2026-10-17.md). Trình cài
`scripts/r2-install-bot.py` vẫn yêu cầu baseline/registry cục bộ của đợt migration
và phải chạy khi gateway riêng của bot đã dừng; không chạy từ CI của website.

Khóa, config, SQLite, media và backup không được lưu trong thư mục nguồn này.
