# Kim Tuyến — Giá vàng Việt Nam

![Kim Tuyến — Giá vàng rõ ràng. Góc nhìn vững vàng.](public/og.png)

Nền tảng theo dõi giá vàng Việt Nam, so sánh giá mua bán, quản lý Sổ vàng và đọc phân tích thị trường. Dự án kết hợp dữ liệu từ nhiều thương hiệu với công cụ tính toán, trợ lý AI và quy trình biên tập có kiểm duyệt.

**[Truy cập website](https://www.vanghomnay.online)** · **[Hướng dẫn sử dụng](https://www.vanghomnay.online/huong-dan)** · **[Tài liệu kỹ thuật](#tài-liệu-kỹ-thuật)**

## Nội dung

- [Tính năng](#tính-năng)
- [Công nghệ và cấu trúc](#công-nghệ-và-cấu-trúc)
- [Chạy trên máy local](#chạy-trên-máy-local)
- [Cấu hình dịch vụ](#cấu-hình-dịch-vụ)
- [Lệnh phát triển và kiểm thử](#lệnh-phát-triển-và-kiểm-thử)
- [Triển khai production](#triển-khai-production)
- [Tài liệu kỹ thuật](#tài-liệu-kỹ-thuật)

## Tính năng

| Nhóm | Khả năng |
| --- | --- |
| **Bảng giá vàng** | Theo dõi giá mua vào, bán ra, chênh lệch và biểu đồ theo thương hiệu, sản phẩm, khu vực. |
| **Công cụ vàng** | So sánh giá, quy đổi đơn vị, tính lãi/lỗ và điểm hòa vốn. |
| **Sổ vàng** | Ghi giao dịch mua/bán, tính giá vốn FIFO, theo dõi danh mục, đồng bộ theo tài khoản và sao lưu JSON. |
| **Phân tích AI** | Hỏi đáp dựa trên dữ liệu thị trường, hiển thị nguồn tham khảo, phản hồi dạng streaming và quản lý hạn mức sử dụng. |
| **Nhịp vàng** | Đọc bài viết thị trường; hệ thống biên tập hỗ trợ nguồn, bằng chứng, ảnh minh họa và duyệt phiên bản trước khi xuất bản. |
| **Ủng hộ dự án** | Tạo QR chuyển khoản, đối soát webhook SePay, cập nhật tổng ủng hộ và bảng tri ân. |
| **Trải nghiệm** | Giao diện thích ứng điện thoại và máy tính, chế độ sáng/tối, hỗ trợ tiếng Việt và tiếng Anh. |

### Dữ liệu có nguồn và thời điểm cập nhật

Các nguồn đã tích hợp gồm SJC, PNJ, DOJI, Bảo Tín Minh Châu, Bảo Tín Mạnh Hải, Phú Quý, VN Gold và VietinBank/VGJ. Mỗi bộ chuyển đổi xử lý quy cách, đơn vị và lịch sử theo khả năng thực tế của nguồn.

Dự án phân biệt nguồn chính thức với nguồn tổng hợp, đánh dấu dữ liệu thiếu hoặc cũ và không dùng giá của thương hiệu khác để thay thế một nguồn không khả dụng. Phạm vi lịch sử khác nhau giữa các thương hiệu; xem [tài liệu nguồn thị trường](docs/market-sources.md).

### Các trang chính

| Đường dẫn | Chức năng |
| --- | --- |
| `/` | Bảng giá và biểu đồ thị trường |
| `/cong-cu-vang` | Công cụ so sánh và tính toán |
| `/phan-tich` | Không gian phân tích AI |
| `/so-vang` | Sổ giao dịch theo tài khoản |
| `/nhip-vang` | Bài viết thị trường |
| `/donate` | Ủng hộ và bảng tri ân |
| `/admin/bai-viet` | Quản trị biên tập, yêu cầu tài khoản admin |
| `/admin/billing` | Quản trị thanh toán, yêu cầu tài khoản admin |

## Công nghệ và cấu trúc

| Thành phần | Công nghệ |
| --- | --- |
| Ứng dụng | Next.js 16.3, App Router, React 19.2, TypeScript 5.9 |
| Giao diện | Tailwind CSS 4, shadcn/Base UI, Recharts, Lucide |
| Xác thực | Auth.js / NextAuth v5 beta, Google OAuth, phiên JWT |
| Dữ liệu | PostgreSQL, Drizzle ORM, `pg` |
| AI | Gemini, gateway Hermes tương thích OpenAI, chế độ OpenAI theo cấu hình |
| Tác vụ và lưu trữ | Vercel Cron, Upstash QStash, Vercel Blob |
| Thanh toán | SePay, QR VietQR |
| Kiểm thử | Vitest, jsdom, Playwright |
| Chất lượng mã | Oxlint, Oxfmt |
| Triển khai và đo lường | Vercel, Vercel Analytics, Speed Insights, GA4 tùy chọn |

```text
app/          Các trang, layout và API route của Next.js
components/   Giao diện thị trường, AI, Sổ vàng, biên tập và thanh toán
lib/          Nghiệp vụ, bộ chuyển đổi nguồn và tích hợp dịch vụ
db/           Kết nối PostgreSQL và schema Drizzle
drizzle/      Migration cơ sở dữ liệu
public/       Logo, bộ nhận diện và tài nguyên tĩnh
scripts/      Công cụ đồng bộ, kiểm tra và vận hành
tests/        Kiểm thử tự động và end-to-end
docs/         Tài liệu kiến trúc, cấu hình và vận hành
auth.ts       Cấu hình Google OAuth và phiên đăng nhập
```

## Chạy trên máy local

### 1. Cài đặt

Yêu cầu **Node.js >= 22.13.0** và npm. Vercel production hiện dùng Node.js 24.x.

```bash
git clone https://github.com/KhoaTryHard/chart-gold.git
cd chart-gold
npm ci
```

### 2. Tạo cấu hình môi trường

Sao chép `.env.example` thành `.env.local`:

```bash
cp .env.example .env.local
```

Trên PowerShell có thể dùng `Copy-Item .env.example .env.local`.

Đổi các URL production trong tệp mẫu sang local. Để bắt đầu với bảng giá và công cụ công khai, tắt các dịch vụ chưa cấu hình:

```dotenv
AUTH_URL=http://localhost:3000
SITE_URL=http://localhost:3000
AUTH_TRUST_HOST=true
B2C_AI_ENABLED=false
DONATIONS_ENABLED=false
SUBSCRIPTIONS_SALES_ENABLED=false
EDITORIAL_AUTOMATION_ENABLED=false
HERMES_EDITORIAL_ENABLED=false
HERMES_VIDEO_ENABLED=false
```

Tạo giá trị ngẫu nhiên riêng cho `AUTH_SECRET`, rồi điền vào `.env.local`:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

Các giá trị `your-...` và `replace-with-...` trong tệp mẫu là chỗ điền cấu hình. Chức năng đăng nhập, Sổ vàng, AI, biên tập và thanh toán cần thêm các dịch vụ tương ứng ở phần dưới.

### 3. Khởi động

```bash
npm run dev
```

Mở **http://localhost:3000**. Bảng giá sử dụng kết nối mạng tới các nguồn dữ liệu bên ngoài.

## Cấu hình dịch vụ

Danh sách biến đầy đủ nằm trong [`.env.example`](.env.example). Chỉ bật tính năng sau khi đã cấu hình các dịch vụ mà tính năng đó sử dụng.

| Dịch vụ | Biến cấu hình chính | Mục đích |
| --- | --- | --- |
| Google OAuth | `AUTH_SECRET`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, `AUTH_URL` | Đăng nhập và phiên người dùng |
| Quyền quản trị | `ADMIN_EMAILS` | Danh sách email admin, phân cách bằng dấu phẩy |
| PostgreSQL | `DATABASE_URL`, `DATABASE_URL_UNPOOLED` | Sổ vàng, lịch sử, hạn mức AI, thanh toán và biên tập |
| AI cho người đọc | `B2C_AI_ENABLED`, `AI_EXPERIENCE_V2_ENABLED`, `AI_PROVIDER` | Bật trải nghiệm AI và chọn chế độ định tuyến |
| Gemini / Hermes / OpenAI | `GEMINI_API_KEY`, nhóm `HERMES_*`, nhóm `OPENAI_*` | Cấu hình nhà cung cấp theo chế độ AI được chọn |
| Biên tập | `EDITORIAL_GEMINI_API_KEY`, nhóm `EDITORIAL_*` | Tạo nội dung và quản lý ngân sách biên tập riêng |
| Tự động hóa | `EDITORIAL_AUTOMATION_ENABLED`, nhóm `QSTASH_*` | Gọi worker theo lịch với chữ ký xác thực |
| Tích hợp Hermes biên tập | `HERMES_EDITORIAL_ENABLED`, `HERMES_EDITORIAL_SECRET`, các ID liên quan | Trao đổi gói nội dung và kiểm soát quyền duyệt |
| Ảnh và video | `BLOB_READ_WRITE_TOKEN` hoặc cấu hình Blob/OIDC của Vercel | Lưu tài nguyên biên tập |
| Ủng hộ và thanh toán | `DONATIONS_ENABLED`, nhóm `SEPAY_*` | QR và đối soát giao dịch |
| Lịch đồng bộ thị trường | `CRON_SECRET` | Xác thực Vercel Cron |
| Đo lường tùy chọn | `NEXT_PUBLIC_GA4_MEASUREMENT_ID`, `GOOGLE_SITE_VERIFICATION` | GA4 và xác minh Search Console |

### Google OAuth và phiên đăng nhập

Đăng ký callback local cho OAuth Client dùng trong phát triển:

```text
http://localhost:3000/api/auth/callback/google
```

Phiên web có thời hạn **30 ngày**, được gia hạn khi endpoint phiên được gọi thành công lúc JWT vẫn còn hiệu lực. `SessionProvider` kiểm tra lại mỗi 5 phút và khi quay lại tab; bộ hẹn giờ phụ thuộc vào việc trang còn được trình duyệt cho chạy.

JWT của website độc lập với access token Google. Phiên đã hết hạn hoặc cookie bị xóa cần đăng nhập lại. Xem [cấu hình OAuth production](docs/google-oauth-production.md).

### PostgreSQL và migration

Đặt URL của database dành cho môi trường đang sử dụng, sau đó áp dụng migration:

```bash
npm run db:migrate
```

Khi phát triển thay đổi schema trong `db/schema.ts`, tạo và xem xét migration trước khi áp dụng:

```bash
npm run db:generate
```

Drizzle ưu tiên `DATABASE_URL_UNPOOLED` cho migration, sau đó mới dùng `DATABASE_URL`. Không chạy migration bằng URL production khi chuẩn bị database local hoặc kiểm thử.

### AI, biên tập và ủng hộ

- `AI_PROVIDER=auto` định tuyến giữa Hermes và Gemini; cấu hình đủ provider cần dùng trước khi bật AI. Hạn mức cộng đồng, hạn mức thuê bao và ngân sách có cấu hình riêng.
- Gemini biên tập dùng `EDITORIAL_GEMINI_API_KEY` riêng, không tự dùng key chatbot khi thiếu cấu hình. Xuất bản phụ thuộc vào quyền duyệt và kiểm chứng gói nội dung.
- Ủng hộ độc lập với quyền truy cập AI và việc bán thuê bao. Đối soát thanh toán sử dụng webhook SePay có xác thực HMAC.

Xem [phân tích AI](docs/ai-analysis.md), [tự động hóa biên tập](docs/editorial-automation.md) và [cấu hình ủng hộ](docs/donations-setup.md) trước khi bật các luồng này.

## Lệnh phát triển và kiểm thử

| Lệnh | Chức năng |
| --- | --- |
| `npm run dev` | Chạy server phát triển |
| `npm run build` | Tạo bản production và kiểm tra TypeScript |
| `npm run start` | Chạy bản production đã build |
| `npm run lint` | Kiểm tra mã với Oxlint |
| `npm run format` | Định dạng mã với Oxfmt; lệnh có thể sửa tệp |
| `npm test` | Chạy bộ kiểm thử Vitest |
| `npm run test:e2e` | Chạy kiểm thử Playwright |
| `npm run test:e2e:donate` | Chạy nhóm kiểm thử ủng hộ |
| `npm run check:ai` | Kiểm tra kết nối AI theo cấu hình |
| `npm run history:bootstrap` | Nạp lịch sử thị trường vào database |
| `npm run history:sync` | Đồng bộ cửa sổ lịch sử gần đây |

Kiểm tra cơ bản trước khi phát hành:

```bash
npm run lint
npm test
npm run build
```

Cài trình duyệt cho Playwright trước lần chạy E2E đầu tiên:

```bash
npx playwright install
```

Các luồng E2E có ghi dữ liệu cần **database test riêng đã migrate**, được truyền qua `E2E_DATABASE_URL`. Cấu hình Playwright không dùng `DATABASE_URL` làm database kiểm thử; không trỏ E2E tới dữ liệu production. Server E2E tự build và khởi động tại `http://127.0.0.1:3000`.

Lệnh kiểm tra AI có thể gọi provider thật; lệnh đồng bộ lịch sử ghi vào database đang cấu hình. Các thao tác này không thuộc bộ kiểm thử thuần local.

## Triển khai production

Dự án Vercel hiện có tên **`chart-gold`**, sử dụng domain **[www.vanghomnay.online](https://www.vanghomnay.online)**. Không tạo project mới khi cập nhật ứng dụng hiện tại.

1. Chạy các kiểm tra phù hợp với thay đổi.
2. Cấu hình biến môi trường trên Vercel và áp dụng migration nếu bản phát hành có thay đổi schema.
3. Liên kết thư mục với project hiện có bằng `npx vercel link` nếu chưa có cấu hình local.
4. Triển khai bản đã kiểm tra:

   ```bash
   npx vercel deploy --prod
   ```

5. Xác minh trang và luồng vừa thay đổi trên domain production.

Callback Google production phải là:

```text
https://www.vanghomnay.online/api/auth/callback/google
```

`vercel.json` cấu hình region `sin1` và cron đồng bộ lịch sử lúc **01:00 UTC / 08:00 giờ Việt Nam** mỗi ngày. Lịch biên tập được quản lý riêng qua QStash.

Không commit `.env.local`, khóa API, secret webhook hoặc log cục bộ. Các tệp này được loại trừ bằng `.gitignore`; tài liệu, kiểm thử và công cụ vận hành cũng được loại khỏi gói deploy theo `.vercelignore`.

## Tài liệu kỹ thuật

| Tài liệu | Nội dung |
| --- | --- |
| [Nguồn dữ liệu thị trường](docs/market-sources.md) | Nguồn chính thức/tổng hợp, đơn vị và giới hạn lịch sử |
| [Google OAuth production](docs/google-oauth-production.md) | Callback, biến môi trường và nghiệm thu đăng nhập |
| [Phân tích AI](docs/ai-analysis.md) | Định tuyến, dữ liệu đầu vào, streaming và hạn mức |
| [Kế hoạch sản phẩm AI](docs/ai-analysis-product-plan.md) | Định hướng và phạm vi trải nghiệm phân tích |
| [Tự động hóa biên tập](docs/editorial-automation.md) | Worker, lịch QStash và cấu hình vận hành |
| [Duyệt và xuất bản](docs/owner-review-2026-10-10.md) | Chính sách duyệt và bằng chứng kiểm chứng |
| [Cấu hình ủng hộ](docs/donations-setup.md) | SePay, QR, webhook và kiểm thử thanh toán |
| [Bộ nhận diện](docs/brand-identity.md) | Logo, màu sắc, tài nguyên và quy tắc giao diện |
| [Quy ước làm việc trong repository](AGENTS.md) | Hướng dẫn Next.js, kiểm tra và triển khai |

Các tài liệu có ngày trong tên là hồ sơ của một đợt triển khai hoặc kiểm chứng. Khi có khác biệt, đối chiếu mã nguồn, biến môi trường và cấu hình vận hành hiện tại.
