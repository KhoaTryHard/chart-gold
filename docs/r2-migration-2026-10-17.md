# Chuyển media sang R2 Standard — nghiệm thu 17/10/2026

Đã chuyển kho media runtime của website và bot sang Cloudflare R2 Standard.
Website production: `www.vanghomnay.online`, Vercel project `chart-gold`.
Deployment nghiệm thu: `dpl_2KA7qRPLCEYWsAuRHUTV1cAMDk72`.

## Kết quả

| Hạng mục | Kết quả đã xác minh |
|---|---|
| Bucket production | `chart-gold-media-prod`, Standard; server/bot dùng S3 API có xác thực |
| Bucket kiểm thử | `chart-gold-media-staging`, Standard; đã thử đọc/ghi và dọn probe |
| Khóa | Website, bot và staging có ba fingerprint khác nhau; khóa bot/staging local dùng Windows DPAPI |
| Vercel | Production dùng prod; Preview/Development dùng staging; bí mật không có tiền tố `NEXT_PUBLIC_` |
| Media website | 64 file, 69.035.382 byte; toàn bộ đã đọc lại từ R2 và so SHA-256 |
| Media bot | 162 file, 128.164.756 byte; 162 object/alias đã xác minh, không thiếu file tham chiếu |
| Bản duyệt website | 62 gói có `reviewDigest` và `revisionVersion` đầy đủ khớp; hai descriptor video khớp digest |
| Ledger bot | 86 bản nháp và 96 kênh phát hành giữ nguyên digest, bundle, phê duyệt và ID bài/bình luận |
| Ghi mới | `MEDIA_STORAGE_PROVIDER=r2`; đọc hai kho vẫn bật để tương thích |
| Công cụ migration | `HERMES_STORAGE_MIGRATION_ENABLED=false`; status và retirement có chữ ký vẫn hoạt động |

Media được sao chép nguyên byte; không nén lại, render lại, tạo ảnh hoặc gọi TTS để chuyển kho.
Không tạo bài, bình luận hoặc Story kiểm thử công khai. Logo/icon trong `public`, database Neon,
cache kiểm thử và backup lịch sử không thuộc dữ liệu cần chuyển.

## Chính sách local và Blob

- Cache local giữ ít nhất bảy ngày từ lần dùng cuối; thời điểm hết pin cũng được tính để tránh dọn ngay sau duyệt/đăng.
- Giữ file của bản nháp/chạy việc/upload/video/Story đang chờ, retry, đối soát hoặc đang được đọc. Job video còn resume giữ cả chunk/poster trong thư mục job.
- Chỉ xóa bản local có R2 đã xác minh; trước khi xóa kiểm tra lại cloud, SHA-256, tham chiếu và lease. File thiếu sẽ được tải lại đúng đường dẫn cũ bằng file tạm và atomic replace.
- Metadata JSON/state ở local được giữ. Registry nằm riêng tại `C:/Users/LENOVO/kim-tuyen-ai/data/media-storage.sqlite3`, không sửa JSON đã duyệt.
- Ảnh owner upload mới còn giữ thêm raw nguyên bản trong `assets/owner-original`; raw lịch sử chưa từng được lưu không thể khôi phục từ một giá trị hash.
- Giữ Blob cũ tối thiểu 30 ngày từ `verified_at`. Retirement chỉ xóa bản Blob khi mapping vẫn ở R2, SHA-256 bản cloud đạt, ETag nguồn khớp và không có upload dở. R2-only không bị dọn.
- Tác vụ được nối vào cron newsroom hiện có mỗi năm phút, với khóa giới hạn maintenance một lần/ngày. Worker không phải daemon để tiến trình cron chờ ghi checkpoint trước khi thoát.

Ngày nghiệm thu chưa có file nào đủ tuổi dọn; smoke maintenance trả `pruned=[]`, `retired=[]`.
Dung lượng local sẽ giảm theo chính sách bảy ngày, không xóa ngay toàn bộ bản gốc lúc chuyển đổi.

## Kiểm thử và kiểm tra production

- Website: lint và TypeScript đạt; 536 unit/integration đạt, tám ca phụ thuộc môi trường bỏ qua. Nhóm editorial database chạy PostgreSQL local riêng, không truncate production.
- E2E: 19 ca đạt; production build đạt. 17 file nguồn triển khai được đọc lại qua Vercel API và khớp SHA-256 với bản phát hành; ba file giao diện có thay đổi local từ trước vẫn giữ đúng bản production nền.
- Bot: nhóm hồi quy đầy đủ chạy 750 kiểm thử, 746 đạt và bốn bỏ qua theo môi trường. Sau các sửa đổi cuối, 47 ca cache/video/protocol chạy trên mã đã cài đạt; hash của 13 file cài đặt khớp manifest.
- Staging thật: upload ảnh và MP4; URL PUT 15 phút, create-only, kiểm MIME/dung lượng/SHA-256/MP4; đọc Range đúng byte; thử xóa cache PNG/MP3/MP4 rồi khôi phục nguyên bản.
- Bộ tải MP4 của bot cũng đã chạy thật với URL do AWS SDK tạo trên production: object private tạm 2.500.136 byte khớp SHA-256, upload lặp bị từ chối; object probe đã được dọn. Hỗ trợ cả virtual-host và path-style URL, khóa đúng bucket production.
- Production: trang chủ và Nhịp vàng HTTP 200; 48 ảnh đang xuất bản HTTP 200 và hash khớp R2; ảnh nháp guest HTTP 401; endpoint maintenance thiếu chữ ký HTTP 401.
- Hai video production đang ready nhưng chưa có gói video được duyệt và xuất bản: cấp URL bị chặn HTTP 409. Upload/Range video đã nghiệm thu thật trên staging; không tạo bản duyệt hoặc xuất bản giả để thử phát video công khai.
- Gateway `quan-tri-fanpage` đã khởi động lại. Profile `default` và `nghien-cuu-bao-cao-thi-truong` vẫn hoạt động. Cron newsroom được xác nhận enabled, `*/5 * * * *`, lần quan sát cuối trạng thái `ok`.

## Lệnh vận hành

Bản nguồn 13 file bot đã cài được lưu trong `integrations/kim-tuyen-bot/` để
version control cùng website. Thư mục này không nằm trong deployment website;
khóa và dữ liệu bot tiếp tục ở máy vận hành.

Tại `D:/KinhDoanh/chart-gold`:

```powershell
# Trạng thái production, không cần tải khóa Sensitive từ Vercel
node scripts/r2-remote-ops.mjs status

# Kiểm tra trang/ảnh public, quyền draft/video và bản duyệt
node scripts/r2-production-health.mjs

# Kiểm tra đầy đủ revisionVersion, canonical package và descriptor video
node --env-file=.env.local --conditions=react-server --import tsx scripts/r2-review-integrity.ts

# Danh mục bot và xem trước dọn local
python C:/Users/LENOVO/kim-tuyen-ai/media_storage.py inventory
python C:/Users/LENOVO/kim-tuyen-ai/media_storage.py prune
```

`prune` không có `--apply` chỉ xem trước. Không xóa trực tiếp `assets` hoặc sửa đường dẫn trong bundle.
Để xem ảnh gốc, dùng Objects của bucket production trong Cloudflare; object bot nằm dưới
`bot/objects/sha256/`, ảnh/video website nằm dưới `editorial/`.

## Quay lại và khôi phục

- Backup bot trước cài: `C:/Users/LENOVO/kim-tuyen-ai/backups/r2-storage-1792206185`.
- Backup đầu phiên và bằng chứng SQL/source nằm trong `D:/KinhDoanh/chart-gold/outputs/r2-migration-20261017`.
- Muốn tạm ghi mới vào Blob, chạy `node scripts/r2-configure-vercel.mjs compatibility`, sau đó Redeploy bản hỗ trợ hai kho hiện tại trên Vercel. Lệnh này giữ dual-read và tắt retirement.
- Muốn chuyển mapping cũ về Blob, công cụ `scripts/r2-media-ops.ts rollback` có chế độ xem trước và `--apply --production`; môi trường chạy cần có database và `BLOB_READ_WRITE_TOKEN`. Chỉ các khóa còn `source_blob_url` mới được chuyển; R2-only tiếp tục đọc R2.
- Không rollback về bản mã chỉ hiểu Blob sau khi đã có file chỉ nằm trên R2. Khi khôi phục bot về mã cũ, cần hydrate file đang sử dụng về local trước và tắt cleanup.

Không đưa `.secret`, `.env.local`, khóa, hoặc URL upload có chữ ký vào Git/chat/log.

## Bằng chứng chính

Trong `outputs/r2-migration-20261017/`: `deployed-source-verification.json`,
`remote-status.json`, `remote-migrate-report.json`, `remote-verify-all-report.json`,
`full-review-integrity.json`, `production-health.json`, `bot-installation.json`,
`bot-identities-after.json`, `bot-remote-verification.json`, `bot-maintenance-smoke.json`,
`staging-acceptance.json`, `bot-staging-acceptance.json`, `bot-production-upload-acceptance.json`, `bot-tests.txt`,
`bot-installed-tests.txt`, `website-e2e-last-run.json`.
