# Telegram: một lần duyệt, đăng website và Facebook

Luồng mới chạy giữa website `chart-gold` và bot ở `C:\Users\LENOVO\kim-tuyen-ai`. Nội dung mới dùng package schema v2; bản cũ vẫn giữ digest, audit và trạng thái riêng.

## Admin sử dụng

1. Bot tạo bài website đầy đủ và caption Facebook từ cùng hồ sơ nguồn; kiểm chứng độc lập cả hai bản.
2. Bot chuẩn bị nháp website, giữ URL và ảnh PNG đã chuẩn hóa. Telegram gửi ảnh, caption, URL đích, nút **Xem bản website**, nguồn và kết quả kiểm chứng.
3. Chủ trang bấm **Duyệt và đăng Website + Facebook** một lần. Các thao tác khác không được coi là approval.
4. Worker đăng website, kiểm tra public revision và hash ảnh, rồi gửi Facebook bằng URL ảnh website. Không dùng `s3key` Composio cũ.
5. Telegram chỉ báo **Đã đăng cả hai nơi** khi có receipt website, Facebook post, bình luận nguồn và read-back. Mỗi kênh có URL và trạng thái riêng.

Nếu website đã đăng nhưng Facebook lỗi, không tạo lại website. **Tiếp tục phần chưa hoàn tất** sử dụng lại approval cũ với gói không thay đổi. Một create Facebook mất phản hồi phải đối soát; zero matches hoặc phân trang chưa đầy đủ không tự cho phép tạo lại. Nếu Facebook đã trả post/comment ID, worker chỉ tiếp tục bước thiếu. Sửa nội dung hoặc ảnh phải tạo gói mới và duyệt lại.

## Bridge và dữ liệu

Các route dịch vụ nằm dưới `/api/editorial/integrations/hermes`: `POST prepare`, `GET packages/{id}`, `GET packages/{id}/media`, `POST packages/{id}/publish`. API Admin Google và lịch thủ công vẫn dùng luồng riêng. Gói Telegram xuất hiện ở **Cần xử lý** với nhãn Telegram, không thể duyệt nhầm bằng bulk Admin web.

Chữ ký HMAC-SHA256 bao phủ method, path/query, timestamp và SHA-256 raw body; timestamp lệch tối đa năm phút. Vercel dùng `HERMES_EDITORIAL_ENABLED`, `HERMES_EDITORIAL_SECRET`, key kế tiếp tùy chọn và ID owner/chat/Page. Secret local nằm trong `bridge-secret.json` của bot, không nằm trong repo hoặc log. Cờ HTTP localhost chỉ dành cho E2E, bị chặn khi `VERCEL=1`.

PostgreSQL migration `0016_editorial_integration` bổ sung mapping external root/draft/version, digest, revision, bằng chứng Telegram và receipt. Prepare cùng key/cùng payload trả lại kết quả; payload khác cùng key trả 409. Publish dùng article lock và chung transaction xuất bản với scheduler, không chiếm slot. Replay sau gỡ/thay thế bài bị chặn.

Bot SQLite bổ sung `publication_channels` và `dual_approvals`, giữ nguyên các bảng cũ. Package chuẩn hóa là nguồn nội dung duy nhất; transport key không nằm trong digest. Ảnh đóng băng tại `assets/approved/<sha256>.png`. Request prepare được lưu trước network call để timeout không làm mất identity. Claim/lease bảo vệ từng package và từng lần chuẩn bị. Bằng chứng quan trọng được commit trước public write; lỗi checkpoint ngăn gửi.

State từng kênh: `pending`, `publishing`, `published`, `retryable_failed`, `needs_reconcile`, `blocked`. Retry an toàn sau 1/5/15 phút; không tự lặp public write có kết quả chưa biết. MCP có deadline request 60 giây, lượt Facebook 180 giây, bridge request 30 giây. Gateway phục hồi ledger sau restart; không tự phê duyệt bài.

## Kiểm thử và triển khai

Website đã qua 379 unit/integration và 18 Playwright E2E; PostgreSQL riêng kiểm tra hai publish đồng thời, trạng thái gỡ/sửa, mapping root phiên bản, API read-only, chữ ký/rotation/kill switch. Bot có 60 unittest về phần cũ và hai kênh: partial success, lost result, checkpoint failure, comment ID retention, immutable package và prepare retry.

Migration production chỉ thêm bảng/index. Đã backup SQLite và các file bot trước sửa. Bridge deploy ban đầu tắt, sau đó cấu hình secret và deploy bật. Gateway profile `quan-tri-fanpage` được restart riêng; không thay đổi các profile khác. Kết quả test/deployment ở `outputs/dual-publication`.

Bản `7768C94AE3` cũ được đối soát chỉ đọc; không dùng approval caption-only để đăng thêm website. Các lần tạo nội dung bị kiểm chứng FAIL không được xuất bản. Chỉ bản v2 đã PASS mới được gửi Admin duyệt lại.

## Nghiệm thu thật ngày 02/10/2026

Admin đã duyệt gói kết hợp `E87D1A565D` lúc **20:49:25 giờ Việt Nam**, bằng callback Telegram thật của chủ trang trong nhóm đã cấu hình. Website và Facebook đều chuyển thành `published/readback_confirmed`; Telegram cập nhật message `362` với kết quả và hai đường dẫn.

| Kênh | Bài thật | Bằng chứng đọc lại |
|---|---|---|
| Website | [Vàng trong danh mục: thanh khoản, đa dạng hóa và giới hạn của “phi đô la hóa”](https://www.vanghomnay.online/nhip-vang/vang-trong-danh-muc-thanh-khoan-da-dang-hoa-va-gioi-han-cua-phi-do-la-hoa) | Trang public đọc được; revision `0135d9e1-71c4-465c-845a-5f2bc71f7b27` và hash Markdown trùng gói duyệt; ảnh PNG đọc được và SHA-256 trùng ảnh duyệt. |
| Facebook | [Bài trên fanpage](https://www.facebook.com/122093430315425087/posts/122120491947425087) | Đọc lại caption đúng gói duyệt, một ảnh, một bình luận đúng toàn bộ phần nguồn; quét Page đầy đủ tìm thấy đúng một bài khớp. |

Đã chạy lại worker với **chính package đã xuất bản**. Worker trả lại `published`; số attempt từng kênh không tăng, Page vẫn có một bài khớp và một bình luận nguồn. Không có approval mới hoặc thao tác tạo bài/bình luận mới trong lần chạy lại.

Bridge đã deploy production trên project Vercel `chart-gold`, deployment `dpl_3jmB3TuDJ9nLoyhKeMkp9sVAG2Tj`, alias `www.vanghomnay.online`. Chữ ký thật đã được kiểm tra qua prepare, lấy ảnh, publish và đọc receipt. Request thiếu chữ ký bị từ chối 401 khi bật tích hợp; khi tắt tích hợp trả 503.

Bằng chứng máy đọc được nằm tại `outputs/dual-publication/live-acceptance.json`; các kết quả kiểm thử tại `unit-results.json` và `e2e-results.json` trong cùng thư mục. Các tình huống lỗi/timeout/cạnh tranh được kiểm thử trên dữ liệu cô lập. Nghiệm thu production kiểm tra luồng thành công thật và chạy lại worker; không chủ động gây mất phản hồi trong lúc tạo bài công khai. Kết quả post ID hoặc comment ID chưa biết vẫn cần đối soát theo ledger, không suy ra quyền gửi lại từ một lần đọc chưa thấy bài.

## Rollback

Tắt `HERMES_EDITORIAL_ENABLED`, deploy lại và dừng Gateway fanpage nếu cần dừng toàn bộ automation. Giữ SQLite/PostgreSQL ledger, approval và ID/URL đã xuất bản; không xóa hoặc gỡ bài thành công để giả lập rollback. Bật lại chỉ sau khi đối soát các write đang chưa xác nhận.
