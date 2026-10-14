# Sửa lỗi công cụ tìm/đọc nguồn — 13/10/2026

Lượt `9753bc11c88f4142b5d3186be831b50c` dừng ở lần tìm kiếm đầu tiên, chưa đọc
nguồn nào. Adapter ép gọi `COMPOSIO_SEARCH_WEB` và
`COMPOSIO_SEARCH_FETCH_URL_CONTENT`, nhưng toolkit `composio_search` không khả
dụng trong tài khoản hiện tại. Lần triển khai trước đã sửa phân loại/thông báo
lỗi và chính sách; chưa thay backend theo phạm vi đã chốt lúc đó.

## Thay đổi thực tế

- Bot chọn `config.json.research_web_backend=public_web`. Tìm kiếm qua DDGS
  trong worker có deadline; đọc HTTPS công khai trực tiếp và lấy phần toàn văn
  bằng Trafilatura. Không cần kết nối Composio hoặc API key mới cho nghiên cứu.
- Dùng chỉ mục news cho tin thời sự, chỉ mục text cho kiến thức. Không có kết
  quả là danh sách rỗng, không gán thành lỗi kết nối. Ngày trong search snippet
  không được dùng làm ngày bằng chứng; lấy ngày từ trang nguồn thật.
- Giữ allowlist, candidate IDs, trần 4 query/4 lượt đọc/8 URL/180 giây, checksum,
  cache 15 phút, tuổi nguồn và kiểm chứng độc lập. Không chấp nhận preview,
  nội dung bị cắt, paywall/challenge hoặc nội dung của URL redirect khác.
- URL Fed gợi ý đã xác minh chuyển từ `.htm` sang `.html`; dùng đúng URL thật.
  Giữ ngày xuất bản thô và chỉ chuẩn hóa định dạng/spacing có sẵn, không thêm
  giờ/múi giờ hoặc lấy ngày từ slug.
- Facebook, Google và báo cáo tiếp tục dùng kết nối Composio hiện có. Các gói
  duyệt, ảnh upload và chống đăng trùng giữ nguyên.

## Bằng chứng

`scripts/verify_public_web_worker.py` chạy đúng JSONL worker và ledger của bot,
không chạy model, không tạo nháp, duyệt hay đăng bài. Probe thực tế đã tìm được
4 ứng viên và đọc hai nguồn gốc độc lập: WGC 23.167 ký tự và Fed 22.485 ký tự,
toàn văn không cắt, checksum đúng và ngày hợp lệ cho bài kiến thức. Một query,
một lượt đọc, hai URL; không còn `web_tools_unavailable`.

Probe riêng cho news đọc được các bài VnExpress đúng ngày. Đây chỉ xác nhận
khả năng tìm/đọc; nguồn còn phải đúng chủ đề và hỗ trợ claim, không được coi là
hai nguồn xác nhận cùng sự kiện hoặc một bài đã kiểm chứng hoàn chỉnh.

Mã bot nằm ở `C:/Users/LENOVO/kim-tuyen-ai`. Cài dependencies bằng
`uv pip install --python <Hermes venv python> -r requirements-web.txt`.
Backup nguồn/cấu hình trước sửa:
`backups/public-web-repair-20261013-190742`. Log/receipts/probe riêng giữ ở
`outputs/public-web-repair-20261013`. Không tự chạy lại hoặc phê duyệt bài cũ.
