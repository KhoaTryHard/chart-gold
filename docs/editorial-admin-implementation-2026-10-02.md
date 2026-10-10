# Tin vàng: sửa bug và tối ưu duyệt bài — 02/10/2026

## Luồng đã triển khai

Admin duyệt nội dung độc lập với ba giờ đăng. Hàng chờ gồm Chờ duyệt, Đã duyệt, Lịch đăng và Cần xử lý; mỗi trang 20 bài, duyệt tối đa 20 bài/lượt với kết quả riêng từng bài. Bài đã duyệt được xếp lịch sau khi Admin chọn ngày/giờ và xác nhận.

Máy tính có danh sách cạnh bản xem trước; điện thoại mở bài toàn màn hình với thanh hành động cố định. Một lần chọn Xem bài tải toàn văn, ảnh thực tế, nguồn/dữ kiện/SEO và góp ý. Sửa nhanh gửi các trường đã thay đổi; giữ nguyên evidence, SEO, chuyên mục và metadata nguồn còn lại. Có Duyệt và xem bài tiếp, xem lịch sử riêng, đổi ảnh, khôi phục thành nháp và gỡ bài.

GET danh sách chỉ đọc, trả summary và slot ảo nếu chưa có bản ghi; không tạo slot khi làm mới. Toàn văn, lịch sử, bản dịch, ngân sách và job không bị tải lại cùng danh sách. Poll 10 giây khi có job chạy/chờ đến lượt, 60 giây khi nhàn, dừng khi tab ẩn. Request cũ bị hủy/bỏ kết quả; lỗi refresh không đổi kết quả mutation thành thất bại. Trạng thái xử lý riêng từng bài; field đang lưu bị khóa để không mất phần vừa nhập.

## Bug đã xử lý

| Vấn đề | Hành vi sau sửa và bằng chứng |
| --- | --- |
| F01 — job trùng, nháp trùng, thiếu ngân sách | Claim/lease theo job, cooldown và token worker; output AI được checkpoint, tạo revision và hoàn tất job trong cùng transaction. Hai delivery chỉ gọi Gemini/tạo một bài. Completion lỗi được rollback và retry dùng lại output. Chờ ngân sách không tiêu hao attempt. |
| F02 — gỡ bài vẫn bị đăng lại | Gỡ thu hồi duyệt và hủy lịch chưa đăng trong transaction; publish chặn article archived và revision không còn mới nhất. |
| F03 — ảnh upload kế thừa mất quyền đọc | Tạo/sửa/khôi phục revision gắn URL media theo ID mới, dùng lại private storage key; guest đọc ảnh mới sau publish thành công. |
| F04 — evidence-only bị thu hồi sau 50 phút | Cùng validator cho duyệt/publish; recheck nguồn rỗng không báo lỗi. Lỗi HEAD/mạng tạm thời là cảnh báo, giữ approval và lịch. |
| F05 — timeout mất attempt và giải phóng chi phí | Ghi attempt trước provider dispatch; timeout được phân loại retryable; giữ khoản chi phí chưa biết thay vì coi như chưa gọi provider. |
| F06 — retry ghi lại attempt 1 | Cấp số attempt tăng theo job trong transaction; nhật ký 429 → thành công giữ cả hai lần gọi. |
| F07 — ngày evidence sai làm trang throw | Chặn timestamp không hợp lệ ở đầu vào/readiness; trang public có fallback cho dữ liệu lịch sử bị hỏng. |
| Sửa lỗi chữ mất metadata | PATCH kế thừa trường không gửi; `[]`/`null` được gửi rõ mới xóa dữ liệu phù hợp. Test HTTP thật xác nhận preservation. |
| Duyệt/sửa/publish cạnh tranh | Khóa article trước slot, kiểm tra revisionId và dấu phiên bản (gồm nội dung, nguồn, evidence, ảnh và góp ý). PostgreSQL xác nhận publish phải đợi transaction sửa, rồi không đăng revision cũ. |
| AI ghi đè sửa mới của Admin | Job viết lại lưu nội dung gốc, đầy đủ góp ý và dấu phiên bản; từ chối output AI nếu revision bị thay đổi trong lúc model chạy. |
| Nhiều job cùng tiêu đề | Cấp slug cùng transaction dưới khóa theo tiêu đề; sáu job song song vẫn tạo đủ sáu bài. |
| Lease giữ hết connection | Lease không giữ một connection suốt callback; sáu job chạy với pool tối đa năm connection không deadlock. |

Sửa/khôi phục/yêu cầu sửa thu hồi duyệt và hủy lịch cũ chưa đăng. Hủy lịch giữ duyệt cho revision không đổi. Bản đang public tiếp tục hiển thị cho đến khi thay thế hoặc gỡ. Slot quá giờ không nhận lịch mới; slot failed/skipped còn trong tương lai có thao tác mở lại.

## Đo trước/sau

| Hạng mục | Trước | Sau |
| --- | --- | --- |
| Mở toàn văn từ hàng chờ | Ít nhất 3 lần kích hoạt UI, kèm tìm bài/cuộn | 1 lần Xem bài, xác nhận bằng Playwright desktop/mobile |
| Giảm thao tác điều hướng | Mốc 3 thao tác từ mã nguồn cũ | 1 thao tác: giảm ít nhất 66,7%; không đo thời gian đọc bài |
| JSON trên fixture 20 bài × 5 revisions | 988.752 bytes | 13.715 bytes: giảm 98,6% |
| Query danh sách có dữ liệu | Khoảng 10 câu lệnh nhìn thấy từ mã cũ, gồm user lookup | 4 query inbox + user lookup; loại INSERT khi GET, không đọc toàn bộ history/translation |
| Phạm vi khóa UI khi mutation | Cả trang đến khi tải lại xong | Bài đang xử lý; refresh chạy riêng |

Dung lượng được đo bằng các hàm truy vấn thật trên PostgreSQL tạm. So sánh cũ dùng articles/jobs/budget, chưa cộng phần inbox/slot lặp của GET cũ, nên là mốc bảo thủ. Thời gian query trong JSON benchmark là một lượt local, không phải p95 production; không khẳng định tốc độ đọc hoặc duyệt nội dung tăng theo tỷ lệ này.

## Kiểm thử và vận hành

- **365/365 unit/integration đạt**, trong đó 25 kịch bản database chạy với PostgreSQL 17.11 riêng tại `127.0.0.1:55432/editorial_test`; không dùng database production. Gemini, Blob và HTTP nguồn được mock.
- PostgreSQL kiểm chứng bulk >3, lỗi riêng từng bài, metadata preservation, stale revision/token, lịch duy nhất, hủy lịch/gỡ, transaction cạnh tranh, nguồn lỗi tạm thời, URL ảnh sau restore, delivery trùng, pool contention, cooldown, attempts/timeout, output checkpoint, AI stale và khôi phục worker.
- **17/17 Playwright đạt**: desktop 1440px/mobile 390px, bulk khi cả ba slot đầy, lỗi từng bài, sửa typo, save chậm, refresh lỗi, response đến sai thứ tự, qua nửa đêm, quyền guest/member/admin và HTTP route thật trên database E2E.
- Lint, typecheck, build và diff whitespace được kiểm tra trước deploy. Không cần migration schema cho thay đổi này.

Bằng chứng: [unit/integration JSON](/D:/KinhDoanh/chart-gold/outputs/editorial-implementation/unit-final-results.json), [E2E JSON](/D:/KinhDoanh/chart-gold/outputs/editorial-implementation/e2e-verified-results.json), [benchmark](/D:/KinhDoanh/chart-gold/outputs/editorial-implementation/api-benchmark.json), [desktop](/D:/KinhDoanh/chart-gold/outputs/editorial-implementation/admin-1440.png), [mobile](/D:/KinhDoanh/chart-gold/outputs/editorial-implementation/admin-390.png).

Chạy lại database tests: khởi động PostgreSQL local riêng, chạy `node scripts/prepare-editorial-test-db.mjs`, đặt `EDITORIAL_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55432/editorial_test`, rồi `npm test -- --maxWorkers=2`. Test có kiểm tra hostname và tên database trước các thao tác truncate. E2E dùng `E2E_DATABASE_URL` riêng và `playwright.editorial.config.ts`; đặt `EDITORIAL_E2E_PORT` từ 3011–3020 nếu cổng mặc định đang được dùng.

## Production

Đã deploy vào project Vercel `chart-gold`, deployment `dpl_AjhBjNG2x4xEeqWLonPFiydPvY5Q`, trạng thái READY và alias [www.vanghomnay.online](https://www.vanghomnay.online) đã cập nhật. Build Vercel cũng hoàn tất thành công.

Kiểm tra lúc **18:59 ngày 02/10/2026**: hub Nhịp vàng, hai bài công khai, phương pháp biên tập và news sitemap trả 200; Admin page trả 200 và yêu cầu đăng nhập. API quản trị, endpoint GET chi tiết mới và cron trả 401 với khách; worker GET trả 405. Đã quan sát trang Admin bằng trình duyệt thật sau deploy.

Giới hạn: trình duyệt production chưa có phiên Google Admin, nên chưa thao tác duyệt/xếp lịch trên dữ liệu production. Những thao tác này đã qua E2E và HTTP thật ở môi trường riêng. Không tạo bài kiểm thử, không gọi Gemini/QStash/Blob thật trong kiểm tra production.

Trạng thái deploy và kết quả GET được lưu tại [deployment.json](/D:/KinhDoanh/chart-gold/outputs/editorial-implementation/deployment.json) và [production-verification.json](/D:/KinhDoanh/chart-gold/outputs/editorial-implementation/production-verification.json). Backlog redirect nguồn/SSRF, cache ảnh đã nóng và crawler/robots được giữ riêng như kế hoạch.
