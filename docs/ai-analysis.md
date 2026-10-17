# Phân tích đầu tư vàng: vận hành và nghiệm thu

## Trải nghiệm AI v2

Từ 18/10/2026, `/phan-tich` mở bằng ô chat trống và bốn gợi ý nhỏ; không tự dùng Sổ vàng. `goal` mô tả câu hỏi, còn `usePortfolioLedger` là lựa chọn dùng dữ liệu sổ. Client mới luôn gửi boolean này; request cũ chưa có cờ vẫn dùng quy ước `goal=hold`. Câu hỏi tự khai số lượng/giá vốn được tính độc lập. Câu tra cứu hướng tới 40–100 từ, giải thích thường 200–350 từ, chuyên sâu tối đa khoảng 600 từ; Gemini dùng mức suy luận LOW cho chế độ thường để dành token cho nội dung. Thẻ số liệu được chọn theo câu hỏi; nguồn/phạm vi thu vào phần mở rộng. `POST /api/analysis/prepare` kiểm tra input và capability mà không trừ lượt; `POST /api/analysis` vẫn là luồng SSE tương thích v1 và nhận `responseVersion: 2`, `goal`, `analysisDepth`, `scenarioInputs` cùng lựa chọn hồ sơ/sổ. SSE v2 bổ sung `facts` và `decision` đã xác thực schema để UI dựng thẻ số liệu/kết luận; số liệu vẫn lấy từ server.

Production đặt `AI_EXPERIENCE_V2_ENABLED=true`. Mọi tài khoản Google có email đã xác minh dùng được bốn mục tiêu AI sau khi đăng nhập. Kết quả v2 có `promptVersion` và `schemaVersion` trong metadata hoàn tất. Phản hồi “Hữu ích/Chưa hữu ích” gửi tới `POST /api/analysis/feedback` theo `requestId`, chỉ lưu rating/reason và không lưu nội dung tự do.

## Cấu hình

Đặt `AI_PROVIDER=auto`, `HERMES_BASE_URL`, `HERMES_API_KEY`, `HERMES_MODEL` và
`GEMINI_API_KEY` ở máy chủ. Dùng Gemini project có billing cho dữ liệu hồ sơ cá nhân. Không nhập key vào UI
hay commit `.env.local`. Google OAuth là hàng rào đăng nhập; `ADMIN_EMAILS`
quyết định quyền quản trị.

B2C AI được bật bằng `B2C_AI_ENABLED=true` sau khi đã cấu hình Neon. Trong beta
cộng đồng, tài khoản Google đã xác minh có 3 lượt phân tích hoàn tất mỗi tháng
lịch Việt Nam. Beta trả phí đầu tiên chỉ mở Plus 99.000 đồng/30 ngày/20 lượt
khi `SUBSCRIPTIONS_SALES_ENABLED=true` và `SUBSCRIPTION_BETA_SINGLE_PLAN=true`;
không tự động gia hạn. Ngân sách free và paid được tách qua
`AI_MONTHLY_BUDGET_VND` và `AI_SUBSCRIPTION_MONTHLY_BUDGET_VND`.

Trang `/donate` và webhook dùng `DONATIONS_ENABLED=true`, độc lập với đăng
nhập và bán thuê bao. Đơn ủng hộ không cấp quota, không mở khóa tính năng và
chỉ lưu số tiền/mã đối soát cần thiết. Có thể đặt `DONATION_PAYMENT_PREFIX=DN`.

Câu hỏi dự báo như “dự đoán giá vàng tuần sau” được nhận diện riêng. Server
neo ngày đích sau 7 ngày theo giờ Việt Nam, tải lịch sử của đúng sản phẩm và
tạo ba vùng giảm/cơ sở/tăng từ phân vị thay đổi cách 7 ngày. Vùng giá mang
trạng thái thực nghiệm; không phải xác suất, giá mục tiêu hay cam kết. Khi
thiếu nguồn hiện tại hoặc lịch sử, UI chỉ hiển thị lý do thiếu dữ liệu và không
cho provider tự đặt số.

Trên máy local, `HERMES_BASE_URL=http://127.0.0.1:50705/v1` dùng gateway đang
chạy trên máy. Production Vercel không thể gọi địa chỉ loopback; khi không có
đủ bộ biến Hermes, chế độ `auto` bỏ qua lỗi cấu hình nhanh và dùng Gemini. Muốn
production thực sự dùng Hermes, đặt `HERMES_BASE_URL` là gateway public HTTPS,
thêm `HERMES_API_KEY` và `HERMES_MODEL` vào Environment Variables của Vercel,
rồi redeploy.

Model mặc định: Hermes gateway `gpt-5.4-mini` cho tra cứu số liệu và đầu tư;
Gemini `gemini-3.6-flash` cho thông tin mới. Khi Google Search Grounding bị
429, Gemini tự chuyển sang câu trả lời thường và ghi cảnh báo chưa xác minh web.
Override qua `OPENAI_MODEL`, `OPENAI_DEEP_MODEL`, `GEMINI_MODEL`,
`GEMINI_DEEP_MODEL`. Auto dùng Hermes cho câu hỏi giá/tính toán/đầu tư và
Gemini cho câu hỏi vĩ mô/tra cứu. `AI_PROVIDER=hermes` hoặc `gemini` vẫn là
chế độ cố định; OpenAI chỉ còn hỗ trợ chẩn đoán.

API key thiếu hoặc cả hai provider thất bại: kết quả được đánh dấu limited,
chỉ có số liệu server. Không được coi đây là nghiệm thu chất lượng LLM.

## Luồng dữ liệu

POST `/api/analysis` vẫn kiểm tra origin, phiên Google và entitlement/quota
(allowlist admin được miễn). Request
có thể thêm `investorProfile` (capitalVnd, cashNeededVnd, feesVnd, horizon,
risk, holdings). Mỗi holding có companyId, productId, quantityLuong,
costPerLuongVnd. Các số tiền là VNĐ; giá bảng thị trường là triệu VNĐ/lượng.
Phí là chi phí cho mỗi vị thế, không phải phần trăm. Bỏ trống phí nghĩa là
chưa biết, phép tính tạm tính 0 và phải hiển thị giả định.

Router quyết định phạm vi từ câu hỏi; có tối đa một lượt phân loại khi mơ hồ.
Thị trường được tải trên server, gộp các quy cách chung mã chuỗi, giữ khu vực
PNJ độc lập. Snapshot thiếu ngày D hoặc D-1 không được xếp hạng thay đổi ngày.
SJC có quy cách dùng chung mã lịch sử nhưng khác quote chính thức: không lấy
lịch sử chung làm lịch sử riêng khi người dùng chọn quy cách đó.

Giới hạn mạng theo host là 4 request cùng lúc; tái sử dụng response trong một
lượt phân tích, cache GET công khai bốn phút. Không cache response LLM.
Câu so sánh hôm qua dùng lịch sử một ngày của nguồn chính thức, hai ngày
cho API tổng hợp (gồm hôm nay). Cửa sổ dài vẫn bị giới hạn bởi khả năng nguồn.

SSE giữ delta/sources/done/error và thêm status, metadata, warning, grounding.
Metadata ghi phạm vi, độ đầy đủ và nguồn từng nhóm; grounding ghi citation
theo offset ký tự của nội dung. Done gồm provider, model, grounded, completion
(complete/truncated/limited), requestId, asOf. Gemini byte offsets được đổi
sang chỉ số chuỗi JS trước khi hiển thị trích dẫn.

Giới hạn cả request 75s, route maxDuration=90. Auto thử mỗi provider tối đa
28s; chuyển provider chỉ trước khi phát nội dung. Tin mới được giữ lại tới khi
có bằng chứng citation; không có citation thì thử provider khác. Deadline
chung luôn được ưu tiên. Trạng thái bận chỉ bảo vệ mỗi process Vercel, không
phải quota phân tán toàn hệ thống.

## B2C quota và SePay

Quota được reservation nguyên tử trong Neon Postgres qua Drizzle, khóa theo
user trong transaction. `clientRequestId` chống tính trùng; lỗi, hủy và kết quả
`limited` hoàn lượt. `complete` và `truncated` mới tính lượt. Community quota
được lọc theo tháng lịch Việt Nam, không cộng dồn. Ngân sách AI mặc định tách
cộng đồng (`AI_MONTHLY_BUDGET_VND=300000`, `AI_DAILY_BUDGET_VND=10000`) và
subscription (`AI_SUBSCRIPTION_MONTHLY_BUDGET_VND=300000`,
`AI_SUBSCRIPTION_DAILY_BUDGET_VND=30000`); reservation mặc định là
`AI_COST_RESERVATION_VND=1000`. Có thể đặt giá token để tính dự toán theo
capability. Khi chạm trần, công cụ số liệu vẫn dùng được nhưng lượt AI mới bị
từ chối trong bucket tương ứng.

Checkout thuê bao dùng `POST /api/billing/orders`, đơn có hiệu lực 24 giờ và QR VietQR
chứa số tiền cùng mã `KT` + 10 ký tự. SePay gọi `POST /api/webhooks/sepay`;
endpoint xác minh raw-body HMAC-SHA256, timestamp ±5 phút, tài khoản nhận, mã
đơn, số tiền và `transferType=in`. `sepayId` unique chống retry/replay. Sai
đối soát được lưu `needs_review` và trả 200; lỗi database trả 503 để SePay retry.
`/admin/billing` cho phép admin theo dõi, cấp gói bù và thu hồi. Donate dùng
`POST /api/donations/orders`, `GET /api/donations/orders/[id]` và
`GET /api/donations/summary`; webhook hợp lệ chỉ chuyển trạng thái donation
sang paid, không tạo `subscription_period`.

## Hồ sơ và lịch sử

Hồ sơ version 1 lưu theo tài khoản trong localStorage khi người dùng chủ động
Lưu; không tự sửa từ suy đoán của bot. Lịch sử chat mới cũng phân vùng theo
tài khoản. Lịch sử v1 cũ chưa có chủ sở hữu không tự gán cho tài khoản đang
đăng nhập; dữ liệu cũ vẫn nằm trong khóa cũ, không bị xóa hay mất định dạng.
Hồ sơ lưu lâu dài tới khi người dùng xóa; lịch sử chat có TTL 30 ngày và trần
200KB/50 tin nhắn. Xóa hồ sơ không xóa những câu hỏi đã gửi trong lịch sử.

Chỉ các câu hỏi user (8 lượt, 4.000 ký tự/lượt, tổng 12.000) được gửi tiếp.
Phản hồi của bot chỉ phục vụ đọc lại. Dữ liệu Grounding không dùng cho provider
khác, tạo chỉ mục, cache dùng chung hay crawler. Search Suggestions chỉ hiển
thị trong phiên, không lưu; metadata HTML được sanitize và cô lập trong shadow
DOM. Nội dung Markdown không cho raw HTML, ảnh hay URL javascript.

Sổ vàng nằm ở khóa localStorage riêng theo tài khoản. Bản sao JSON được tạo và khôi phục
ngay trên trình duyệt; ứng dụng không upload dữ liệu sổ. Người dùng nhập từng giao dịch
MUA/BÁN với thương hiệu, sản phẩm, lượng, đơn giá VNĐ/lượng, phí và ghi chú. Hạch toán
FIFO hỗ trợ bán một phần; phí mua cộng vào giá vốn, phí bán trừ vào tiền thu.
Giá trị hiện tại dùng giá mua lại đủ điều kiện; snapshot fallback hoặc giá thiếu
ngày không tạo kết luận bán hôm nay. Summary tách lãi đã chốt, lãi/lỗ ước tính
theo giá mua vào đang hiển thị và cảnh báo điều kiện thu mua. Sổ giới hạn 2.000
giao dịch hoặc khoảng 450KB; bản nhập lỗi không ghi một phần, có thể xuất/khôi
phục JSON. Sổ có thể ghi nơi mua, nơi bán dự kiến, hóa đơn, vỉ/bao bì và serial;
những trường này chỉ hỗ trợ đối chiếu điều kiện, không phải cam kết thu mua.

## Kiểm thử và rollout

Chạy `npm test`, `npx tsc --noEmit`, `npm run build`. Bộ 40 câu nằm ở
`tests/fixtures/analysis-evaluation.ts`; test định tuyến/phạm vi không gọi AI
thật và không đo chất lượng dự báo. Có thêm kiểm thử metrics, hồ sơ, UI,
provider fallback, thiếu citation, SSE timeout/cancel và giới hạn tải nguồn.

Sau khi cấu hình hai key trên môi trường chạy có allowlist:

1. Chạy từng câu trong bộ 40 ở UI, ghi ngày chạy và nguồn hiển thị. Kiểm tra
   trực tiếp câu trong ảnh với những nhóm đủ dữ liệu ngày D/D-1; không đòi
   tên nhóm thắng cố định giữa các ngày.
2. Đánh giá mỗi câu theo năm tiêu chí (1–5): đúng số liệu; đúng câu hỏi/phạm
   vi; nguồn hỗ trợ nhận định; hữu ích cho quyết định sau spread/phí; rõ ràng.
   Ngưỡng thủ công >=4/5. Không có giá/nguồn bịa; thiếu nguồn phải được nêu.
3. Kiểm tra cả desktop/mobile: bảng cuộn ngang, nguồn bấm được, Enter/Shift+
   Enter, dừng/retry, sửa/xóa hồ sơ, đổi tài khoản, tải lại lịch sử.
4. Theo dõi log chỉ chứa requestId, hash tài khoản, provider/model, dataMs,
   firstResponseMs, durationMs, usage, sourceCount và outcome. Không lưu câu
   hỏi hoặc hồ sơ trong log. Mục tiêu 15–45s cho câu phức tạp là mục tiêu đo
   thực tế, không phải bảo đảm trước khi có kết quả upstream.
5. Deploy bản đã build tới project Vercel hiện tại, giữ nguyên allowlist. Bản
   production hiện tại đã đặt `AI_PROVIDER=auto`; homepage và luồng OAuth công
   khai đã được kiểm tra thành công. Không có Hermes public nên giá/tính toán
   trên production sẽ fallback sang Gemini cho tới khi gateway được public hóa.
   Khi lỗi định tuyến, đổi AI_PROVIDER sang provider cố định và redeploy.
   Khi lỗi phiên bản code, rollback deployment trước đó. Không mở công khai
   hoặc tự thực hiện giao dịch trong đợt này.

Trình tự mở B2C: chạy `npm run db:migrate` với `DATABASE_URL_UNPOOLED`, cấu hình
SePay Test mode và endpoint public HTTPS, thử webhook HMAC/replay, bật flag cho
allowlist Google cohort, rồi mới mở rộng. Neon `DATABASE_URL` nên là pooled;
migration dùng URL unpooled.

Tài liệu API: https://developers.openai.com/api/docs/guides/tools-web-search
và https://ai.google.dev/gemini-api/docs/google-search . Yêu cầu lưu/hiển
thị Grounding: https://ai.google.dev/gemini-api/terms#grounding-with-google-search .
