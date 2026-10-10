# So sánh tính năng giavang.day và dự án Kim Tuyến

Ngày khảo sát: **05/09/2026**  
Phạm vi: các tính năng người dùng có thể nhìn thấy hoặc sử dụng trên
[giavang.day](https://giavang.day/) so với code hiện tại của Kim Tuyến.

## Kết luận nhanh

`giavang.day` là một cổng dữ liệu vàng B2C có độ phủ lớn: nhiều nguồn, nhiều
trang theo nhu cầu tìm kiếm, thống kê chuyên sâu, dữ liệu vàng thế giới, dự
đoán/kịch bản, công cụ quy đổi/tích lũy, tin tức và các tính năng giữ chân.

Kim Tuyến hiện mạnh hơn ở **trợ lý hỏi đáp có nguồn, tính spread/hòa vốn, hồ sơ
đầu tư và sổ vàng FIFO trên thiết bị**. Phần lớn khoảng cách không nằm ở một thuật toán
riêng lẻ mà ở các trải nghiệm sản phẩm độc lập và các vòng quay lại hằng ngày.

Quy ước:

- **Thiếu:** chưa có route, UI hoặc luồng sử dụng tương đương.
- **Một phần:** đã có dữ liệu/logic trong dashboard hoặc chatbot nhưng chưa có
  trải nghiệm độc lập tương đương.
- **Có tương đương:** đã đáp ứng mục tiêu chính, không nên ưu tiên sao chép.

## Bảng đối chiếu

| Tính năng đối thủ có                                                 | Bằng chứng công khai                                                                                                                              | Kim Tuyến hiện tại                                                                                                                                                              | Trạng thái           | Ưu tiên đề xuất                           |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- | ----------------------------------------- |
| Bảng giá 9 nguồn và nhiều loại vàng                                  | [Trang chủ](https://giavang.day/) nêu 9 nguồn, nhiều nhóm sản phẩm; [trang ủng hộ](https://giavang.day/donate) liệt kê lại các nguồn              | Có registry nhiều nguồn trong `lib/market-sources.ts`, nhưng một số nguồn đang dùng aggregator; Mi Hồng đang unavailable, chưa có Ngọc Thẩm/Ngọc Hải/BTMH như các nguồn độc lập | Một phần             | P1, sau khi xác minh quyền dữ liệu        |
| So sánh tất cả nguồn, mua/bán, nguồn rẻ nhất                         | [Trang so sánh](https://giavang.day/so-sanh) có 9 niêm yết, 12 loại vàng, 54 mức giá và chọn nguồn rẻ nhất                                        | Chatbot có thể xếp hạng theo câu hỏi; dashboard chưa có trang ma trận so sánh và “tiết kiệm bao nhiêu”                                                                          | Một phần             | P0                                        |
| Thống kê min/max/trung bình, momentum, heatmap giờ, tương quan vĩ mô | [Trang thống kê](https://giavang.day/thong-ke) mô tả các chỉ số và hiển thị min/max/trung bình, hòa vốn, vị trí giá, tốc độ thay đổi              | `lib/analysis/metrics.ts` có MA7/MA30, high/low, volatility, drawdown nhưng chủ yếu đưa vào ngữ cảnh AI; chưa có trang thống kê trực quan                                       | Một phần             | P1                                        |
| Biểu đồ độc lập với nhiều kiểu đường và nhiều khoảng thời gian       | [Trang biểu đồ](https://giavang.day/chart) có 7N/30N/90N/6T/1N, đường mượt/thẳng/bậc, đường tham chiếu và đỉnh/đáy                                | Dashboard có một biểu đồ mua/bán và 7N/1T/1N; chưa có kiểu đường, 90N/6T, nhiều nguồn trên cùng chart                                                                           | Một phần             | P1                                        |
| Lịch sử giá theo ngày và trang riêng theo nguồn/sản phẩm             | Menu đối thủ có “Lịch sử giá”; [trang biểu đồ](https://giavang.day/chart) có liên kết tới các trang nguồn và lịch sử                              | Chỉ có dashboard một route, dữ liệu lịch sử được tải cho phân tích; chưa có route ngày/sản phẩm có thể index và chia sẻ                                                         | Thiếu                | P1                                        |
| Trang “giá vàng tuần này”                                            | Menu và footer đối thủ liên kết trực tiếp tới tính năng tuần                                                                                      | Có thể hỏi chatbot về kỳ 7 ngày nhưng chưa có trang/summary tuần riêng                                                                                                          | Thiếu                | P2                                        |
| Vàng thế giới XAU/USD và premium trong nước                          | Homepage hiển thị XAU/USD; [kịch bản vàng](https://giavang.day/kich-ban-gia-vang) hiển thị premium và chênh lệch với thế giới                     | AI có thể giải thích vĩ mô, nhưng dashboard chưa có series XAU/USD, premium hoặc quy đổi trực tiếp                                                                              | Thiếu                | P1                                        |
| Dự đoán AI theo nhiều mốc và hậu kiểm                                | [Trang dự đoán](https://giavang.day/du-doan) có mốc đã chấm đúng/sai, khoảng giá, xu hướng, confidence và độ chính xác                            | Kim Tuyến dùng Gemini/Hermes hỏi đáp theo lượt; chưa có dự đoán tự động theo lịch, kho dự đoán và backtest                                                                      | Thiếu                | P2, không làm trước khi có lịch sử đủ dài |
| Kịch bản tăng/tích lũy/giảm và “Nếu… thì…”                           | [Trang kịch bản](https://giavang.day/kich-ban-gia-vang) có ba nhánh, khoảng giá, điều kiện kích hoạt, premium, tương quan và input XAU/USD/tỷ giá | Prompt AI yêu cầu ba kịch bản nhưng chưa có simulator/slider và phép tính premium tương tác                                                                                     | Một phần             | P1                                        |
| Quy đổi đơn vị vàng                                                  | Menu đối thủ và [trang biểu đồ](https://giavang.day/chart) đều liên kết tới “Quy đổi vàng”                                                        | Chưa có công cụ quy đổi độc lập; parser chỉ chuẩn hóa input sổ vàng                                                                                                             | Thiếu                | P0                                        |
| Tích lũy/DCA, quiz và so vàng với gửi ngân hàng                      | Homepage/[trang ủng hộ](https://giavang.day/donate) mô tả quiz cà phê–vàng, DCA và so sánh với ngân hàng                                          | Sổ vàng trên thiết bị tính giao dịch đã mua/bán; chưa có mục tiêu tích lũy, lịch đóng góp hoặc mô phỏng DCA                                                                    | Một phần             | P1                                        |
| Tin tức và blog phân tích cập nhật                                   | Menu homepage có “Tin tức” và “Phân tích”; [trang ủng hộ](https://giavang.day/donate) mô tả tin tự lọc và bài viết hằng ngày                      | Gemini có thể tìm tin theo câu hỏi, có citation; chưa có news feed/blog/editorial archive                                                                                       | Một phần             | P2                                        |
| Đăng nhập để lưu mục tiêu, watchlist và cảnh báo giá                 | [Trang đăng nhập](https://giavang.day/dang-nhap) nêu rõ ba chức năng này                                                                          | Có Google OAuth, hồ sơ và sổ vàng localStorage; chưa có watchlist, mục tiêu giá hoặc notification server-side                                                                   | Một phần             | P1                                        |
| Chia sẻ ảnh bảng giá                                                 | Homepage có mục “Chia sẻ ảnh” và [trang ủng hộ](https://giavang.day/donate) mô tả biểu đồ/chức năng chia sẻ                                       | Chưa có xuất ảnh bảng giá hoặc card chia sẻ                                                                                                                                     | Thiếu                | P1                                        |
| Kiến trúc SEO nhiều trang                                            | Homepage liên kết biểu đồ, thống kê, so sánh, lịch sử, tuần, thế giới, dự đoán, kịch bản, quy đổi, tích lũy, tin tức và phân tích                 | `app/` hiện chủ yếu có dashboard, privacy/terms, auth, API giá/AI và billing; chưa có content engine hoặc route SEO theo ý định                                                 | Thiếu                | P2                                        |
| Mô hình cốt lõi miễn phí, không paywall                              | [Trang ủng hộ](https://giavang.day/donate) tuyên bố “cốt lõi miễn phí mãi mãi”, không đăng ký và không phí ẩn                                     | Kim Tuyến đang xây trial 3 lượt rồi Basic/Plus/Pro                                                                                                                              | Khác biệt chiến lược | Không sao chép; dùng để định vị           |
| Ủng hộ/cộng đồng                                                     | [Trang ủng hộ](https://giavang.day/donate) có QR, các mức ủng hộ và nội dung cộng đồng                                                            | Chưa có luồng donate/cộng đồng                                                                                                                                                  | Thiếu                | P2, không phải core product               |

## Phân tích từng nhóm tính năng

### 1. So sánh nguồn và “mua ở đâu rẻ nhất” — P0

**Bằng chứng:** đối thủ cho người dùng chọn MUA/BÁN, sắp xếp theo giá, xem số
nguồn đang theo dõi, spread trung bình và bấm từng loại vàng để xem chi tiết
mọi nguồn trên [trang so sánh](https://giavang.day/so-sanh).

**Kim Tuyến đang có:** server đã có `selectQuoteGroups`, xếp hạng tuyệt đối/phần
trăm và giữ nguồn; chatbot có thể trả lời câu hỏi so sánh. Nhưng người dùng phải
biết cách hỏi trong panel AI, chưa có màn hình khám phá nhanh.

**Thuận lợi khi làm:**

- Tận dụng trực tiếp registry và phép tính hiện có.
- Tạo giá trị rõ ràng cho người sắp mua/bán: giá tốt, spread và số tiền chênh.
- Tạo entry point miễn phí mạnh cho funnel B2C và dữ liệu hành vi để biết người
  dùng quan tâm loại vàng nào.

**Bất lợi/rủi ro:**

- Các sản phẩm cùng tên có thể khác tuổi vàng, quy cách, địa điểm và điều kiện
  thu đổi; xếp hạng sai sẽ làm mất niềm tin.
- Cần kiểm soát nguồn chính thức, thời điểm cập nhật, thiếu quote và quyền dùng
  dữ liệu thương mại.
- Nhiều nguồn làm tải server và giao diện bảng lớn hơn.

**Đề xuất:** làm trang `/so-sanh` tối giản trước: chọn loại vàng, MUA/BÁN, bảng
nguồn, spread, timestamp, trạng thái live/delayed/fallback; không gắn CTA
“tốt nhất” nếu không cùng quy cách. Tái sử dụng phép tính server, không để AI
tự xếp hạng.

### 2. Thống kê và biểu đồ độc lập — P1

**Bằng chứng:** đối thủ có các chỉ số kỳ, vị trí giá trong biên, tốc độ thay đổi
1h/6h/24h/7 ngày, heatmap theo giờ và tương quan vĩ mô trên
[trang thống kê](https://giavang.day/thong-ke); [trang biểu đồ](https://giavang.day/chart)
có nhiều kiểu đường, khoảng thời gian và đường tham chiếu.

**Kim Tuyến đang có:** `calculateAnalysisMetrics()` đã tính MA7/MA30, high/low,
volatility và drawdown; dashboard hiển thị chart mua/bán, bình quân kỳ và
cao/thấp. Đây là nền tốt, nhưng nhiều chỉ số chỉ xuất hiện khi chatbot sử dụng
ngữ cảnh.

**Thuận lợi:** tăng thời gian sử dụng, giúp người dùng tự kiểm tra trước khi
hỏi AI, giảm câu hỏi tra cứu lặp lại và tạo trang SEO có giá trị.

**Bất lợi:** cần thiết kế dữ liệu thiếu ngày, timezone, sample size và tooltip
trên mobile; heatmap/tương quan dễ bị người dùng hiểu thành tín hiệu dự báo.

**Đề xuất:** đưa các metric đã có lên một trang thống kê có “số quan sát thực
tế”, trạng thái thiếu dữ liệu và giải thích ngắn. Chỉ bổ sung heatmap/tương
quan sau khi nguồn có timestamp đủ tin cậy; không dựng dữ liệu intraday từ
snapshot ngày.

### 3. Vàng thế giới và premium — P1

**Bằng chứng:** homepage đối thủ hiển thị XAU/USD và trang kịch bản dùng
premium/chênh lệch với thế giới làm một đầu vào.

**Thuận lợi:** liên kết được biến động quốc tế với quyết định mua vàng Việt Nam;
giúp chatbot trả lời nguyên nhân có dữ liệu thay vì chỉ giải thích chung.

**Bất lợi:** phải thêm nguồn có quyền sử dụng, timezone/đơn vị USD/oz, tỷ giá
USD/VND, công thức quy đổi và cảnh báo rằng premium SJC không phải giá giao dịch
chắc chắn. Nguồn quốc tế có thể chậm hoặc giới hạn API.

**Đề xuất:** P1 chỉ làm chart XAU/USD + tỷ giá + premium tham khảo, kèm nguồn và
thời điểm; chưa xây mục tiêu giá hay khẳng định arbitrage.

### 4. Dự đoán AI, kịch bản và hậu kiểm — P2

**Bằng chứng:** đối thủ hiển thị các mốc dự đoán, khoảng giá, độ tin cậy và trạng
thái đúng/sai trên [trang dự đoán](https://giavang.day/du-doan); trang kịch bản có
ba nhánh tăng/tích lũy/giảm, điều kiện kích hoạt và input “Nếu… thì…”.

**Kim Tuyến đang có:** AI prompt yêu cầu ba khung 1–4 tuần, 1–3 tháng và 6–12
tháng; đây là phân tích theo câu hỏi, không phải hệ thống dự đoán chạy theo lịch
và không có kho hậu kiểm.

**Thuận lợi:** tạo lý do quay lại theo ngày/tuần, làm nổi bật năng lực Gemini và
cho phép người dùng thử các giả định.

**Bất lợi/rủi ro:** chi phí AI, dữ liệu mục tiêu phải lưu bền vững, dễ bịa xác
suất/giá mục tiêu, rủi ro pháp lý và uy tín nếu người dùng hiểu là tín hiệu mua
bán. Dữ liệu lịch sử ngắn không đủ để khẳng định hiệu quả dài hạn.

**Đề xuất:** chưa sao chép “AI dự đoán” ở P0. Nếu làm P2, bắt đầu bằng **kịch
bản quy tắc** không cam kết: input giá/tỷ giá/premium, ba nhánh, điều kiện mất
hiệu lực, lưu phiên bản và hậu kiểm công khai; chỉ sau đó mới thử dự đoán AI.

### 5. Quy đổi và tích lũy — P0/P1

**Bằng chứng:** menu đối thủ có “Quy đổi” và “Tích lũy”; trang ủng hộ mô tả DCA,
quiz và so sánh vàng với gửi ngân hàng.

**Kim Tuyến đang có:** parser sổ vàng đã xử lý lượng, chỉ, giá VND/lượng, mua/bán
và FIFO. Đây là lợi thế cho tính toán tài sản thật, nhưng chưa có calculator
đầu vào đơn giản cho người mới.

**Thuận lợi:**

- Quy đổi là tính năng nhỏ, dễ tạo traffic và giảm câu hỏi cơ bản cho AI.
- Có thể dùng lõi FIFO để chuyển sang mục tiêu tích lũy, DCA và điểm hòa vốn.
- Gắn tự nhiên với Plus/Pro mà không cần bán “tín hiệu”.

**Bất lợi:** DCA cần giả định giá, spread, phí, kỳ hạn và số tiền góp; nếu hiển
thị một kết quả duy nhất dễ bị hiểu là cam kết lợi nhuận. Hồ sơ tài chính cần
minh bạch lưu ở đâu và cho phép xóa.

**Đề xuất:** làm `/quy-doi` trước với đơn vị chỉ/lượng/gram và giá trị tham khảo;
sau đó làm mục tiêu tích lũy theo kịch bản, không gọi là dự báo.

### 6. Watchlist, mục tiêu và cảnh báo — P1

**Bằng chứng:** [trang đăng nhập](https://giavang.day/dang-nhap) nói rõ đăng nhập
để lưu mục tiêu tích lũy, watchlist và cảnh báo giá.

**Kim Tuyến đang có:** Google OAuth, hồ sơ và sổ vàng localStorage theo tài khoản;
chưa có watchlist server-side, giá kích hoạt, lịch chạy nền hoặc kênh thông báo.

**Thuận lợi:** tạo retention thực tế hơn việc buộc người dùng hỏi AI mỗi lần;
phù hợp với dữ liệu nhiều thương hiệu và có thể trở thành lý do nâng Plus.

**Bất lợi:** cần cron/queue, chống gửi lặp, timezone, email/Telegram/web push,
trạng thái nguồn và quản lý unsubscribe. Dữ liệu mục tiêu tài chính nhạy cảm
hơn lịch sử chat local.

**Đề xuất:** P1 làm watchlist + cảnh báo trong ứng dụng trước; chỉ thêm email/
Telegram sau khi đo số người bật cảnh báo và quay lại. Không tự suy đoán mục tiêu
từ câu chat.

### 7. Tin tức, blog, SEO và chia sẻ ảnh — P1/P2

**Bằng chứng:** menu đối thủ có Tin tức, Phân tích, nhiều route dữ liệu; homepage
có Chia sẻ ảnh; trang ủng hộ mô tả blog cập nhật hằng ngày và nguồn giá.

**Thuận lợi:** mở rộng kênh tìm kiếm, tăng khả năng chia sẻ và đưa người dùng
vào dashboard/AI; ảnh bảng giá có thể là vòng lan truyền chi phí thấp.

**Bất lợi:** blog cần biên tập và kiểm chứng; tin tức cần bản quyền, ngày công bố
và nguồn; SEO hàng loạt dễ tạo nội dung mỏng; ảnh phải đóng dấu timestamp/source
để không biến giá cũ thành giá hiện tại.

**Đề xuất:** ưu tiên share card dữ liệu có timestamp trước. Chỉ làm SEO cho các
trang có phép tính hoặc quyết định rõ ràng (spread, so sánh, quy đổi), không dựng
content engine hàng loạt trước khi có dữ liệu sử dụng.

## Những tính năng không nên sao chép nguyên trạng

1. **Dự đoán có xác suất/giá mục tiêu** nếu chưa có bộ dữ liệu hậu kiểm và cách
   công khai sai số.
2. **Bao phủ nhiều nguồn chỉ để đạt số lượng**; nguồn aggregator phải được ghi
   rõ, không trình bày như quote chính thức độc lập.
3. **Cảnh báo đa kênh ngay từ đầu**; hãy chứng minh cảnh báo trong ứng dụng có
   người dùng quay lại trước.
4. **Blog/SEO số lượng lớn** nếu chưa có quy trình biên tập và đo chuyển đổi.
5. **Thông điệp “mua rẻ nhất”** khi chưa xác minh cùng quy cách, địa điểm, tồn
   kho và điều kiện thu đổi.

## Lộ trình đề xuất cho Kim Tuyến

### P0 — tạo giá trị ngay trong funnel B2C

- Trang so sánh nguồn: MUA/BÁN, spread, timestamp, thiếu dữ liệu và nguồn tốt
  nhất theo quy cách tương đương.
- Công cụ quy đổi đơn vị và máy tính lỗ do spread/hòa vốn.
- Giữ chatbot, sổ vàng trên thiết bị và trial 3 lượt làm lớp cá nhân hóa.

### P1 — tăng quay lại và lý do nâng gói

- Trang thống kê và biểu đồ mở rộng từ metric server đã có.
- XAU/USD, tỷ giá và premium tham khảo.
- Kịch bản “Nếu… thì…” theo quy tắc, không cam kết giá.
- Watchlist/mục tiêu/cảnh báo in-app; sổ tích lũy mục tiêu/DCA.
- Share card có nguồn, thời gian và trạng thái dữ liệu.

### P2 — chỉ làm khi có bằng chứng giữ chân

- Dự đoán tự động theo lịch và hậu kiểm công khai.
- News/blog/SEO engine có biên tập.
- Cảnh báo email/Telegram và các tích hợp cộng đồng.

## Tiêu chí quyết định đầu tư tính năng

Chỉ đưa một tính năng lên production khi có đủ:

- Nguồn dữ liệu và quyền sử dụng được xác minh.
- Phép tính có fixture, trạng thái thiếu dữ liệu và timestamp rõ.
- Người dùng hiểu đây là giá tham khảo/kịch bản, không phải lệnh giao dịch.
- Có event đo sử dụng, quay lại, conversion và chi phí vận hành.
- Tính năng phù hợp với gói: free tạo niềm tin, Plus cá nhân hóa, Pro phân tích
  sâu; không khóa các thông tin giá cơ bản cần để người dùng kiểm chứng.

## Phương pháp và giới hạn bằng chứng

- Các trang đối thủ được đọc công khai ngày 05/09/2026. Số nguồn, giá và thời
  điểm trên các trang có thể thay đổi sau ngày khảo sát.
- “Có link trong menu/trang ủng hộ” là bằng chứng tính năng được website quảng
  bá; một số route như Tích lũy, Quy đổi, Tin tức và Phân tích có thể timeout khi
  crawl và cần kiểm tra lại thủ công trước khi xây bản sao chi tiết.
- Không có analytics, doanh thu, hợp đồng dữ liệu hoặc mã nguồn của đối thủ;
  lợi ích, chi phí, KPI và thứ tự P0/P1/P2 trong báo cáo là đánh giá sản phẩm,
  không phải số liệu kinh doanh đã xác minh.

## Nguồn bằng chứng chính

- [Trang chủ giavang.day](https://giavang.day/)
- [Biểu đồ](https://giavang.day/chart)
- [Thống kê](https://giavang.day/thong-ke)
- [So sánh giá](https://giavang.day/so-sanh)
- [Dự đoán AI](https://giavang.day/du-doan)
- [Kịch bản giá vàng](https://giavang.day/kich-ban-gia-vang)
- [Đăng nhập](https://giavang.day/dang-nhap)
- [Ủng hộ dự án](https://giavang.day/donate)
- [Điều khoản](https://giavang.day/dieu-khoan)

## Nguồn đối chiếu trong code Kim Tuyến

- `app/page.tsx`: dashboard, bộ lọc, chart và các route UI hiện có.
- `lib/market-sources.ts`: registry công ty/sản phẩm và adapter nguồn.
- `lib/analysis/metrics.ts`: MA7/MA30, high/low, volatility, drawdown.
- `lib/analysis/market-context.ts`: nhóm sản phẩm, ranking, spread và nguồn.
- `lib/analysis/provider.ts`: Gemini/Hermes, research, scenario prompt.
- `lib/portfolio-ledger.ts`: sổ giao dịch, FIFO, phí, giá vốn và lãi/lỗ.
- `components/portfolio/ledger-backup.tsx`: sao lưu/khôi phục JSON và lưu local.
- `components/analysis/investor-profile-form.tsx`: hồ sơ đầu tư local.
