# Kiểm chứng Hỏi AI — 18/10/2026

## Bản triển khai

- Project Vercel: `chart-gold`.
- Deployment: `dpl_5J45ChCXLqAYC2LdBp5CpbS8xQeA`, trạng thái `READY`, target production.
- URL: https://www.vanghomnay.online/phan-tich
- Prompt: `2026-10-v4-focus`; schema/SSE vẫn tương thích v1/v2, không migration.

## Hành vi đã thay đổi

- Trang mở bằng ô hỏi trống; gợi ý chỉ điền nháp. Chuyên sâu nằm trong Tùy chọn.
- Client gửi `usePortfolioLedger` rõ ràng. Sổ vàng chỉ dùng sau khi chọn; nhập số lượng/giá vốn trực tiếp không yêu cầu có sổ. Request cũ chưa có cờ giữ quy ước `goal=hold`.
- Prompt chia theo câu hỏi, lọc dữ liệu gửi model và điều chỉnh độ dài. Chế độ thường của Gemini dùng suy luận LOW để hạn chế cắt câu trả lời vì hết token.
- Số liệu ưu tiên theo câu hỏi, không lấy ba thẻ đầu tiên. Bỏ kết luận chung và nút hỏi tiếp cố định; nguồn/phạm vi thu vào một phần mở rộng. Citation không bị cắt hoặc sửa sau khi sinh.
- Khôi phục nháp sau đăng nhập giữ lựa chọn không dùng sổ; ô nhập chờ kiểm tra phiên để tránh mất nội dung khi chuyển từ trạng thái khách sang tài khoản.

## Kiểm tra tự động

- `npm test -- --reporter=dot --silent`: **525 passed**, 40 skipped theo cấu hình môi trường của repo; không có test fail.
- `npx tsc --noEmit`, `npm run lint`, `npm run build`: đạt.
- E2E analysis/layout/workflow: **24 passed**, 2 skipped vì thiếu database kiểm thử riêng. Kiểm tra bổ sung khôi phục nháp Google và giữ opt-out Sổ vàng: **1 passed**. Tổng 25 ca E2E khác nhau đạt.
- Remote build Vercel: đạt, bao gồm TypeScript và tạo các trang.

## Kiểm tra trên production

Playwright truy cập domain thật với phiên khách, ở 390/768/1280px:

- HTTP 200; ô hỏi trống và gợi ý điền đúng nội dung.
- Không tự hiện ngữ cảnh sổ; chọn Sổ vàng hiện nhãn, nút Bỏ tắt được ngữ cảnh.
- Không tràn ngang trang ở cả ba kích thước.
- `POST /api/analysis/prepare` cho câu tra giá với `goal=buy` cũ trả 200, không yêu cầu dữ liệu mua không liên quan; vẫn yêu cầu đăng nhập. Endpoint prepare không sử dụng lượt AI.

Ảnh kiểm tra và kết quả JSON nằm trong `outputs/ai-production-*.png` và `outputs/ai-production-verification.json` (không đưa lên Vercel).

## Giới hạn kiểm chứng model thật

- Dùng Gemini thực với bộ câu hỏi chuẩn và dữ liệu giá giả lập có đánh dấu rõ để kiểm tra cách trả lời, không coi là kiểm chứng giá thị trường thực tế.
- Đợt đầu cho thấy một số câu bị cắt do token suy luận. Sau khi chỉnh LOW, 7 phản hồi hoàn tất, không còn trường hợp truncated trong những phản hồi trả về.
- Chưa nghiệm thu được đủ 40 câu hoặc xác nhận ngưỡng chất lượng 90%. Key Gemini local trả HTTP 429 với quota `GenerateRequestsPerDayPerProjectPerModel-FreeTier`, giới hạn **20 request/ngày**. Đã dừng các lần gọi còn lại; không tăng quota hoặc đổi key/model để vượt giới hạn.
- Gateway Hermes local không kết nối được. Không có phiên Google đăng nhập trong trình duyệt kiểm tra production, nên chưa xác minh một lượt sinh trả lời thật qua tài khoản trên domain production. Luồng tài khoản, SSE, retry và lựa chọn sổ đã được kiểm tra bằng E2E local và contract tests.
- Kết quả chưa đủ để tuyên bố toàn bộ bộ đánh giá AI thật đã đạt; cần chạy phần còn lại sau khi quota/key hợp lệ sẵn sàng.
