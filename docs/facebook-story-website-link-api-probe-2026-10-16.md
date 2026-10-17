# Kiểm chứng Story có liên kết website qua API — 16/10/2026

## Kết luận

**Chưa có đường API đã được xác minh đáp ứng yêu cầu Story bấm mở đúng bài website.** Luồng Story ảnh đang chạy vẫn tự động qua API, không cần Chrome, nhưng không có liên kết bấm về bài website.

Đã kiểm tra thực tế hướng `/feed` với `target_surface=STORY` và `link`, không chỉ dựa vào việc công cụ Composio có/không có trong danh mục. Trong phép thử trên Page này với Graph API v26.0, tổ hợp đó tạo bài bảng tin, không tạo Story.

## Phạm vi được chủ trang cho phép

- Đích: Page `1262243656966414` — Kim Tuyến - Giá Vàng Hôm Nay.
- Nội dung: tiêu đề và URL của bài website đã duyệt “Vàng có nhiều động lực, cần tách riêng khi đánh giá rủi ro đầu tư”.
- Chủ trang cho phép **đúng một lần thử công khai** và xóa riêng bản thử nếu xuất hiện sai vị trí; không thay đổi bài gốc hoặc Story có sẵn.
- Không dùng Chrome, cookie trình duyệt, API nội bộ Facebook hay dịch vụ trả phí.

## Kết quả kiểm tra

1. [SDK Meta chính thức](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/page.py) có các tham số `link`, `message`, `published`, `target_surface`, với enum `STORY|TIMELINE` trong phương thức tạo feed. Đây là cơ sở chọn tham số thử, chưa phải bằng chứng tạo đúng Story.
2. Bản nháp thử với `published=false` được tạo thành công: `1262243656966414_122123571777425087`. Đọc lại xác nhận chưa công khai, đính kèm loại `share` có URL đúng bài website. Danh sách Story không thay đổi.
3. Đọc trường `target_surface` trên bản nháp bị Meta từ chối với lỗi 100: trường không tồn tại trong phản hồi đọc. Không thể dùng trường này để xác nhận nơi xuất hiện.
4. Sau khi chủ trang cho phép, gọi tạo **một lần duy nhất** với `published=true`, `target_surface=STORY` và cùng URL. Meta trả ID `1262243656966414_122123572305425087`, thời điểm 17:38:49 giờ Việt Nam.
5. ID thử xuất hiện trong `/{page-id}/published_posts`, công khai trên bảng tin. Ba lần đọc Story sau 5, 10 và 15 giây chỉ trả Story cũ `3333351066865652`; không có Story mới.
6. Đã xóa riêng bài thử công khai và bản nháp thử; cả hai thao tác trả `success=true`. Kiểm tra sau dọn dẹp xác nhận bài gốc `1262243656966414_122123566773425087` vẫn là bài mới nhất và Story cũ vẫn tồn tại.

Đây là bằng chứng hướng API đã thử không đạt trên Page/kết nối/phiên bản này, không phải khẳng định mọi API tương lai đều không thể hỗ trợ.

## Đối chiếu tài liệu

- [Page Feed API của Meta](https://developers.facebook.com/docs/graph-api/reference/page/feed/) mô tả đăng bài bảng tin và liên kết/nút kêu gọi hành động cho bài viết. Trang đọc được bằng HTTP trong lượt kiểm tra; nội dung công khai không mô tả một hợp đồng Story có liên kết cho tổ hợp đã thử.
- `/photo_stories` trong SDK hiện có tham số `photo_id`; luồng production đã chứng minh đăng Story ảnh, chưa chứng minh gắn liên kết website.
- [Tài liệu Facebook API của Ayrshare](https://www.ayrshare.com/docs/apis/post/social-networks/facebook#facebook-stories) mô tả Story ảnh/video và bỏ qua văn bản bài viết; tài liệu đã kiểm tra không cung cấp trường link website cho Story. Không tạo tài khoản hoặc mua dịch vụ.

## Trạng thái hệ thống

- Không đưa hướng `/feed` thử nghiệm vào worker tự động.
- Không sửa source bot/website, cấu hình, SQLite, lịch, gateway hoặc mốc bật tính năng trong lượt này.
- Không deploy Vercel vì không có thay đổi source website.
- Bài website, bài Facebook gốc và Story ảnh hiện có được giữ nguyên.
- Chưa hoàn thành yêu cầu mới “Story có liên kết website hoàn toàn qua API”; không báo luồng Story ảnh hiện tại là đã đáp ứng yêu cầu này.

Bằng chứng: `outputs/facebook-story-website-link-20261016/draft-probe.json`, `public-probe-dispatch.json`, `public-probe-result.json`, `cleanup-verification.json`.
