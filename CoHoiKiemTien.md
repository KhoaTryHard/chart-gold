# Cơ hội kiếm tiền từ dự án Kim Tuyến / chart-gold tại Việt Nam

Ngày rà soát: **05/09/2026**. Dành cho chủ dự án là lập trình viên fullstack, thích kinh doanh.

**Khuyến nghị:** bắt đầu bằng **dịch vụ triển khai website và bảng giá riêng cho tiệm vàng nhỏ**, thu phí thiết lập và bảo trì; sau 3–5 khách hàng trả tiền, chuẩn hóa phần nhu cầu giống nhau thành phần mềm thuê bao. Dashboard hiện tại phù hợp làm bản trình diễn và nền tảng kỹ thuật cho hướng này. Chưa có bằng chứng để đặt cược ngay vào bán tín hiệu AI, API đại trà hay quảng cáo theo lượt truy cập.

## 1. Phạm vi và cách đọc báo cáo

Đã kiểm kê cấu trúc dự án và rà soát các luồng nghiệp vụ chính: giao diện giá vàng, danh mục sản phẩm, toàn bộ nhóm API, bộ lấy/chuẩn hóa dữ liệu, thống kê, AI, đăng nhập, lưu hội thoại, trang pháp lý, cấu hình triển khai và bộ kiểm thử. Thư viện UI dùng chung được xem về vai trò trong sản phẩm và kết quả lint, không coi mỗi component dựng sẵn là một tính năng kinh doanh riêng.

GitNexus hiện chỉ có chỉ mục cho một dự án khác, chưa có `chart-gold`; các kết luận về dự án này dựa trên mã nguồn trực tiếp. Không có số liệu analytics, doanh thu, chi phí production, khách hàng hoặc phỏng vấn chủ tiệm được cung cấp. Vì vậy, không suy diễn dự án đã có người dùng hay đã xác thực nhu cầu trả tiền.

Trong tài liệu này:

- **Đã xác minh:** hành vi thể hiện trong mã nguồn, kiểm thử đã chạy hoặc thông tin có nguồn dẫn.
- **Nhận định:** đánh giá kinh doanh từ việc ghép bằng chứng của dự án và thị trường.
- **Giả thuyết thử nghiệm:** giá bán, thời gian, tỷ lệ chuyển đổi, chi phí và mục tiêu đề xuất; không phải giá thị trường đã khảo sát hay cam kết doanh thu.

Giả định làm kế hoạch: bạn triển khai một mình, dành khoảng **15–20 giờ/tuần**, chưa có sẵn mạng lưới tiệm vàng và chưa muốn bỏ vốn mua hàng hóa. Thời gian trong bảng xếp hạng tính từ lúc tập trung vào từng ngách, không phải triển khai đồng thời tất cả.

## 2. Dự án hiện có gì có thể chuyển thành giá trị thương mại?

| Hạng mục | Hiện trạng trong mã nguồn | Ý nghĩa kinh doanh |
|---|---|---|
| Sản phẩm lõi | Dashboard tiếng Việt mang tên Kim Tuyến, chọn thương hiệu/sản phẩm, biểu đồ mua–bán, chênh lệch và biến động | Có nền tảng để demo trực tiếp cho người mua; cần bổ sung quy trình của cửa hàng |
| Công nghệ | Next.js, React, TypeScript, Recharts, UI component dùng chung; cấu hình Vercel vùng `sin1` | Hợp kỹ năng fullstack; cấu hình triển khai không chứng minh production đang hoạt động |
| Phủ dữ liệu | Registry có 10 mục công ty/nguồn; UI loại Mi Hồng vì adapter `unavailable` | Có 9 lựa chọn đang được phép hiển thị, không đồng nghĩa 9 thương hiệu độc lập hay 9 nguồn luôn hoạt động |
| Nguồn trực tiếp | Có adapter SJC, PNJ, BTMC, Phú Quý, VGJ | Giá trị nằm ở chuẩn hóa đúng nguồn, sản phẩm, khu vực và đơn vị |
| Nguồn tổng hợp | DOJI, Bảo Tín, VN Gold, VietinBank qua Vàng.Today; một số nhánh dự phòng cũng dùng nguồn này | Giảm công xây ban đầu nhưng phụ thuộc bên thứ ba và quyền sử dụng dữ liệu |
| Lịch sử | SJC miếng ghép CSV, dữ liệu gần đây và snapshot cục bộ; PNJ/tổng hợp khoảng 30 ngày; BTMC/Phú Quý truy vấn tối đa 7 ngày quá khứ; VGJ chỉ snapshot hiện tại | Chưa có kho lịch sử đồng nhất của riêng dự án để bán nghiên cứu hoặc kiểm thử chiến lược |
| Minh bạch dữ liệu | Có `live`, `delayed`, `fallback`, `unavailable`, liên kết nguồn; không lấy giá SJC thay cho một công ty khác bị lỗi | Đây là điểm nên giữ khi bán sản phẩm có thu phí |
| Phân tích định lượng | MA7/MA30, biến động giá, biên mua–bán, mức giảm từ đỉnh và các thống kê kỳ | Có thể tái dùng cho báo cáo, cảnh báo và công cụ theo dõi |
| AI | Stream câu trả lời, nguồn tham khảo, thống kê do server tính; Gemini mặc định, có adapter OpenAI/Hermes | Có công cụ hỗ trợ soạn nội dung; chưa chứng minh độ chính xác dự báo hoặc hiệu quả đầu tư |
| Tài khoản | Google OAuth, JWT, allowlist quản trị; chặn cả đăng nhập ngoài allowlist | Chưa phải hệ thống khách hàng tự đăng ký và mua gói |
| Lưu trữ | Hội thoại trong `localStorage`, TTL 30 ngày, tối đa 50 tin và 200 KiB; cache dữ liệu chủ yếu trong bộ nhớ tiến trình | Chưa có hồ sơ khách hàng, tài sản, lịch sử giá bền vững hoặc phân tách cửa hàng |
| Thu tiền/vận hành | Chưa thấy billing, subscription, tenant, cảnh báo nền, CRM, thanh toán, hóa đơn hay xử lý đơn hàng | Các mô hình SaaS đều cần phần xây mới; bản hiện tại chưa có luồng thu tiền |
| Thu hút khách | Có metadata/Open Graph và trang pháp lý; chưa thấy hệ thống nội dung SEO theo thương hiệu/địa phương, sitemap riêng hay đo funnel | Có phần trình bày cơ bản, chưa có bộ máy phân phối khách hàng |

Bằng chứng mã nguồn: [giao diện chính](D:/KinhDoanh/chart-gold/app/page.tsx), [registry nguồn](D:/KinhDoanh/chart-gold/lib/market-sources.ts), [danh mục SJC](D:/KinhDoanh/chart-gold/lib/sjc-products.ts), [tổng hợp dữ liệu](D:/KinhDoanh/chart-gold/lib/server/sjc.ts), [PNJ](D:/KinhDoanh/chart-gold/lib/server/pnj.ts), [VGJ](D:/KinhDoanh/chart-gold/lib/server/vgj.ts), [thống kê](D:/KinhDoanh/chart-gold/lib/analysis/metrics.ts), [AI](D:/KinhDoanh/chart-gold/lib/analysis/provider.ts), [API AI](D:/KinhDoanh/chart-gold/app/api/analysis/route.ts), [đăng nhập](D:/KinhDoanh/chart-gold/auth.ts), [lưu hội thoại](D:/KinhDoanh/chart-gold/lib/ai-chat-storage.ts).

### Các khoảng trống ảnh hưởng trực tiếp đến việc bán hàng

1. **Độ mới của giá chưa đủ chặt để cam kết vận hành.** Trình duyệt polling 4 phút, API đặt cache `s-maxage=240` và `stale-while-revalidate=600`; một số adapter còn cache 4 phút. Không thể diễn giải thành cập nhật tức thời hoặc trễ tối đa 4 phút. Một số nguồn dùng thời điểm tải làm `observedAt`, nên tải trang thành công chưa chứng minh hãng vừa cập nhật giá. Cần tách thời gian nguồn công bố, thời gian thu thập và trạng thái chưa biết.
2. **Đơn vị hiện phù hợp xem tổng quan hơn niêm yết giao dịch.** Dữ liệu chuẩn hóa theo triệu đồng/lượng; giá chính ở UI hiển thị một chữ số thập phân, tương ứng bước hiển thị 100.000 đồng/lượng. Một số điểm dữ liệu làm tròn hai chữ số, tương ứng 10.000 đồng/lượng. Bảng giá của tiệm nên giữ độ chính xác nguồn, lưu VND bằng số nguyên hoặc decimal, ghi rõ theo chỉ/lượng và phí công.
3. **Khoảng thời gian đang lấy số bản ghi.** UI và metrics dùng `slice(-7/-30/-365)`. Khi thiếu ngày, “7 ngày” có thể là 7 điểm dữ liệu trải trên hơn 7 ngày; “thay đổi ngày” có thể là thay đổi giữa hai lần có dữ liệu. Cần lọc theo ngày và thể hiện ngày đầu/cuối, số mẫu thực tế.
4. **Biến động giá bán chưa phải lãi thực nhận.** `returnPercent` lấy giá bán cuối kỳ so với giá bán đầu kỳ. Người dùng mua theo giá cửa hàng bán ra, rồi bán lại theo giá cửa hàng mua vào, còn có thể chịu phí. Nếu làm sổ tích lũy, phải tính lại theo từng giao dịch và điều kiện thu mua.
5. **Nhiều lựa chọn chưa phải so sánh tương đương.** Hiện xem từng lựa chọn; chưa có bảng đối chiếu đồng thời. Cần làm rõ mục Bảo Tín so với BTMC, VietinBank tổng hợp so với VGJ trực tiếp; nhãn DOJI có nhóm gộp miếng/nhẫn. Không nên suy ra chênh lệch có thể mua–bán kiếm lời giữa các dòng này.
6. **Rủi ro phản hồi đến sai thứ tự khi đổi bộ lọc nhanh.** `refreshPrices` chưa có cơ chế hủy hoặc bỏ qua request cũ trước khi cập nhật state. Đây là rủi ro suy ra từ code, chưa tái hiện bằng kiểm thử trình duyệt trong lần rà soát này; cần kiểm tra trước khi dùng để hiển thị giá cho khách.
7. **AI chưa có kiểm soát chi phí theo gói.** `activeAnalyses` chỉ chặn phiên đồng thời trong một tiến trình; chưa phải hạn mức tập trung theo ngày/tháng. Request AI chặn khi không có dữ liệu nhưng chưa từ chối tất cả trường hợp dữ liệu cũ/dự phòng. Cần truyền rõ chất lượng nguồn vào phân tích, giới hạn chi phí và theo dõi lỗi trước khi mở cho khách trả phí.
8. **Mở nhiều tài khoản cần thay đổi cách lưu dữ liệu.** Khóa hội thoại hiện dùng chung cho ứng dụng trên trình duyệt, không tách theo user. Cần cô lập lịch sử, quyền truy cập và dữ liệu từng cửa hàng; không chỉ thêm email khách vào allowlist quản trị.
9. **Có lỗi chữ tiếng Việt và nội dung pháp lý cần đồng bộ.** `app/page.tsx` có hai chuỗi bị lỗi mã hóa ở trạng thái thiếu dữ liệu và nhãn chọn công ty. Trang điều khoản vẫn mô tả chủ yếu dashboard SJC trong khi sản phẩm đã mở rộng nhiều nguồn.
10. **Chưa có bằng chứng về quyền khai thác dữ liệu thương mại.** Tài liệu nguồn và endpoint công khai không thay thế thỏa thuận phân phối lại. Trước khi bán API hoặc nhúng giá hãng vào sản phẩm thu phí, cần xác minh điều khoản, quyền lưu lịch sử và quyền cung cấp cho khách. Ngách dùng giá do chính tiệm nhập/duyệt giảm được phần phụ thuộc này.

Các điểm trên là đầu việc ưu tiên thương mại, không phải kết luận sản phẩm đã gây sự cố thực tế.

### Kết quả kiểm tra kỹ thuật trong lần rà soát

- `npm test`: **8 tệp kiểm thử, 31/31 test đạt**. Có kiểm thử metrics, request validation, storage, provider AI, routing model và bộ chuyển đổi dữ liệu.
- `npm run lint`: **chưa đạt**, có lỗi React về effect/purity, accessibility và biểu thức template TypeScript; gồm cả mã UI dùng chung lẫn trang chính.
- Kiểm tra trực tiếp một request công khai Vàng.Today cho `DOHNL`: phản hồi `success: true`, có `buy`, `sell`, `timestamp` ở cấp cao nhất, phù hợp phần parser hiện tại. Đây chỉ là phép thử một endpoint tại một thời điểm, không chứng minh tất cả nguồn ổn định.
- Chưa chạy build, kiểm thử giao diện end-to-end, tải đồng thời, đăng nhập production hoặc gọi AI bằng tài khoản có phí. Bộ test thành công không chứng minh dữ liệu hiện tại của toàn bộ thương hiệu đều đúng.

## 3. Đối chiếu thị trường Việt Nam

### Người xem giá đông không tự động tạo ra khách trả phí

World Gold Council ghi nhận nhu cầu vàng thanh/đồng xu tại Việt Nam trong quý I/2026 khoảng 9 tấn, giảm 24% so với cùng kỳ, cùng tác động của giá cao và hạn chế nguồn cung. Báo cáo quý II/2026 tiếp tục mô tả nhu cầu Việt Nam suy yếu và phần chênh giá nội địa cao. Đây là bằng chứng thị trường có biến động và nhu cầu theo dõi; không phải bằng chứng người dân sẽ trả tiền cho một dashboard mới. [WGC quý I/2026](https://www.gold.org/goldhub/research/gold-demand-trends/gold-demand-trends-q1-2026/investment), [WGC quý II/2026, công bố 30/07/2026](https://www.gold.org/goldhub/research/gold-demand-trends/gold-demand-trends-q2-2026/investment).

### Đối thủ và phương án thay thế đã hiện diện

| Nhóm | Bằng chứng từ thị trường | Hàm ý cho Kim Tuyến |
|---|---|---|
| Giá và API tổng hợp | Vàng.Today công bố API miễn phí, không cần key, cập nhật khoảng 5 phút và lịch sử tối đa 30 ngày | Khó thu phí chỉ bằng việc trả lại cùng dữ liệu; phải bán chất lượng, tích hợp hoặc quy trình |
| Bảng giá TV | Pro Gold Price của Phần Mềm Vàng quảng bá sửa giá bằng điện thoại, mẫu giao diện và đồng bộ với phần mềm quản lý của họ | “Bảng giá lên TV” đã có đối thủ; cần chứng minh triển khai thuận tiện cho nhóm khách cụ thể |
| Phần mềm tiệm vàng | POS365 công bố các chức năng quản lý tuổi vàng, trọng lượng, tiền công, công nợ và hóa đơn | Làm POS toàn diện sẽ kéo theo nghiệp vụ, hỗ trợ và cạnh tranh lớn hơn nhiều so với dự án hiện tại |
| Widget cho website | VNSignal cung cấp widget vàng miễn phí; Nhịp Số giới thiệu tích hợp widget/API và dữ liệu nhiều loại | Widget chung dễ bị thay thế; dịch vụ cài đặt và tùy biến thương hiệu có lý do thu tiền rõ hơn |
| Ứng dụng xem giá | Google Play có ứng dụng Giá Vàng – Tỷ Giá Ngoại Tệ với thông báo giá hằng ngày | Chỉ thêm thông báo ngày mới chưa đủ khác biệt; cần nhu cầu cá nhân hoặc nghiệp vụ có tần suất sử dụng cao |

Nguồn của từng nhóm: [Vàng.Today API](https://www.vang.today/vi/api), [Pro Gold Price](https://www.phanmemvang.com.vn/phan-mem-bang-gia-vang-tren-tivi.html), [POS365 ngành tiệm vàng](https://www.pos365.vn/nganh-nghe/phan-mem-quan-ly-ban-hang-tiem-vang), [VNSignal widgets](https://vnsignal.vn/widgets), [Nhịp Số](https://nhipso.vn/), [ứng dụng trên Google Play](https://play.google.com/store/apps/details?hl=vi&id=com.phuocqb.giavang).

Các tính năng đối thủ ở đây là nội dung nhà cung cấp công bố, chưa phải đánh giá độc lập về chất lượng. Không dùng lời quảng cáo “chính xác tuyệt đối” hay số khách hàng tự công bố làm bằng chứng chất lượng; không có báo giá trực tiếp để kết luận Kim Tuyến rẻ hơn.

### Cơ hội hẹp phù hợp một fullstack thích kinh doanh

Nhận định: khách dễ tiếp cận nhất để thử bán là **tiệm vàng/nữ trang độc lập, một hoặc vài điểm bán, chủ tiệm trực tiếp quyết định, có nhu cầu cập nhật giá riêng và hiện diện trực tuyến**. Ưu tiên nơi có thể đến gặp trực tiếp trong một khu vực nhỏ; chưa cần xác định toàn bộ số tiệm trên cả nước.

Nỗi đau cần kiểm chứng là việc sửa cùng một bảng giá ở nhiều chỗ, đăng hình giá thủ công, thông tin cửa hàng thiếu nhất quán hoặc khách phải hỏi lại những câu lặp đi lặp lại. Những việc này cụ thể hơn mong muốn chung “có AI phân tích vàng”. Nếu tiệm đã dùng hệ thống hiện tại tốt và không gặp các vấn đề trên, họ không phải khách hàng ưu tiên.

### Yếu tố pháp lý ảnh hưởng cách chọn mô hình

Nghị định 232/2025/NĐ-CP thay đổi khung quản lý vàng, trong đó có yêu cầu thanh toán qua tài khoản đối với tổng giá trị mua bán vàng từ 20 triệu đồng trong ngày trở lên của một khách hàng. Hoạt động sản xuất vàng miếng vẫn có điều kiện và giấy phép; không thể hiểu việc bỏ độc quyền là ai cũng được tự mở dịch vụ giao dịch vàng. [Báo Chính phủ về Nghị định 232](https://baochinhphu.vn/chinh-thuc-xoa-bo-co-che-nha-nuoc-doc-quyen-san-xuat-vang-mieng-102250826145041005.htm).

Thông tư 34/2025/TT-NHNN hướng dẫn các vấn đề cấp phép, hạn mức, kết nối thông tin và báo cáo. Đây là lý do ngách tích hợp nghiệp vụ phải có khách hàng và đối tác chuyên môn cụ thể trước khi làm; không nên gắn nhãn “đáp ứng đầy đủ quy định” cho dashboard hiện tại. [Báo Chính phủ về Thông tư 34](https://baochinhphu.vn/ngan-hang-nha-nuoc-huong-dan-quy-dinh-moi-ve-quan-ly-hoat-dong-kinh-doanh-vang-10225101019160628.htm).

Luật Bảo vệ dữ liệu cá nhân có hiệu lực từ 01/01/2026. Nếu mở sổ tài sản, CRM hay đồng bộ hội thoại lên server, cần thiết kế quyền truy cập, xóa dữ liệu và quản lý việc chia sẻ dữ liệu với nhà cung cấp ngay trong phạm vi sản phẩm. Phần rà soát này chỉ xác định ảnh hưởng đến lựa chọn mô hình, chưa thẩm định đầy đủ nghĩa vụ pháp lý cho một dịch vụ giao dịch cụ thể. [Báo Chính phủ về Luật Bảo vệ dữ liệu cá nhân](https://baochinhphu.vn/luat-bao-ve-du-lieu-ca-nhan-chinh-thuc-co-hieu-luc-tu-ngay-mai-1-1-2026-102251231155609721.htm).

## 4. Xếp hạng các ngách theo tính thực tiễn

Chấm điểm chủ quan từ 1–5, điểm cao thuận lợi hơn, theo bối cảnh một người tự làm:

- **T – Tiếp cận người mua:** 30%.
- **C – Lý do chi trả:** 25%.
- **K – Khả năng tận dụng mã hiện tại/độ dễ xây:** 20%.
- **V – Vốn và gánh nặng vận hành thấp:** 15%.
- **R – Rủi ro dữ liệu, pháp lý và cạnh tranh dễ kiểm soát:** 10%.

Điểm /100 = `(30T + 25C + 20K + 15V + 10R) / 5`. Đây là công cụ quyết định ưu tiên, không phải xác suất thành công. Điểm các ngách gần nhau có thể đổi thứ tự sau phỏng vấn thực tế.

| Hạng | Ngách kinh doanh | T/C/K/V/R | Điểm | Mốc có thể thử thu tiền | Ưu tiên |
|---|---|---|---:|---|---|
| 1 | Dịch vụ triển khai website và bảng giá riêng cho tiệm vàng | 5/4/5/5/4 | **93** | 2–4 tuần | Làm đầu tiên |
| 2 | Phần mềm thuê bao đồng bộ bảng giá TV/web cho tiệm nhỏ | 4/4/4/4/4 | **80** | 4–8 tuần | Xây từ khách hạng 1 |
| 3 | Bộ tạo ảnh bảng giá và nội dung hằng ngày cho tiệm/nội dung viên | 4/3/4/5/4 | **78** | 2–4 tuần | Thử như dịch vụ bổ sung |
| 4 | Tích hợp widget thương hiệu riêng cho agency/website ngành vàng | 3/3/5/4/3 | **71** | 2–6 tuần | Kênh bán thứ hai |
| 5 | Sổ tích lũy vàng cá nhân kèm cảnh báo mục tiêu | 3/2/3/4/2 | **56** | 6–10 tuần | Chỉ mở rộng khi có giữ chân |
| 6 | API và lịch sử giá chuẩn hóa cho khách B2B | 3/3/3/2/2 | **55** | 8–16+ tuần | Cần khách và quyền dữ liệu trước |
| 7 | Module báo giá/đối soát tích hợp vào phần mềm tiệm vàng | 2/4/1/2/3 | **49** | 8–16+ tuần | Nhận theo hợp đồng cụ thể |
| 8 | Danh bạ tiệm vàng địa phương và chuyển khách có nhu cầu | 2/3/2/3/2 | **48** | 8–16+ tuần | Chưa ưu tiên khi chưa có đối tác |

Các hạng 1–4 có thể dùng chung nền tảng, nhưng không cộng doanh thu của chúng như bốn tập khách hoàn toàn độc lập. Trong 90 ngày đầu chỉ nên chọn một phân khúc và một lời chào bán chính.

## 5. Chi tiết từng ngách và lộ trình ngắn

### Hạng 1 — Dịch vụ triển khai website và bảng giá riêng cho tiệm vàng

**Người trả tiền:** chủ tiệm độc lập muốn có trang chính thức dễ gửi cho khách, hiển thị giá của tiệm, địa chỉ, giờ mở cửa, chính sách thu đổi và nút liên hệ.

**Bán kết quả:** một nơi cập nhật thông tin và giá, có giao diện theo thương hiệu, được cài đặt và hướng dẫn sử dụng. Khách mua công triển khai và sự thuận tiện; không cần phải thuyết phục họ đăng ký một SaaS xa lạ ngay từ đầu.

**Vì sao đứng đầu:** tận dụng tốt UI và dữ liệu hiện có, thu tiền theo dự án, tiếp cận người quyết định trực tiếp, không cần lượng truy cập lớn hay vốn hàng hóa. Bạn có thể dùng khả năng fullstack để giao trọn gói và sự yêu thích kinh doanh để phỏng vấn, demo, chốt hợp đồng.

**Phạm vi tối thiểu:** một website, một màn hình nhập/duyệt giá riêng, mẫu bảng giá, liên hệ, đào tạo bàn giao. Giá thị trường để tham khảo phải tách rõ khỏi giá do tiệm chịu trách nhiệm niêm yết. Dữ liệu hãng chỉ đưa vào phần bán cho khách sau khi rõ quyền sử dụng.

**Giá thử nghiệm:** 4–8 triệu đồng phí thiết lập; 300.000–700.000 đồng/tháng cho hosting, sao lưu và hỗ trợ có giới hạn. Tên miền, thiết bị, nhập nhiều sản phẩm và thay đổi ngoài phạm vi báo riêng. Có thể đặt cọc 30–50% sau khi khách duyệt demo và phạm vi; không coi lời khen demo là xác nhận mua.

**Lộ trình:** tuần 1 lập danh sách 30 tiệm và trao đổi với ít nhất 10 chủ tiệm; tuần 2 demo có logo/giá do khách cung cấp và gửi báo giá; tuần 3–4 bàn giao cho 1–2 khách đầu tiên. Dùng mẫu chung, hạn chế yêu cầu tùy biến không tái dùng được.

**Điều kiện tiếp tục:** có ít nhất 2 khách trả tiền/đặt cọc trong 10 buổi demo đủ điều kiện. Nếu không, tìm hiểu lý do và đổi thông điệp/phạm vi trước khi xây thêm. Rủi ro chính là biến thành làm web giá rẻ không giới hạn sửa; giải quyết bằng tiêu chí nghiệm thu và khung hỗ trợ rõ ràng.

### Hạng 2 — Thuê bao đồng bộ bảng giá TV và web

**Người trả tiền:** tiệm đã phải cập nhật cùng giá lên nhiều nơi, hoặc có vài màn hình/điểm bán và thấy cách hiện tại bất tiện.

**Bán kết quả:** chủ tiệm sửa trên điện thoại, xem trước, duyệt một lần rồi xuất bản lên bảng TV và website; có lịch sử ai đổi giá, lúc nào và khả năng khôi phục. Không mặc định tự động lấy giá hãng làm giá bán của tiệm.

**Vì sao thực tiễn:** công việc có thể lặp hằng ngày, dễ quan sát thời gian tiết kiệm và tạo doanh thu duy trì. Phần khó không chỉ là giao diện TV mà còn là độ ổn định, kết nối thiết bị và hỗ trợ tại cửa hàng. Đối thủ Pro Gold Price đã hiện diện, nên lợi thế phải được khách xác nhận qua thử nghiệm, chẳng hạn dùng được thiết bị sẵn có và quy trình web phù hợp với họ.

**Cần xây:** tenant, vai trò chủ tiệm/nhân viên, giá riêng, phiên bản xuất bản, nhật ký, màn hình chữ lớn, nhận biết mất mạng và trạng thái bản cuối cùng. Cần kiểm tra khả năng tương thích Smart TV thực tế; không hứa mọi TV đều chạy được.

**Giá thử nghiệm:** 1–3 triệu đồng thiết lập; 299.000–599.000 đồng/cửa hàng/tháng. Nếu vừa mua gói hạng 1, có thể miễn/khấu trừ phần thiết lập trùng nhau. Thiết bị tách khỏi giá thuê bao.

**Lộ trình:** 2 tuần cùng 2 tiệm xác định quy trình nhập/duyệt; 2–4 tuần xây phần tối thiểu; 2 tuần vận hành có thu phí tại 3–5 tiệm. Chỉ đưa thêm đa chi nhánh khi khách hiện tại cần và trả tiền.

**Điều kiện tiếp tục:** ít nhất 3/5 tiệm thử nghiệm trả tiền tháng kế tiếp, dùng đều trong ngày mở cửa và thời gian hỗ trợ sau onboarding dưới khoảng 1 giờ/tiệm/tháng. Nếu khách chủ yếu muốn thanh toán một lần, kiểm tra mô hình giấy phép + bảo trì thay vì ép thuê bao.

### Hạng 3 — Tạo ảnh bảng giá và nội dung cho tiệm vàng

**Người trả tiền:** chủ tiệm, nhân viên phụ trách nội dung hoặc agency nhỏ quản lý nhiều trang của tiệm.

**Bán kết quả:** mẫu ảnh đúng thương hiệu và đúng giá đã duyệt, cập nhật nhanh cho các kênh khách đang dùng; kèm bản nháp giải thích biến động ngắn gọn. AI chỉ giúp soạn nháp, còn số liệu được dựng từ dữ liệu có kiểm tra.

**Vì sao có cơ hội:** tận dụng bảng giá, thống kê và provider AI hiện có; có thể bắt đầu như dịch vụ làm hộ để kiểm chứng nhu cầu trước khi làm trình biên tập phức tạp. Giá trị nằm ở giảm công lặp lại, không phải tạo thêm dự báo mua bán.

**Cần xây:** template ảnh, xuất PNG/JPEG, chốt ngày giờ và đơn vị, nguồn giá, xem trước/duyệt, lưu phiên bản. Bắt đầu bằng tải ảnh để khách tự đăng; chưa cần phụ thuộc API tự động đăng bài hay gửi tin của các nền tảng.

**Giá thử nghiệm:** 500.000–1,5 triệu đồng/tháng cho dịch vụ có giới hạn số mẫu/lần chỉnh; hoặc 149.000–299.000 đồng/tháng nếu khách tự thao tác. Hai mức là hai cách cung cấp khác nhau, không hứa dịch vụ làm hộ vô hạn ở giá phần mềm.

**Lộ trình:** tuần 1 làm 3 mẫu, phỏng vấn 5 người đang đăng bài; tuần 2–3 cung cấp thủ công có thu phí; tuần 4 tự động hóa phần được sử dụng thường xuyên.

**Điều kiện tiếp tục:** 3 khách thực sự xuất bản nội dung nhiều lần/tuần và ít nhất 2 khách gia hạn. Điểm yếu là khách có thể dùng mẫu thiết kế sẵn hoặc ảnh chụp bảng giá; phải đo công tiết kiệm và số lần sửa, không chỉ hỏi họ có thấy đẹp không.

### Hạng 4 — Widget thương hiệu riêng và dịch vụ tích hợp cho agency

**Người trả tiền:** agency làm website cho tiệm vàng hoặc website chuyên ngành có yêu cầu giao diện, hỗ trợ và tích hợp cụ thể.

**Bán kết quả:** widget hoạt động trong website của họ, đúng nhận diện, đúng nguồn/đơn vị, có hướng dẫn và người chịu trách nhiệm sửa khi hỏng. Widget chung đã có lựa chọn miễn phí; ngách này bán phần triển khai và tùy biến.

**Tận dụng:** API đọc giá và component biểu đồ. **Cần xây:** giao diện nhúng độc lập, cấu hình theo khách, whitelist domain nếu cần, cache, theo dõi lỗi; dùng giá tiệm cung cấp hoặc nguồn có quyền sử dụng phù hợp.

**Giá thử nghiệm:** 2–5 triệu đồng/lần tích hợp và 200.000–500.000 đồng/tháng bảo trì; báo riêng dự án có dữ liệu/thiết kế phức tạp. Nếu agency có nhiều khách, chỉ chiết khấu sau khi tính đủ công hỗ trợ.

**Lộ trình:** tuần 1 làm demo nhúng; tuần 2 tiếp cận có chọn lọc 10 agency; tuần 3–6 hoàn tất 1–2 tích hợp trả tiền. Tạo tài liệu để agency có thể tự triển khai lần sau.

**Điều kiện tiếp tục:** có 2 đơn trả tiền và một agency giới thiệu khách tiếp theo. Nếu mọi khách chỉ cần bảng giá miễn phí, dùng widget như công cụ giới thiệu dịch vụ hạng 1 thay vì cố bán riêng.

### Hạng 5 — Sổ tích lũy vàng cá nhân và cảnh báo mục tiêu

**Người trả tiền:** người đã mua vàng vật chất nhiều lần, muốn biết giá vốn, tổng lượng nắm giữ và giá trị bán lại tham khảo.

**Bán kết quả:** ghi mua theo từng lần, thương hiệu, loại vàng, lượng thực tế, tiền công/phí; tính giá trị thu hồi theo giá mua vào phù hợp; cảnh báo khi chạm mục tiêu do người dùng đặt.

**Vì sao xếp sau B2B:** hữu ích hơn chỉ xem biểu đồ, nhưng thói quen ghi chép, niềm tin khi nhập tài sản và sẵn lòng trả phí đều chưa rõ. Excel, ghi chú và ứng dụng xem giá là phương án thay thế gần gũi.

**Cần xây:** dữ liệu giao dịch và danh mục, xuất/nhập CSV, tài khoản khách hàng, đồng ý lưu dữ liệu, xóa tài khoản, cảnh báo chạy nền và chống gửi lặp. Có thể thử bản lưu tại thiết bị trước; không giả định `localStorage` hội thoại hiện tại đã giải quyết việc này.

**Giá thử nghiệm:** phần cơ bản miễn phí, Pro 29.000–59.000 đồng/tháng hoặc 299.000–499.000 đồng/năm. Chưa mở AI không giới hạn vì dễ vượt doanh thu trên mỗi người dùng.

**Lộ trình:** 2 tuần phỏng vấn 15 người có nhiều giao dịch; 3–4 tuần xây sổ và tính giá vốn; 2–4 tuần đo sử dụng, sau đó mới thêm cảnh báo trả phí.

**Điều kiện tiếp tục:** trong 30 người đã nhập giao dịch thật, ít nhất 10 quay lại trong tuần 4 và 5 người trả phí. Đây là ngưỡng học hỏi của thử nghiệm nhỏ, không phải benchmark ngành. Ví dụ 500 thuê bao × 39.000 đồng = 19,5 triệu đồng/tháng doanh thu; nút thắt là có và giữ được 500 người trả tiền.

### Hạng 6 — API và kho lịch sử giá chuẩn hóa cho B2B

**Người trả tiền:** đơn vị có nhu cầu tích hợp dữ liệu vào phần mềm, báo cáo hoặc nghiên cứu và không muốn tự duy trì nhiều adapter.

**Bán kết quả:** định nghĩa sản phẩm rõ, thời điểm giá rõ, lịch sử có nguồn gốc, schema ổn định, phát hiện dữ liệu bất thường và hỗ trợ tích hợp. Bán lại nguyên JSON miễn phí khó tạo lợi thế.

**Vì sao chưa làm ngay:** hiện chưa có cơ sở dữ liệu lịch sử riêng, quyền phân phối lại chưa được chứng minh và độ dài lịch sử không đồng nhất. Chi phí duy trì nguồn và yêu cầu mức dịch vụ có thể lớn hơn tiền máy chủ.

**Cần xây:** tiến trình thu thập theo lịch, lưu snapshot gốc khi được phép, dữ liệu chuẩn hóa có phiên bản, dấu thời gian nguồn, API key, quota, tài liệu, đo độ sẵn sàng và quy trình sửa dữ liệu. Việc thu thập từ hôm nay không tạo ra lịch sử nhiều năm ngay lập tức.

**Giá thử nghiệm:** 1–5 triệu đồng/khách/tháng cho phạm vi nguồn và hạn mức cụ thể; đây chưa phải mức được thị trường chấp nhận. Phí mua quyền dữ liệu nếu có phải tính trước khi chốt biên lợi nhuận.

**Lộ trình:** đầu tiên tìm 2 khách có yêu cầu bằng văn bản và làm rõ quyền dữ liệu; 4–8 tuần xây pipeline cho ít nguồn họ cần; vận hành đo chất lượng thêm ít nhất 30 ngày trước khi cam kết mức dịch vụ cao.

**Điều kiện tiếp tục:** có quyền sử dụng phù hợp và ít nhất 2 khách trả tiền đủ bù phần chi phí nguồn/vận hành tăng thêm. Nếu chưa đáp ứng, chỉ dùng lớp dữ liệu cho sản phẩm nội bộ.

### Hạng 7 — Module báo giá hoặc đối soát tích hợp hệ thống tiệm vàng

**Người trả tiền:** cửa hàng lớn hơn hoặc nhà cung cấp phần mềm có một khoảng trống cụ thể: lịch sử thay đổi bảng giá, đối chiếu giá đã duyệt với giao dịch, xuất dữ liệu cho kế toán.

**Bán kết quả:** giải quyết đúng một quy trình qua import/export hoặc API được khách cho phép. Hợp đồng rõ đầu vào, đầu ra và người nghiệm thu.

**Lý do xếp thấp:** khách có thể trả nhiều hơn nhưng phần mới xa dashboard hiện tại; phải hiểu tuổi vàng, tiền công, thu đổi, chứng từ và cách hệ thống cũ hoạt động. Nhà cung cấp POS chuyên ngành đã có nhiều chức năng liên quan. Đây là ngách dịch vụ tích hợp sau khi có quan hệ ngành, chưa phải sản phẩm tự bán ngay.

**Giá thử nghiệm:** 10–30 triệu đồng cho một module nhỏ có phạm vi chốt trước; bảo trì và thay đổi chuẩn tích hợp báo riêng. Không dùng mức này làm giá xây cả POS hay hệ thống tuân thủ hoàn chỉnh.

**Lộ trình:** 2–3 tuần khảo sát dữ liệu thực đã được phép dùng; chốt mẫu xuất/nhập và tiêu chí nghiệm thu; 4–8 tuần làm một module; chạy đối chiếu với quy trình hiện tại trước khi khách dùng chính thức.

**Điều kiện tiếp tục:** một khách có người phụ trách nghiệp vụ, dữ liệu mẫu và đặt cọc; không đầu tư trước chỉ vì ngành có yêu cầu số hóa.

### Hạng 8 — Danh bạ tiệm vàng theo địa phương và chuyển khách có nhu cầu

**Người trả tiền:** tiệm đối tác muốn có khách liên hệ hoặc đặt lịch ghé cửa hàng.

**Bán kết quả:** hồ sơ cửa hàng có xác minh, giờ hoạt động, loại sản phẩm và chính sách thu đổi được tiệm cập nhật; đo được cuộc gọi hoặc yêu cầu tư vấn. Giá niêm yết không đủ để biết có hàng hay cửa hàng có nhận mua lại món vàng của khách.

**Vì sao xếp cuối:** phải xây đồng thời phía người tìm mua và phía cửa hàng; xác minh, cập nhật thông tin và đối soát khách giới thiệu tốn công. Dự án chưa có bản đồ, tồn kho hay đối tác thực địa.

**Giá thử nghiệm:** 300.000–1 triệu đồng/tiệm/tháng cho hồ sơ nâng cao và tiếp nhận liên hệ sau khi chứng minh có nhu cầu thật. Chưa nên thu phần trăm giao dịch hoặc nhận tiền mua vàng hộ.

**Lộ trình:** chỉ làm một khu vực nhỏ; xác minh 10 tiệm; tạo nội dung trả lời nhu cầu địa phương; theo dõi nguồn của liên hệ; đề nghị trả phí khi có kết quả quan sát được.

**Điều kiện tiếp tục:** ít nhất 3 tiệm xác nhận liên hệ hữu ích và đồng ý trả phí. Hồ sơ tài trợ phải ghi rõ, không được biến tiền tài trợ thành thứ hạng “uy tín nhất”.

## 6. Kế hoạch 90 ngày được đề xuất

Chọn thông điệp ban đầu: **“Giúp tiệm cập nhật bảng giá riêng và thông tin cửa hàng thuận tiện, khách xem được trên điện thoại; có người triển khai và hỗ trợ.”** Chỉ thêm TV khi khách có nhu cầu thiết bị thực tế. Demo ban đầu có thể dùng giá do chủ tiệm cung cấp để tập trung kiểm chứng quy trình.

| Giai đoạn | Công việc chính | Đầu ra cần có | Cổng quyết định |
|---|---|---|---|
| Ngày 1–7 | Chọn một khu vực, lập 30 tiệm phù hợp, trao đổi 10 chủ tiệm; ghi cách họ sửa giá và trả lời khách | Bảng ghi nhu cầu, công cụ đang dùng, người quyết định, ngân sách từng trường hợp | Chọn vấn đề xuất hiện lặp lại, không chọn theo tính năng mình thích code |
| Ngày 8–14 | Dựng demo thương hiệu riêng từ UI hiện có, giá mẫu được ghi rõ; đưa 2 mức phạm vi/báo giá | 5–10 buổi demo đủ điều kiện, hợp đồng/phạm vi mẫu | Mục tiêu 2 đặt cọc; chưa có thì sửa đề nghị bán, chưa xây SaaS lớn |
| Ngày 15–30 | Hoàn thiện nhập/duyệt giá riêng, chính xác đơn vị, trạng thái mất dữ liệu; sửa vấn đề ảnh hưởng demo và chất lượng | 1–2 khách dùng thật, nghiệm thu, ghi số giờ triển khai/hỗ trợ | Có bằng chứng dùng sản phẩm và thanh toán, không chỉ đăng ký thử |
| Ngày 31–60 | Lặp lại bán hàng cho cùng phân khúc; chuẩn hóa template, quyền truy cập, sao lưu và theo dõi lỗi; thử gói ảnh bảng giá nếu được yêu cầu | Mục tiêu tổng cộng 3–5 khách trả tiền, quy trình onboarding lặp lại | Ít nhất 3 khách có cùng nhu cầu để quyết định phần đưa vào thuê bao |
| Ngày 61–90 | Đóng gói phần lặp lại thành hạng 2; thiết lập gia hạn và giới hạn hỗ trợ; thử một đối tác agency | Mục tiêu 5–10 khách đang trả tiền, báo cáo sử dụng/gia hạn và lãi sau công hỗ trợ | Tiếp tục nếu khách gia hạn, chi phí hỗ trợ kiểm soát được; nếu không, giữ mô hình dịch vụ có lãi |

Mục tiêu khách hàng trong bảng là giả thuyết vận hành. Một dự án chưa có mạng lưới có thể cần lâu hơn; không nên bù thiếu khách bằng cách mở thêm nhiều tính năng.

### Câu hỏi phỏng vấn có khả năng tìm ra tiền

1. “Lần gần nhất anh/chị đổi giá là lúc nào, đã phải sửa ở những đâu?”
2. “Ai sửa giá, ai duyệt; trước đây đã từng có hai nơi hiển thị khác nhau chưa?”
3. “Anh/chị đang dùng phần mềm gì, trả bao nhiêu; phần nào vẫn phải làm tay?”
4. “Khách thường hỏi lại điều gì trước khi đến cửa hàng?”
5. “Nếu làm đúng quy trình vừa demo với giá này, ai duyệt mua và khi nào có thể bắt đầu?”

Ghi lại ví dụ gần nhất và hành vi thật. Không hỏi chung “anh/chị có thích AI không?” rồi dùng câu trả lời làm bằng chứng mua hàng.

### Phân bổ thời gian cho bạn

Trong tháng đầu, dành khoảng **40% gặp/trao đổi với khách, 40% làm demo và bàn giao, 20% hỗ trợ và tổng kết**. Kỹ năng còn thiếu cần học trước là hỏi nhu cầu, giới hạn phạm vi, báo giá và thu tiền. Học thêm model AI hoặc làm thêm biểu đồ chỉ đáng ưu tiên khi giúp chốt một nhu cầu đã được xác nhận.

## 7. Tiền có thể đến từ đâu, và điểm hòa vốn thực dụng

Toàn bộ số dưới đây là **phép tính kịch bản**, không phải dự báo hay báo giá hạ tầng. Phải thay bằng hóa đơn thực tế và số giờ đã ghi nhận.

### Kịch bản dịch vụ để có dòng tiền ban đầu

- Hai dự án/tháng × 5 triệu đồng thiết lập = **10 triệu đồng doanh thu một lần** trong tháng có hai khách mới.
- Mười khách đang bảo trì × 399.000 đồng = **3,99 triệu đồng doanh thu định kỳ/tháng**.
- Tổng trong tháng đó = **13,99 triệu đồng**, trước chi phí và thuế. Phí thiết lập không được tính thành doanh thu định kỳ.
- Nếu không có khách mới, phần thiết lập bằng 0; đây là lý do nên xây dịch vụ lặp lại và theo dõi gia hạn.

Kiểm tra lợi nhuận một dự án mẫu: thu 5 triệu; 12 giờ triển khai × 200.000 đồng/giờ chi phí cơ hội = 2,4 triệu; giả định 400.000 đồng chi phí trực tiếp và 800.000 đồng công bán hàng phân bổ. Còn **1,4 triệu đồng trước thuế và chi phí chung**. Nếu việc triển khai tăng lên 24 giờ thì cùng báo giá có thể bị lỗ sau khi tính công. Vì vậy, template và giới hạn sửa quan trọng hơn số tính năng.

### Kịch bản thuê bao sau khi chuẩn hóa

| Khách trả phí đang hoạt động | Giá bình quân giả định/tháng | Doanh thu định kỳ/tháng |
|---:|---:|---:|
| 10 | 399.000 đồng | 3,99 triệu đồng |
| 30 | 399.000 đồng | 11,97 triệu đồng |
| 50 | 399.000 đồng | 19,95 triệu đồng |

Ví dụ hòa vốn: giả định chi phí cố định 1,5 triệu đồng/tháng; chi phí biến đổi hạ tầng/dữ liệu phân bổ 50.000 đồng/khách; hỗ trợ 0,5 giờ/khách × 200.000 đồng/giờ = 100.000 đồng. Phần đóng góp mỗi khách là `399.000 − 50.000 − 100.000 = 249.000 đồng`; cần **7 khách** để bù 1,5 triệu chi phí cố định theo giả định này.

Con số 7 chưa bù toàn bộ thời gian phát triển, công bán hàng, thuế, chi phí mua quyền dữ liệu hoặc khoản thu nhập cá nhân mong muốn. Nếu hỗ trợ tăng thành 2 giờ/khách/tháng, phần đóng góp theo cùng giả định thành âm; tăng số khách không sửa được vấn đề đó.

Với phần đóng góp 249.000 đồng, muốn thu hồi chi phí có một khách trong 3 tháng thì chi phí tìm khách tối đa khoảng **747.000 đồng/khách**, chưa tính khách hủy sớm. Nên bán trực tiếp và qua giới thiệu trước khi thử quảng cáo trả phí.

Ngân sách thử nghiệm 90 ngày có thể tự đặt trần **5–10 triệu đồng tiền mặt**, ngoài công của bạn, cho tên miền/demo, hạ tầng, đi gặp khách và khoản thử nhỏ. Đây là giới hạn chi tiêu đề xuất, không bảo đảm đủ mua dữ liệu thương mại hoặc thiết bị. Nếu cần các khoản này, lập ngân sách riêng và dùng đặt cọc để giảm vốn ứng trước.

## 8. Thứ tự nâng cấp kỹ thuật nếu chọn hướng khuyến nghị

| Mức ưu tiên | Việc cần làm | Khi nào cần |
|---|---|---|
| P0 | Sửa lỗi chữ, đơn vị và độ chính xác; ngăn phản hồi cũ ghi đè bộ lọc; phân biệt thời gian nguồn với thời gian tải | Trước demo dùng giá thật |
| P0 | Tách giá tham khảo thị trường khỏi giá tiệm nhập/duyệt; quy định hành vi khi mất mạng, nguồn lỗi hoặc giá quá cũ | Trước bàn giao bảng giá cho khách |
| P0 | Rà quyền sử dụng nguồn; làm rõ điều khoản, phạm vi hỗ trợ và trách nhiệm duyệt giá | Trước bán chức năng sử dụng dữ liệu bên thứ ba |
| P1 | Cơ sở dữ liệu cho cửa hàng, thành viên, bảng giá và phiên bản; quyền chủ tiệm/nhân viên; sao lưu/khôi phục | Khi có khách đầu tiên, trước phục vụ nhiều tiệm trên cùng hệ thống |
| P1 | Nhật ký xuất bản, theo dõi lỗi và thiết bị, đo số lần dùng; checklist onboarding | Trong 30–60 ngày |
| P1 | Thu phí bằng hợp đồng/chuyển khoản và quản lý ngày gia hạn rõ ràng; tự động hóa billing khi bắt đầu tốn công | Trong giai đoạn 3–10 khách |
| P2 | Thu thập giá theo lịch và lưu lịch sử bền vững, nguồn/đơn vị có phiên bản, kiểm tra chéo | Khi dữ liệu thị trường trở thành một phần dịch vụ có cam kết |
| P2 | Quota AI tập trung, giới hạn ngân sách, cô lập hội thoại theo tài khoản và đo chi phí từng yêu cầu | Trước khi bán tính năng AI cho khách |
| P3 | SEO nhiều trang, thêm nguồn, ứng dụng native, quản lý danh mục tài sản và tích hợp POS | Sau khi có nhu cầu trả tiền cụ thể |

Không cần mở rộng kiến trúc chỉ để đạt một danh sách công nghệ. Dịch vụ cho khách đầu tiên có thể dùng cùng codebase với cấu hình triển khai riêng; khi nhu cầu lặp lại rõ mới hợp nhất thành SaaS nhiều tenant. Nếu dùng chung cơ sở dữ liệu ngay từ đầu, phân quyền và cô lập tenant phải có ngay, không để sau.

## 9. Những hướng nên tránh ở giai đoạn này

- **Bán tín hiệu AI “mua/bán chắc thắng”:** repo chưa có kiểm định dự báo, mô phỏng giao dịch sát thực tế hay theo dõi kết quả. Một câu trả lời có nguồn không chứng minh khả năng sinh lời.
- **Sàn mua bán, giữ tiền hoặc vàng hộ khách:** cần năng lực pháp lý, đối tác và vận hành khác hẳn sản phẩm dữ liệu hiện tại; không phù hợp giả định khởi đầu một mình, ít vốn.
- **Website giá vàng sống chủ yếu bằng quảng cáo:** có nhiều lựa chọn miễn phí; chưa có traffic, khả năng SEO hoặc doanh thu quảng cáo thực tế để lập kế hoạch đáng tin. Có thể là kênh thu hút khách cho dịch vụ trước.
- **Bán lại API miễn phí mà không tăng giá trị:** dễ bị thay thế, đồng thời vẫn gánh lỗi dữ liệu và hỗ trợ. Chỉ mở khi có chất lượng, quyền dữ liệu và nhu cầu tích hợp cụ thể.
- **Viết toàn bộ POS ngành vàng từ đầu:** quy mô nghiệp vụ và trách nhiệm hỗ trợ vượt xa dashboard. Nếu có khách trả tiền, bắt đầu bằng một module hạng 7.
- **Mở rộng ngay sang bạc, ngoại tệ, chứng khoán và crypto:** hiện làm tăng số nguồn cần bảo trì mà chưa giải quyết việc tìm khách trả tiền đầu tiên.

## 10. Quyết định thực hiện đề xuất

Trong 30 ngày tới, tập trung vào **2 khách đặt cọc cho gói triển khai website/bảng giá riêng**. Giữ dashboard đa nguồn như tài sản demo và công cụ kiểm chứng nhu cầu. Sau 3–5 khách, chọn phần được dùng lặp lại để đóng gói thuê bao; bộ ảnh bảng giá và widget là sản phẩm bổ sung khi khách hoặc agency đề nghị.

Lợi thế có thể tích lũy lâu dài là **hiểu quy trình tiệm vàng, có quan hệ khách hàng, triển khai nhanh và giữ giá hiển thị đáng tin cậy**. Khả năng tự xây toàn bộ sản phẩm giúp bạn thử nhanh, nhưng bằng chứng quan trọng nhất vẫn là khách sử dụng, thanh toán và gia hạn.
