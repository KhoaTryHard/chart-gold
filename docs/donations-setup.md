# Cấu hình ủng hộ MB Bank

Luồng ủng hộ dùng tài khoản MB Bank cá nhân liên kết với SePay. SePay Free hiện hỗ trợ 50 giao dịch mỗi tháng và webhook/API; giao dịch vượt hạn mức có thể phát sinh phí theo gói đang dùng.

## Cấu hình

1. Tạo `DATABASE_URL` cho database production.
2. Chạy migration Drizzle:

   ```bash
   npm run db:migrate
   ```

3. Liên kết tài khoản MB cá nhân trong SePay.
4. Tạo webhook tiền vào trỏ chính xác tới `https://www.vanghomnay.online/api/webhooks/sepay`.
5. Cấu hình HMAC secret giống nhau ở SePay và `SEPAY_WEBHOOK_SECRET`.
6. Điền `SEPAY_BANK_CODE`, `SEPAY_ACCOUNT_NUMBER`, `SEPAY_ACCOUNT_HOLDER`, `DONATION_PAYMENT_PREFIX=DN` ở Vercel Production.
7. Dùng SePay Test Mode để kiểm tra webhook trước khi nhận giao dịch thật.

Không đưa số tài khoản, secret webhook hoặc thông tin đăng nhập ngân hàng vào mã nguồn hay trình duyệt. Website không yêu cầu mật khẩu/OTP MB Bank.

## Kiểm tra sau cấu hình

- `/donate` tạo được QR và hiển thị mã chuyển khoản.
- `/api/donations/leaderboard?period=month` trả `rows` với trạng thái 200.
- Webhook hợp lệ chuyển đơn sang `paid`; webhook lặp lại trả trạng thái `duplicate`.
- Giao dịch sai tiền hoặc thiếu mã xuất hiện trong trang `/admin/billing` ở nhóm cần theo dõi.

## Khi đã chuyển tiền nhưng đơn chưa được xác nhận

Kiểm tra lịch sử gửi SePay trước khi sửa trạng thái đơn. `GET` health chỉ xác nhận
endpoint đang chạy, không chứng minh SePay gửi đến đúng URL.

- `401` kèm `Protected deployment`: webhook đang gọi tên miền Vercel được bảo vệ.
  Sửa URL thành `https://www.vanghomnay.online/api/webhooks/sepay`, giữ HMAC-SHA256
  và secret hiện có, rồi phát lại đúng giao dịch thật từ SePay. Không tắt bảo vệ
  Vercel và không tạo webhook giả để ghi nhận tiền.
- Xác nhận HTTP 200 với `success: true`, rồi đối chiếu `sepay_id`, số tiền, mã đơn,
  trạng thái `accepted` của giao dịch và `paid` của đơn. HTTP 200 riêng lẻ chưa
  chứng minh giao dịch đã đối soát thành công.
- QR hết hạn vẫn có thể được xác nhận nếu thời điểm chuyển thực trước expiry.
  Trang kiểm tra đơn chờ mỗi 3 giây, đơn hết hạn mỗi 30 giây và khi quay lại tab;
  nút **Kiểm tra thanh toán** cho phép kiểm tra ngay. Người đã chuyển tiền không
  cần chuyển lại.
- Tổng tháng và bảng tri ân cùng tải qua `GET /api/donations/public?period=month|all`
  mỗi 25 giây khi tab hiển thị và có mạng. Endpoint trả `{ enabled, period, summary, rows }`,
  dùng `Cache-Control: no-store, max-age=0`; hai endpoint summary/leaderboard cũ vẫn được giữ.
  Khi quay lại tab, kết nối mạng trở lại, xác nhận đơn hoặc lưu tên/ẩn danh thành công,
  trang làm mới ngay. Lỗi tạm thời giữ số liệu đã xác nhận gần nhất.
- Mục tiêu khi API hoạt động bình thường: người đang thanh toán thấy xác nhận trong
  5 giây sau webhook được xử lý; các trang khác thấy tổng và bảng mới trong 30 giây.
  Đơn hết hạn vẫn kiểm tra mỗi 30 giây để nhận webhook trễ. Tên công khai chỉ xuất
  hiện sau đối soát; tên đã ẩn danh biến mất ở lần làm mới kế tiếp.
- Tab chỉ xem bảng trong 10 phút dùng tối đa 25 request public (kể lần đầu),
  thay khoảng 402 request trước đây. Các lần đổi kỳ, quay lại tab hoặc sửa đơn
  được tính riêng. Không cache chung thông tin riêng của đơn thanh toán.

Sự cố 15/09/2026: webhook `CHART GOLD` gọi tên miền cũ
`chart-gold-eta.vercel.app` và bị Vercel trả 401. Sau khi sửa URL và phát lại từ
SePay, khoản 20.000đ được xác nhận, tổng tháng tăng từ 140.000đ lên 160.000đ.

## Kiểm thử realtime

E2E DONATE dùng PostgreSQL riêng và không đọc `DATABASE_URL` trong `.env.local`.
Đặt `E2E_DATABASE_URL` trỏ tới database test đã migrate, sau đó chạy:

```bash
npm run test:e2e
```

Test tự cấp session JWT, tạo đơn công khai qua giao diện, gửi webhook ký bằng
HMAC, kiểm tra trang người thanh toán cập nhật trong 5 giây, trang khách khác
trong 30 giây và dọn dữ liệu sau khi
chạy. Có thể đặt `E2E_AUTH_SECRET`, `E2E_SEPAY_WEBHOOK_SECRET`,
`E2E_SEPAY_ACCOUNT_NUMBER` và `E2E_ADMIN_EMAIL` để thay giá trị mặc định.

## Bộ kiểm tra trước release

Chạy contract/regression trước khi deploy:

```bash
npm test -- --run tests/donation-panel.test.ts tests/donation-public-route.test.ts tests/donation-route.test.ts tests/donation-order-details-route.test.ts tests/sepay-webhook-route.test.ts tests/donation-leaderboard-route.test.ts tests/billing.test.ts
npx tsc --noEmit
npm run lint
npm run build
```

Khi có PostgreSQL cô lập, chạy donate E2E. Bộ test tạo dữ liệu có mã `E2E`,
gửi webhook HMAC trong test, kiểm tra token, fallback mã giao dịch, webhook
sai, duplicate đồng thời, privacy và dọn dữ liệu trong `finally`:

```bash
npm run db:migrate
E2E_DATABASE_URL='postgres://.../kim_tuyen_e2e' npm run test:e2e -- donate
```

Để chỉ chạy hai suite donate một cách rõ ràng, có thể dùng:

```bash
E2E_DATABASE_URL='postgres://.../kim_tuyen_e2e' npm run test:e2e:donate
```

Không đặt `E2E_DATABASE_URL` trỏ vào database production. Test server luôn dùng
các biến SePay/auth E2E riêng trong `playwright.config.ts`.

## Production smoke chỉ đọc

Sau mỗi deploy, chạy smoke không tạo đơn và không gửi webhook giao dịch:

```bash
npm run smoke:donate
```

Có thể kiểm tra staging hoặc origin khác bằng `DONATE_SMOKE_URL`. Kết quả được
ghi vào `test-results/donate-production-smoke/<timestamp>/evidence.json`, gồm
HTTP status, security headers, public snapshot/summary/leaderboard, webhook health,
chu kỳ polling desktop, desktop/mobile layout, locale, dark mode, console/page errors và ảnh giao diện.
Evidence không ghi secret, token, raw webhook hay số tài khoản đầy đủ.

Smoke chỉ đạt khi `/donate`, public snapshot, summary, hai kỳ leaderboard và `GET
/api/webhooks/sepay` trả 200; webhook báo `configured: true`; các header bảo mật
hiện diện; desktop/mobile không tràn ngang; không có lỗi console/page; và UI
đổi được dark mode; kiểm tra đổi locale khi giao diện có bật tiếng Anh, hoặc
xác nhận trang tiếng Việt khi tiếng Anh đang tắt.

## SePay Test Mode và giao dịch thật

Trước khi nhận tiền thật, dùng SePay Test Mode để gửi `id=0` và một payload
non-zero đã ký cho một đơn test tối thiểu. Xác nhận chuỗi `pending → paid`,
ledger, audit, summary, leaderboard và duplicate webhook. Giao dịch lệch tiền
hoặc sai mã phải ở `needs_review`.

Không tự động hóa thao tác chuyển tiền. Nếu cần xác nhận ngân hàng thật, chủ tài
khoản thực hiện một khoản nhỏ; người kiểm thử chỉ quan sát webhook và dữ liệu đã
được che nhạy cảm.
