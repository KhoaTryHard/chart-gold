# Sửa hồ sơ nguồn và nghiệm thu — 09–10/10/2026

**Chưa đạt nghiệm thu 8/10.** Đã chạy đủ 10 yêu cầu mới: **3/10 gói duyệt hoàn chỉnh (30%)**, **6/10 vượt kiểm chứng nội dung (60%)**, **0 bài đăng công khai**. **0/10 đạt mà không cần sửa định dạng/nội dung; 3/10 đạt sau sửa có giới hạn.** Trong ba gói này có **1 gói không phải sửa bản thảo** nhưng đã có lượt sửa hợp đồng nguồn trước đó. Ba lượt có nội dung đạt còn lại chờ ảnh không được tính thành công.

Ba gói đạt: `01637C1EBF`, `8838BF654D`, `C4F8FD1BEC`. Gói `01637C1EBF` có sự kiện Mỹ–Iran và giá dầu được hai nguồn xác nhận, cùng liên hệ dầu–USD–lợi suất với vàng có quy thuộc Kitco; đây là bài liên quan địa chính trị/năng lượng và vàng. Yêu cầu ưu tiên địa chính trị số 9 chuyển sang bài kiến thức danh mục, nên không tính đó là bài địa chính trị.

Đợt 10 yêu cầu diễn ra tối 09/10 theo giờ Việt Nam. Có vá lỗi trong quá trình thử; đây là tỷ lệ toàn đợt, không phải phép đo 10 yêu cầu cùng chạy trên bản cuối. Giữ nguyên mọi lượt thất bại trong mẫu. Lượt 2 có một lần phục hồi cùng run khi nạp bản sửa, không tạo yêu cầu thay thế.

## Thay đổi đã triển khai

- Một hợp đồng nguồn dùng chung cho schema, ví dụ prompt và validator; chọn receipt_id, chương trình gắn URL/ngày. Receipt ổn định theo URL chuẩn hóa và hash toàn văn.
- Có span_id cho từng đoạn toàn văn, lấy nguyên văn bằng chương trình; không tái tạo công thức hoặc ghép câu. Quote tự viết vẫn phải khớp toàn văn; chỉ bỏ ký tự trình bày vô hình và chuẩn hóa khoảng trắng/NFC, không bỏ khác biệt chữ, số hoặc dấu câu.
- Thiếu/sai/trùng mã trả lỗi có cấu trúc; tối đa một lần sửa định dạng trên corpus đã đọc. Lưu từng đầu vào/đầu ra và ánh xạ riêng. Lỗi worker không được dùng làm kết quả cache khi tiếp tục.
- Checkpoint phiên bản 2 giữ riêng ngân sách sửa cấu trúc và nội dung. Dữ liệu cũ chuyển đổi thận trọng; phục hồi tự động không cấp thêm lượt sửa.
- Thu hẹp source_ids theo xác nhận của verifier, kể cả khi verifier trả PASS; tính lại nguồn độc lập và kiểm chứng lại sau sửa. Có bổ sung nguồn khi còn phiên nghiên cứu.
- Verifier nhận bản xem trước caption, bình luận nguồn và mục nguồn website. Mã C/S nội bộ bị chặn trong phần hiển thị; nhận định vẫn cần quy thuộc. PASS gắn hash của đúng phiên bản.
- Tách event/background và core_event. Sự kiện cốt lõi cần hai nguồn event độc lập trong 24 giờ; chi tiết phụ phải có nguồn thực sự hỗ trợ. Nguồn nền trong 10 năm chỉ phục vụ cơ chế/nhận định. Không cho phép chiến sự thuần túy hoặc suy diễn chiến tranh luôn làm vàng tăng.
- Ngày có provenance: extractor, datePublished, dateModified, nhãn Published/Updated, timezone và độ chính xác. Ngày chỉ có ngày không được đổi thành giờ UTC; ngày Published rõ trong toàn văn có thể dùng khi extractor thiếu.
- Hết ngân sách thu thập được phân biệt với lỗi dịch vụ model; tránh tiêu thời gian vào phản hồi không gọi công cụ. Gợi ý kiến thức không thay nhóm địa chính trị bằng góc cố định ngoài nhóm.
- Sửa yêu cầu bố cục ảnh để chủ thể nằm trong vùng trung tâm, có khoảng trống cả bốn cạnh. Giữ kiểm tra ảnh và tối đa một lần tạo lại. Hai lượt cuối có framing guard được ghi hash trong metadata và ảnh đạt kiểm tra.

## Kết quả 10 yêu cầu

| # | Nhóm ưu tiên | Run | Gói duyệt | Kết quả |
|---|---|---|---|---|
| 1 | Địa chính trị–năng lượng–thương mại | `5584e3f5` | — | Bộ lọc cũ đòi hai nguồn cho cả chi tiết phụ; đã sửa core_event trong đợt. |
| 2 | Vàng quốc tế | `b62c6665` | 01637C1EBF | Đạt: Vàng giao ngay phục hồi khi USD, lợi suất và dầu hạ nhiệt |
| 3 | Vĩ mô | `f1341335` | — | Ký tự trình bày vô hình trong Reuters gây lệch quote; đã chuẩn hóa và bổ sung span_id. |
| 4 | Kiến thức | `d23e31f9` | — | Model tái tạo câu/công thức thay vì trích nguyên văn; đã chuyển sang chọn đoạn span_id. |
| 5 | Địa chính trị–năng lượng–thương mại | `961be33f` | — | Nội dung đạt; ảnh đầu không đạt và lượt tạo lại gặp xAI provider_error. |
| 6 | Vàng Việt Nam | `aac01910` | — | 180 giây kết thúc với một nguồn; đã sửa phân loại lỗi và dừng vòng phản hồi không gọi công cụ. |
| 7 | Cung cầu–ETF–ngân hàng trung ương | `df7a981c` | — | Nội dung đạt; cả hai ảnh cắt mất khay ở mép khung. |
| 8 | Vĩ mô | `23dfaa96` | — | Nội dung đạt; ảnh vẫn không đạt sau một lần tạo lại. |
| 9 | Địa chính trị–năng lượng–thương mại | `8dd601df` | 8838BF654D | Đạt: Vàng trong danh mục: vai trò đa dạng hóa và những giới hạn cần biết |
| 10 | Kiến thức | `de7017c5` | C4F8FD1BEC | Đạt: Thanh khoản vàng gồm nhiều lớp giao dịch, không chỉ là khả năng bán nhanh |

## Lỗi còn cần xử lý để đạt 8/10

1. Ảnh là nút thắt lớn: ba lượt có nội dung đạt nhưng chưa có gói duyệt. Framing guard có hai kết quả đạt ở cuối đợt, chưa đủ để chứng minh tỷ lệ ổn định. Lỗi xAI provider_error chưa có HTTP/chi tiết đủ để kết luận nguyên nhân hoặc chuyển nhà cung cấp một cách có căn cứ.
2. Thu thập vẫn thường chuyển sang kiến thức khi thiếu hai nguồn sự kiện trong 24 giờ; nhóm địa chính trị chưa giữ được đều. Cần cải thiện chọn ứng viên theo bằng chứng của nhóm, giảm đọc trùng/opinion và giữ lý do đổi nhóm rõ ràng.
3. Chọn span_id đã loại việc model chép lại quote ở những lượt cuối; vẫn phải kiểm chứng ngữ nghĩa và phạm vi tiêu đề. Chưa được kết luận đạt mục tiêu bằng kiểm thử mô phỏng hoặc loại bỏ các thất bại trước khi vá.

## Kiểm thử và vận hành

- Toàn bộ bot: **568 kiểm thử, 564 đạt, 4 bỏ qua, 0 lỗi** (lượt cuối 73,98 giây). Kết quả và log: `outputs/editorial-yield-20261009/unit-results.json`, `unit-results.txt`.
- 22/22 kiểm thử website về Hermes v3, review và xác thực tích hợp đạt. API Hermes v2/v3 giữ tương thích; thay đổi nhiệm vụ nằm trong bot.
- Kiểm tra production bằng signed rejection probes không tạo draft: bốn miền hãng tin được nhận diện, miền giả mạo bị chặn, digest không hợp lệ bị từ chối. `/`, `/nhip-vang`, `/bien-tap` trả HTTP 200.
- Chỉ gateway `quan-tri-fanpage` được nạp lại. Các lượt cũ trước đợt nghiệm thu không được tự chạy lại. Các lượt nghiệm thu thất bại vẫn giữ checkpoint.
- Phát hành công khai tiếp tục cần hồ sơ pháp lý đã xác nhận, nguồn còn hạn và chủ trang duyệt đúng phiên bản. Không có thao tác phê duyệt hoặc đăng công khai trong đợt này.

## Bằng chứng

- Backup trước sửa: `C:/Users/LENOVO/kim-tuyen-ai/backups/editorial-yield-20261009-223133`.
- Kết quả từng yêu cầu: `C:/Users/LENOVO/kim-tuyen-ai/outputs/editorial-yield-20261009/live-acceptance.json`.
- Đối chiếu hash, kiểm chứng, ảnh và gói duyệt: `C:/Users/LENOVO/kim-tuyen-ai/outputs/editorial-yield-20261009/acceptance-audit.json`.
- Diff và hash phiên bản bot: `C:/Users/LENOVO/kim-tuyen-ai/outputs/editorial-yield-20261009/implementation.diff`, `C:/Users/LENOVO/kim-tuyen-ai/outputs/editorial-yield-20261009/deployed-bot-manifest.json`.
- Mỗi lần tổng hợp lưu riêng trong `data/research-evidence/<run>/synthesis-attempts/`.
