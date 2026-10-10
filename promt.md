Bạn là Brand Strategist, Creative Director và Brand Designer có kinh nghiệm thiết kế sản phẩm dữ liệu tài chính dành cho người dùng Việt Nam. Hãy tạo một bộ nhận diện thương hiệu có cá tính riêng và bộ asset nhất quán, có thể dùng cho website thực tế, dựa trên brief dưới đây.

Tôi cần bạn đề xuất tên thương hiệu, slogan có điểm nhấn, đặc trưng nhận diện, phong cách thị giác, logo, favicon và các asset liên quan. Hãy đưa ra lựa chọn có lập luận, tự chọn phương án tốt nhất rồi triển khai bộ asset theo phương án đó. Đừng dừng ở danh sách ý tưởng hoặc chỉ viết lại prompt cho tôi.

## 1. Ngữ cảnh sản phẩm đã xác định

- Dự án là website tiếng Việt theo dõi và tìm hiểu giá vàng Việt Nam. Tên đang hiển thị là **Kim Tuyến**, descriptor là **Giá vàng Việt Nam**. Tên thư mục dự án là `chart-gold`; đây không phải tên thương hiệu bắt buộc.
- Địa chỉ mặc định đang được cấu hình trong dự án là `https://vanghomnay.online`. Đây là ngữ cảnh hiện có, không phải bằng chứng về quyền sở hữu hay tình trạng hoạt động của tên miền. Có thể đề xuất thương hiệu mới mà vẫn dùng địa chỉ này; không mặc định phải đổi domain.
- Chức năng chính: bảng giá mua vào/bán ra theo thương hiệu và sản phẩm; biểu đồ lịch sử tùy mức độ dữ liệu từng nguồn; đối chiếu giá các sản phẩm tương đương; quy đổi đơn vị vàng; tính giá vốn bình quân, lãi/lỗ ước tính và giá thu mua hòa vốn; mô phỏng các kịch bản giá hoặc mua thêm; hướng dẫn sử dụng bằng tiếng Việt.
- Sản phẩm có khu vực Phân tích AI để hỏi đáp và giải thích dữ liệu, hỗ trợ tham khảo có nguồn. Khả năng truy cập, hạn mức và một số tiện ích cá nhân hóa phụ thuộc cấu hình. Không quảng bá AI là miễn phí vô hạn hoặc là khả năng dự báo chính xác.
- Website có phần ủng hộ tự nguyện. Lõi bảng giá, so sánh và tính toán được định hướng miễn phí. Không mặc định rằng gói trả phí, API thương mại, cảnh báo tự động, giao dịch vàng, ứng dụng native hoặc đồng bộ danh mục đa thiết bị đã được phát hành.
- Có dữ liệu hoặc cấu hình nguồn cho nhiều thương hiệu, ví dụ SJC, PNJ, DOJI, Bảo Tín Minh Châu, Phú Quý, VGJ. Phạm vi và độ sẵn sàng khác nhau theo nguồn; không khẳng định mọi thương hiệu đều có giá trực tiếp hay lịch sử đầy đủ. Các thương hiệu này chỉ là đối tượng dữ liệu, không phải đối tác bảo chứng cho website.
- Trải nghiệm chú trọng phân biệt giá cửa hàng bán cho người mua với giá cửa hàng thu mua lại; chênh lệch mua–bán; đúng loại sản phẩm; phí và điều kiện thu mua; nguồn dữ liệu và thời điểm cập nhật. Đây là những chất liệu quan trọng cho định vị thương hiệu.

**Đối tượng ưu tiên để thiết kế:** người Việt tích lũy vàng, người mua vàng cá nhân, người muốn hiểu giá và tính toán trước khi quyết định; có cả người ít rành công nghệ. Đây là giả định thiết kế dựa trên chức năng sản phẩm, không phải kết quả khảo sát người dùng. Ưu tiên trải nghiệm điện thoại, vẫn phù hợp bảng dữ liệu trên desktop.

**Giá trị muốn truyền đạt:** giúp người dùng đọc đúng giá, hiểu chênh lệch và có thêm cơ sở để tự cân nhắc. Cảm giác cần có là rõ ràng, điềm tĩnh, dễ tiếp cận, minh bạch và có chiều sâu. Tránh cách thể hiện như sàn đầu cơ, nhóm phím lệnh hoặc cửa hàng trang sức xa xỉ.

## 2. Hiện trạng nhận diện cần giải quyết

Bạn không có quyền truy cập repo và không cần yêu cầu tôi gửi repo. Những mô tả dưới đây là ngữ cảnh thiết kế được cung cấp, không phải ảnh mà bạn đã trực tiếp xem:

- Giao diện hiện tại dùng bố cục dashboard, nhiều thẻ dữ liệu, góc bo mềm và kính mờ tiết chế; có giao diện sáng, tối và theo hệ thống.
- Màu đang dùng: nền sáng `#EDF0F5`, nền tối `#11141B`, điểm nhấn xanh `#007AFF`, chữ tối `#171B25`. Font hiện tại là Geist và Geist Mono; icon chức năng dùng Lucide.
- Header đang có một biểu tượng kiến trúc/ngân hàng phổ thông trong ô xanh bo góc, kèm “Kim Tuyến” và “Giá vàng Việt Nam”. Chưa có biểu trưng độc quyền rõ rệt.
- Favicon hiện tại là các khối hình học xanh. Ảnh chia sẻ hiện tại lại dùng nền ngà có texture, chữ serif vàng lớn, đồ thị xanh rêu với đường giá vàng hướng lên; có slogan “Nhìn giá vàng, thấy cả xu hướng.” và dòng “Biểu đồ giá vàng SJC”.
- Vì vậy, header, favicon và ảnh chia sẻ chưa kể cùng một câu chuyện. Dòng chỉ nhắc SJC cũng chưa phản ánh hết phạm vi nhiều thương hiệu hiện tại.
- Hai điểm tích hợp asset hiện được tham chiếu là `/favicon.svg` và `/og.png`; ảnh OG được khai báo ở kích thước **1200 × 630 px**. Chỉ ghi nhận để đặt tên file bàn giao phù hợp, không chỉnh sửa code hay metadata.

Hãy coi hiện trạng là điểm xuất phát, không phải ràng buộc giữ nguyên màu xanh hoặc phong cách vàng–xanh rêu. Bạn được đề xuất cải tiến hoặc đổi tên, nhưng cần giải thích lựa chọn và tạo một hệ thống thống nhất, phù hợp cả nền sáng lẫn nền tối. Ưu tiên khả năng ứng dụng vào dashboard hiện có, không biến bài toán này thành thiết kế lại toàn bộ website.

## 3. Yêu cầu về tên thương hiệu

Đề xuất **8 phương án**, trong đó có **1 phương án giữ “Kim Tuyến” và nâng cấp định vị**, cùng 7 tên mới. Có thể khám phá tên thuần Việt, tên gợi liên tưởng và tên sáng tạo ngắn; không cần phương án nào cũng chứa chữ “Vàng”, “Gold” hay “AI”.

Với mỗi tên, trình bày trong bảng: tên có dấu; cách viết không dấu; cách đọc nếu cần; ý nghĩa; liên hệ với giá trị sản phẩm; ý tưởng biểu trưng có thể phát triển; điểm yếu hoặc khả năng gây hiểu nhầm. Ưu tiên tên ngắn, dễ đọc thành tiếng, dễ nhớ, dùng được trên header điện thoại và không bị giới hạn vào riêng một thương hiệu vàng.

Đánh giá thẳng thắn tên “Kim Tuyến”: điểm mạnh về chất liệu ngôn ngữ và hình ảnh, cũng như nguy cơ bị hiểu là tên cá nhân, cửa hàng nữ trang hoặc kim tuyến trang trí. Không giữ tên chỉ vì đã có; cũng không đổi tên chỉ để tạo cảm giác mới.

Chấm điểm theo: khác biệt 25%, dễ đọc và nhớ với người Việt 25%, phù hợp định vị 25%, tiềm năng tạo logo/favicon 15%, khả năng mở rộng 10%. Đây là đánh giá thiết kế chủ quan, không phải kiểm chứng thị trường. Chọn **3 tên vào vòng cuối**, sau đó chốt **1 tên khuyến nghị** với lý do cụ thể.

Không khẳng định tên, domain hoặc tài khoản mạng xã hội còn trống hay đã được bảo hộ nếu chưa kiểm tra. Nếu có công cụ duyệt web, kiểm tra sơ bộ các tên vào vòng cuối và dẫn nguồn cho điều thực sự xác minh được; nếu không, ghi “chưa kiểm tra”. Kết quả tìm kiếm sơ bộ không thay thế việc xác minh quyền sử dụng thương hiệu. Không cần mua hoặc đăng ký bất cứ thứ gì.

## 4. Slogan và cách nhấn mạnh

Với tên đã chọn, đề xuất **6 slogan tiếng Việt**, ưu tiên 4–9 từ, tự nhiên khi đọc, có nhịp và nói rõ một lợi ích riêng. Có thể dùng slogan hiện tại làm mốc so sánh. Tránh sáo ngữ như “Nâng tầm giá trị”, “Kiến tạo tương lai”, “Đầu tư thông minh” nếu không bổ sung được ý nghĩa cụ thể.

Chọn **1 slogan chủ đạo**, **1 biến thể ngắn dùng khi diện tích hạn chế**, và **1 descriptor giải thích sản phẩm**. Phân biệt vai trò: tên để nhớ thương hiệu; slogan để truyền đạt lời hứa; descriptor để người mới biết sản phẩm làm gì.

Với slogan chủ đạo, bắt buộc cung cấp:

- Nội dung chính xác có đầy đủ dấu tiếng Việt; tô đậm cụm cần nhấn trong phần trình bày.
- Cách xuống dòng cho ảnh chia sẻ và điện thoại; cụm nào dùng màu nhấn, cụm nào dùng màu chữ chính; tương quan cỡ chữ và độ đậm.
- Hai bản headline ứng dụng cho ảnh OG và phần giới thiệu, cùng một câu mô tả ngắn khoảng 25–40 từ và ba CTA phù hợp chức năng hiện có.
- Quy tắc không đưa slogan vào favicon hoặc ép slogan vào logo khi quá nhỏ.

Không dùng lời hứa thắng thị trường, chắc chắn sinh lời, mua/bán đúng đỉnh đáy, dữ liệu chính xác tuyệt đối hoặc cập nhật từng giây. Slogan cần có sức nặng từ sự rõ ràng và hữu ích, không từ kích thích FOMO.

## 5. Characteristic: dấu hiệu khiến người ta nhận ra thương hiệu

Định nghĩa **một ý tưởng trung tâm** và **một thủ pháp hình học chủ đạo** có thể xuất hiện xuyên suốt logo, favicon, pattern, ảnh OG và minh họa nhỏ. Đừng chỉ mô tả bằng các tính từ “hiện đại, tối giản, cao cấp”. Hãy mô tả hình dạng, tỷ lệ, khoảng trống, nhịp điệu và cách lặp lại cụ thể.

Có thể khai thác chất liệu như đường đo, điểm đối chiếu, hai mức giá, khoảng chênh lệch, mốc hòa vốn, nhịp tích lũy, hoặc nghĩa của tên được chọn. Đây là gợi ý khám phá, không phải yêu cầu ghép tất cả thành một biểu tượng. Trừu tượng hóa thành một dấu hiệu đơn giản và có lý do tồn tại.

Trả lời rõ: “Nếu bỏ tên thương hiệu đi, chi tiết nào còn giúp nhận ra đây là sản phẩm này?”. Nêu **3 quy tắc thị giác phải giữ** và **3 cách dùng làm mất cá tính cần tránh**.

Tránh logo có sẵn kiểu thỏi vàng + mũi tên đi lên, đồng xu có ký hiệu tiền, mái ngân hàng, vương miện, kim cương, đầu bò/gấu, robot AI hoặc chùm sparkle. Không sao chép logo của thương hiệu vàng, ngân hàng hay nền tảng biểu đồ khác. Không dùng icon Lucide đang có làm biểu trưng thương hiệu cuối cùng.

Nếu đề xuất mascot, hãy giải thích nhu cầu sử dụng và chỉ coi đó là phần mở rộng tùy chọn; bộ nhận diện phải hoạt động hoàn chỉnh khi không có mascot.

## 6. Art direction và style guide

Đưa ra **3 hướng thị giác thực sự khác nhau** cho tên đã chốt. Với mỗi hướng, trình bày ngắn: ý tưởng; cảm xúc; hình học biểu trưng; bảng màu sơ bộ; kiểu chữ; đặc trưng dễ nhận ra; ưu/nhược khi dùng ở favicon và dashboard. Chọn **1 hướng duy nhất** để triển khai toàn bộ asset. Không trộn ba hướng thành một bộ chắp vá.

Với hướng được chọn, cung cấp style guide đủ cụ thể:

- **Tính cách thương hiệu:** 4–5 thuộc tính, mỗi thuộc tính gắn với biểu hiện thiết kế và cách viết thực tế.
- **Màu:** bảng HEX theo vai trò cho cả sáng và tối: brand primary, brand accent, background, surface, text primary, text secondary, border. Thêm màu ngữ nghĩa cho tăng, giảm, cảnh báo và thiếu dữ liệu. Nêu tỷ lệ sử dụng tham khảo. Màu vàng thương hiệu nếu có phải được phân biệt với trạng thái cảnh báo.
- **Khả năng đọc:** kiểm tra tương phản chữ thường tối thiểu 4.5:1; chữ lớn và các dấu hiệu giao diện quan trọng tối thiểu 3:1. Ghi rõ cặp màu đã tính, tỷ lệ và trạng thái; nếu chưa đo thì ghi “chưa kiểm tra”, không tự nhận đạt. Không dùng màu làm tín hiệu duy nhất cho tăng/giảm hoặc lỗi dữ liệu.
- **Typography:** đề xuất font cho tên thương hiệu, tiêu đề, nội dung và số liệu; có hỗ trợ tiếng Việt và chữ số dễ phân biệt. Cân nhắc giữ Geist/Geist Mono cho phần giao diện để thuận tiện áp dụng. Nếu đổi font, nêu lý do, fallback và thông tin giấy phép/nguồn nếu xác minh được; không tự nhận miễn phí thương mại khi chưa kiểm tra.
- **Hình khối:** hệ lưới dựng mark, tỷ lệ nét, độ bo, khoảng trống âm, clear space, kích thước tối thiểu; cách dùng bản màu, đơn sắc, đảo trắng và bản nhỏ.
- **Chất liệu:** bản logo gốc phải phẳng và rõ. Kính mờ, gradient hoặc texture chỉ dùng có kiểm soát ở bề mặt phụ, không phải điều kiện để nhận ra logo. Không đặt texture sau chữ nhỏ hoặc bảng giá.
- **Icon/minh họa:** thống nhất nét và hình học với biểu trưng. Icon chức năng có thể tiếp tục dùng Lucide; asset mới tập trung ở nhận diện và minh họa thương hiệu, không yêu cầu thay toàn bộ icon giao diện.
- **Motion:** mô tả bằng lời một chuyển động thương hiệu nhẹ nếu hữu ích, kèm bản tĩnh và nguyên tắc giảm chuyển động. Không viết animation code.
- **Giọng nói:** dùng tiếng Việt rõ, gần gũi, kiên nhẫn; đưa 3 cặp câu trước/sau minh họa cách giải thích giá, dữ liệu thiếu hoặc lãi/lỗ ước tính. Không gọi AI là chuyên gia đảm bảo quyết định đúng.

## 7. Bộ asset phải bàn giao

Tạo asset theo cùng tên, slogan, hình học và bảng màu đã chọn. Các bản nhỏ phải là biến thể của cùng biểu trưng, không vẽ lại tùy hứng thành dấu hiệu khác. Những nội dung dưới đây là yêu cầu cho bộ file thiết kế trong cuộc trò chuyện này, không phải yêu cầu sửa source code.

| Nhóm | Đầu ra cần có | Quy cách chính |
| --- | --- | --- |
| Brand board | Một trang tổng quan tên, slogan, logo, màu, typography và motif | PNG khoảng 2000 × 1400 px; chỉ để tổng quan, không thay cho asset riêng |
| Logo chính | Biểu trưng + tên nằm ngang; bản dùng trên nền sáng, nền tối | SVG vector thật và PNG nền trong suốt, chiều rộng khoảng 1600 px; tỷ lệ tự nhiên theo thiết kế |
| Logo phụ | Biểu trưng + tên xếp dọc; wordmark đứng riêng; lockup có slogan | SVG và PNG; có hướng dẫn ngưỡng kích thước để bỏ slogan |
| Brand mark | Biểu trưng đứng riêng; bản màu, đen và trắng | SVG và PNG 1024 × 1024 px nền trong suốt, căn giữa quang học |
| Favicon | `favicon.svg`, `favicon.ico`, `favicon-16x16.png`, `favicon-32x32.png`, `favicon-48x48.png` | Dùng bản mark tối giản; ICO chứa các cỡ 16/32/48; rõ trên nền tab sáng và tối, không có slogan |
| App/touch icon | `apple-touch-icon.png`, `icon-192.png`, `icon-512.png`, `icon-maskable-512.png` | Lần lượt 180, 192, 512, 512 px vuông; bản maskable có nền phủ kín, chi tiết cốt lõi trong vùng an toàn trung tâm |
| Ảnh chia sẻ mặc định | `og.png` | Đúng 1200 × 630 px; có tên, slogan được nhấn rõ, descriptor, motif; khoảng cách an toàn tối thiểu 60 px ở biên; đọc được khi thu nhỏ |
| Ảnh truyền thông | Avatar; thẻ giới thiệu thương hiệu; thẻ giới thiệu tính năng so sánh hoặc hòa vốn | Avatar PNG 1024 × 1024 px chịu được crop tròn; hai thẻ PNG 1080 × 1080 px |
| Motif/pattern | Một pattern lặp và một dải trang trí dùng được trên banner | SVG khi phù hợp và PNG/WebP; có bản nhẹ cho nền sáng/tối; không chứa chữ |
| Minh họa sản phẩm | So sánh giá; tính hòa vốn; giải thích dữ liệu bằng AI; chưa có dữ liệu | 4 hình riêng, khoảng 640 × 480 px, nền trong suốt; cùng ngôn ngữ hình khối, không nhúng chữ vào hình |
| Tài liệu bàn giao | `brand-guide.md`, `asset-manifest.csv`, `generation-prompts.md` | Hướng dẫn dùng, bảng file thực tế và prompt để tái tạo/tiếp tục các asset |

**Chi tiết xuất file:**

- Logo và favicon phải có bản vector thật nếu cung cấp SVG; không bọc PNG trong thẻ SVG rồi gọi đó là vector. Không tự nhận ảnh do công cụ tạo ảnh sinh ra là vector.
- SVG tự chứa hình học, có `viewBox`, không có script, link tài nguyên ngoài hoặc phụ thuộc font chưa đóng gói. Wordmark dạng outline nếu công cụ hỗ trợ; nếu chỉ có bản chữ sống hoặc raster, ghi rõ giới hạn và font cần có.
- PNG “nền trong suốt” phải có alpha thật, không phải ảnh nền ô caro. Không thêm mockup giấy, tường, áo, bóng đổ hoặc khung trình bày vào file logo gốc.
- Xuất từng asset thành file riêng. Brand board có thể ghép nhiều phần để trình bày; không dùng một collage nhiều logo làm đầu ra thay thế cho bộ file.
- Với icon maskable, giải thích vùng an toàn và kiểm tra các kiểu crop phổ biến; với favicon, có preview ở kích thước thật 16/32/48 px trên nền sáng và tối.
- Không đưa số giá vàng hoặc biểu đồ có thể bị hiểu là dữ liệu thị trường thật vào asset tĩnh nếu chưa có nguồn. Nếu cần mẫu dữ liệu để minh họa, ghi rõ “Dữ liệu minh họa”; đường đồ họa trang trí không cần giả trục, mốc thời gian hoặc lời hứa tăng giá.
- Không thêm logo SJC, PNJ, DOJI hay dấu “đối tác/chính thức” vào bộ nhận diện. Không tạo watermark giả hoặc huy hiệu chứng nhận.
- Text trong asset phải đúng tên đã chốt và đúng dấu tiếng Việt. Nếu công cụ tạo ảnh không dựng chữ ổn định, tạo artwork không chữ rồi đặt typography bằng công cụ bố cục phù hợp nếu có; không giao chữ sai dấu như bản hoàn thiện.
- Ưu tiên vector gọn và raster tối ưu cho web. Ghi kích thước, định dạng, dung lượng thực tế nếu xuất được; không bịa con số.

## 8. Cách thực hiện và giữ tính nhất quán

1. Tóm tắt định vị và vấn đề nhận diện trong tối đa 8 dòng. Chỉ hỏi lại nếu thiếu thông tin thật sự ngăn việc thiết kế; còn lại tự ghi giả định và tiếp tục.
2. Đề xuất tên, chốt tên; đề xuất slogan, chốt slogan; trình bày 3 art direction và chọn hướng triển khai. Quyết định ở đây là khuyến nghị thiết kế cho bộ asset, chưa phải việc đổi tên trên website đang chạy.
3. Chốt một **brand specification** gồm: tên chính xác, slogan chính xác, descriptor, hình học mark, màu HEX, typography và những yếu tố không được thay đổi. Dùng specification này làm nguồn thống nhất cho mọi asset tiếp theo.
4. Dựng logo master và bản favicon đơn giản trước; sau đó tái sử dụng chúng làm tham chiếu để tạo brand board, ảnh OG, pattern và các minh họa. Không để mỗi lượt sinh ảnh tự sáng tác lại logo.
5. Nếu công cụ tạo ảnh khả dụng trong phiên, hãy thực sự tạo hình và hiển thị kết quả. Nếu có công cụ xuất file, tạo từng file riêng và gói ZIP để tải xuống. Không chỉ đưa mô tả rồi nói tôi tự làm tiếp.
6. Nếu một định dạng hoặc thao tác không khả dụng, nói rõ giới hạn, giao những file thực sự tạo được và liệt kê phần còn thiếu cùng prompt/quy cách để hoàn thành. Không giả lập đường dẫn tải xuống, không khẳng định đã có ZIP/SVG/ICO khi chưa tạo được. Nếu bị giới hạn lượt tạo ảnh, ưu tiên logo master → favicon → OG → brand board, rồi ghi rõ các asset còn lại; không gọi bộ asset còn thiếu là hoàn tất.
7. Kiểm tra kết quả trước khi bàn giao: cùng biểu trưng và palette; dấu tiếng Việt; khả năng đọc slogan; favicon ở cỡ nhỏ; nền alpha; crop icon; kích thước OG; loại file thực tế; không có khẳng định sai về tính năng hoặc giá vàng. Phân biệt kiểm tra đã thực hiện với kiểm tra còn cần làm.

## 9. Cấu trúc trả lời và đóng gói

Trả lời bằng tiếng Việt, dùng bảng khi so sánh tên, màu hoặc file. Giải thích cô đọng và cụ thể, dành trọng tâm cho lựa chọn thiết kế cùng kết quả hình ảnh.

Theo thứ tự:

1. Định vị và đề xuất tên; kết luận tên khuyến nghị.
2. Slogan chủ đạo, cụm được nhấn mạnh và cách ứng dụng.
3. Characteristic và 3 hướng thiết kế; kết luận hướng được chọn.
4. Brand specification và style guide.
5. Preview hình ảnh và các file asset đã tạo.
6. Link tải ZIP nếu đã tạo được; bảng bàn giao; danh sách kiểm tra đạt/chưa kiểm tra/cần sửa.

Đặt bộ bàn giao trong thư mục `brand-kit/`, chia thành `logos/`, `icons/`, `social/`, `patterns/`, `illustrations/` và `guidelines/`. Dùng tên file không dấu, chữ thường, ngăn cách bằng dấu gạch ngang; phân biệt `on-light`, `on-dark`, `black`, `white` rõ ràng. Giữ đúng basename `favicon.svg` và `og.png` để thuận tiện tích hợp sau này.

Trong `asset-manifest.csv`, ghi: tên file, mục đích, định dạng, kích thước hoặc viewBox, nền, biến thể theme, trạng thái hoàn thiện và ghi chú. Chỉ đánh dấu hoàn thiện cho file đã thực sự tạo và kiểm tra. Trong `generation-prompts.md`, ghi prompt tiếng Anh cho công cụ tạo ảnh nếu hữu ích, nhưng tên thương hiệu và slogan phải giữ nguyên tiếng Việt; mỗi prompt phải dùng chung brand specification và nêu yếu tố cần tránh.

**Giới hạn phạm vi:** chỉ tạo nhận diện, nội dung thương hiệu và file asset trong cuộc trò chuyện này. Không viết lại website; không sinh patch, component React, CSS triển khai hoặc cấu hình Next.js; không sửa bất kỳ dòng code dự án nào; không triển khai website hay tự đăng nội dung ra ngoài. Việc tích hợp bộ asset sẽ là bước riêng sau đó.

Hãy bắt đầu từ brief này và đi đến kết quả có thể xem, so sánh và tải về trong khả năng công cụ hiện có, với một thương hiệu đủ riêng để nhận ra ngay cả khi bỏ tên đi.
