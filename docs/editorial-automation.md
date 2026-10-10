# Nhịp vàng: vận hành biên tập tự động

## Quy trình

Hệ thống thu thập thông tin từ nguồn được phép lúc 06:30 giờ Việt Nam, tạo ba bản nháp cho các tuyến trong nước, quốc tế và giải thích. Gemini API bằng tài khoản editorial riêng xử lý văn bản và SEO; ảnh bìa dùng thư viện thương hiệu hoặc ảnh Admin tải lên. Bản nháp, SEO và ảnh minh họa đều ở trạng thái chờ duyệt.

Admin duyệt chính xác phiên bản, ảnh và metadata, sau đó xếp vào ba giờ đăng 08:30, 12:00 và 17:00. Nếu thay đổi nội dung hoặc ảnh, hệ thống tạo phiên bản mới và yêu cầu duyệt lại. Không có bài nào được đăng chỉ vì đã đạt đủ số lượng mục tiêu trong ngày.

## Cấu hình production

1. Chạy migration mới trước khi bật automation.
2. Tạo key Gemini thuộc account/project editorial riêng và đặt `EDITORIAL_GEMINI_API_KEY` trong Vercel. Key chatbot `GEMINI_API_KEY` không được dùng cho editorial.
3. Xác minh `gemini-3.6-flash` hoạt động với key mới. Không cần model tạo ảnh hoặc billing Gemini.
4. Tạo QStash, đặt `QSTASH_TOKEN`, `QSTASH_CURRENT_SIGNING_KEY`, `QSTASH_NEXT_SIGNING_KEY` trong Vercel.
5. Tạo Vercel Blob private, gắn `BLOB_READ_WRITE_TOKEN` vào project.
6. Đặt `EDITORIAL_AUTOMATION_ENABLED=true`, deploy production, đăng nhập `/admin/bai-viet`, rồi chọn **Cập nhật lịch tự động**.

Không bật lịch khi key/model Gemini chưa được cấu hình: bài sẽ giữ trạng thái chờ xử lý thay vì tạo bản hoàn tất giả. Blob private chỉ cần khi Admin tải ảnh lên.

## Hướng dẫn cấu hình từng bước

### 1. Kiểm tra Gemini editorial trước khi đưa lên Vercel

Key editorial phải thuộc project/account riêng. Không dùng `GEMINI_API_KEY` của chatbot cho luồng này. Google áp dụng quota theo project, vì vậy hai key trong cùng project vẫn có thể dùng chung hạn mức.

Kiểm tra model văn bản bằng key mới:

```powershell
$key = Read-Host "Editorial Gemini API key"
$headers = @{ "x-goog-api-key" = $key }
$body = @{ model = "gemini-3.6-flash"; contents = "Trả về đúng một câu xác nhận." } | ConvertTo-Json
Invoke-RestMethod "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent" -Method Post -Headers $headers -ContentType "application/json" -Body $body
```

Kết quả văn bản phải có nội dung và usage. Lỗi 429 phải trả `Retry-After` để worker giữ cooldown. Ứng dụng chỉ dùng một key editorial, không chuyển sang key chatbot.

### 2. Cấu hình biến môi trường trên Vercel

Liên kết thư mục với project production và nhập từng giá trị ở chế độ bí mật:

```powershell
npx vercel link --project chart-gold
npx vercel env add EDITORIAL_GEMINI_API_KEY production
npx vercel env add EDITORIAL_GEMINI_MODEL production
npx vercel env add EDITORIAL_IMAGE_MODE production
npx vercel env add QSTASH_TOKEN production
npx vercel env add QSTASH_CURRENT_SIGNING_KEY production
npx vercel env add QSTASH_NEXT_SIGNING_KEY production
```

Khi CLI hỏi giá trị, không ghi key vào lệnh hoặc commit vào Git. Các giá trị khuyến nghị:

| Biến                         | Giá trị                                   |
| ---------------------------- | ----------------------------------------- |
| `EDITORIAL_GEMINI_API_KEY`   | Key thuộc project/account editorial riêng |
| `EDITORIAL_GEMINI_MODEL`     | `gemini-3.6-flash`                        |
| `EDITORIAL_IMAGE_MODE`       | `brand-upload`                            |
| `QSTASH_TOKEN`               | Token từ Upstash QStash                   |
| `QSTASH_CURRENT_SIGNING_KEY` | Signing key hiện tại từ QStash            |
| `QSTASH_NEXT_SIGNING_KEY`    | Signing key kế tiếp từ QStash             |

Kiểm tra tên biến mà không in giá trị bí mật:

```powershell
npx vercel env ls production
```

`BLOB_READ_WRITE_TOKEN` đã được gắn vào project với store private. Không dùng token Blob công khai cho ảnh nháp.

### 3. Deploy và bật chế độ tạo nháp

Đặt cờ bật automation sau khi Gemini và QStash đã được kiểm tra:

```powershell
npx vercel env add EDITORIAL_AUTOMATION_ENABLED production
# nhập: true
npx vercel --prod
```

Sau deploy, đăng nhập tài khoản Admin rồi mở `/admin/bai-viet`. Chọn **Cập nhật lịch tự động**. Ứng dụng sẽ tạo năm lịch QStash:

- 06:30: thu thập nguồn và tạo hàng chờ trong ngày.
- Mỗi 10 phút: đối soát job, cooldown và ngân sách.
- 08:30, 12:00, 17:00: chỉ đăng revision đã duyệt đúng slot.

Không có approval thì worker không tự đăng để đủ chỉ tiêu. Trong giai đoạn dry-run ba ngày, giữ nguyên điều kiện này và chỉ duyệt một bài kiểm thử nội bộ nếu cần kiểm tra xuất bản.

### 4. Xác minh từ Admin và QStash

Trong `/admin/bai-viet`, kiểm tra các trạng thái sau:

1. Gemini editorial có `configured: true`, model đúng tên và không còn `missing`.
2. Ảnh thương hiệu có `configured: true`; Blob chỉ cần khi dùng ảnh upload.
3. Automation hiển thị `configured: true`, `enabled: true`.
4. Hàng chờ có nguồn, evidence, SEO và ảnh minh họa riêng.
5. Chi phí được ghi vào ngân sách editorial; giá trị chưa biết không được ghi là `0`.

Trong QStash, kiểm tra năm schedule đều trỏ đến:

```text
https://www.vanghomnay.online/api/editorial/worker
```

Request không có chữ ký QStash phải bị từ chối. `GET /api/editorial/worker` trả `405` là bình thường vì worker chỉ nhận `POST` đã ký.

### 5. Kiểm tra chuyển tuyến và lỗi

Chỉ kiểm tra sau khi có ngân sách thử nghiệm:

- Gemini editorial trả 200: job phải ghi provider Gemini editorial.
- Gemini editorial trả 429 hoặc timeout: job được đưa lại vào hàng chờ theo `Retry-After`, không dùng key chatbot.
- Lỗi 400/401/403 hoặc JSON không hợp lệ: job dừng để sửa cấu hình, không lặp qua provider khác.
- Gemini lỗi hoặc hết ngân sách: job ở trạng thái chờ xử lý, không tạo bài mẫu.

Theo dõi `editorial_job_attempts` và `editorial_cost_ledger` sau mỗi lần thử. Không thực hiện retry đồng thời ở cả gateway và ứng dụng nếu gateway không báo số lần upstream.

### 6. Dry-run ba ngày rồi mới vận hành chính thức

Trong ba ngày đầu, ghi lại mỗi ngày:

- số nguồn thu được, số sự kiện trùng và số bản nháp hợp lệ;
- provider thực tế, thời gian phản hồi, lỗi 429/timeout và số lần fallback;
- chi phí từng lần gọi, tổng ngày và tổng tháng;
- số bài bị Admin yêu cầu sửa, bỏ qua hoặc thiếu ảnh/nguồn;
- lịch đăng có bị trễ, callback trùng hoặc cache chưa làm mới không.

Mức giữ chỗ được tính từ độ dài prompt, giới hạn output và các biến giá `EDITORIAL_TEXT_INPUT_VND_PER_1K`, `EDITORIAL_TEXT_OUTPUT_VND_PER_1K`. Ảnh thương hiệu và ảnh Admin upload được theo dõi như chi phí lưu trữ/hạ tầng riêng, không trừ ngân sách Gemini.

Chỉ khi ba ngày không có lỗi chặn và nội dung đạt yêu cầu mới giữ `EDITORIAL_AUTOMATION_ENABLED=true` cho vận hành hằng ngày.

### 7. E2E và rollback

Chạy kiểm tra hồi quy tại local/CI:

```powershell
npm run lint
npx tsc --noEmit
npx drizzle-kit check
npm test
npx playwright test tests/e2e/editorial.spec.ts tests/e2e/gold-tools.spec.ts
```

E2E live của Gemini/QStash chỉ có ý nghĩa sau khi `EDITORIAL_GEMINI_API_KEY` và hai model đã có giá trị, rồi dry-run bắt đầu. Khi cần dừng khẩn cấp, chọn **Tạm dừng lịch tự động** trong Admin, sau đó đặt `EDITORIAL_AUTOMATION_ENABLED=false` trên Vercel và deploy lại. Job đang chờ vẫn được giữ trong Neon để xử lý thủ công.

## Nguồn và SEO

Nguồn khởi đầu là NHNN, Federal Reserve, BLS, World Gold Council và dữ liệu giá vàng trong hệ thống. Mỗi dữ kiện phải có nguồn/timestamp; bài viết tách dữ kiện và suy luận. Báo chí Việt Nam chỉ được bật sau khi xác nhận điều kiện sử dụng phù hợp.

Ảnh upload của Admin được lưu private trước khi duyệt, hiển thị công khai chỉ khi revision tương ứng đã được xuất bản. Ảnh thương hiệu là tài nguyên công khai dùng chung. Ảnh luôn được ghi là ảnh minh họa, không phải ảnh sự kiện. `news-sitemap.xml` chỉ phát hiện các bài tin xuất bản trong 48 giờ; sitemap thường chỉ chứa bài public.

## Khôi phục vận hành

Admin có thể bỏ qua một khung giờ hoặc yêu cầu sửa bài. Worker lưu job, lần thử, cooldown và chi phí trong Neon để QStash retry không tạo bài trùng. Khi hết ngân sách hoặc mọi provider lỗi, job được giữ lại để Admin xử lý; nó không tự xuất bản.
