# Mở rộng nguồn săn tin — 09/10/2026

## Phiên bản và nguồn

Bot ở `C:/Users/LENOVO/kim-tuyen-ai`. Bản sao mã, prompts, cấu hình và SQLite nhất quán nằm ở `backups/source-expansion-20261009-151030` của bot. Chính sách mới có phiên bản `sources-2026-10-09-v1`.

Danh sách nguồn thêm Reuters (`reuters.com`), Bloomberg (`bloomberg.com`), AP (`apnews.com`) và Business Insider (`businessinsider.com`, gồm `www` và `markets`). Bot và validator website nhận cùng các miền, chỉ HTTPS công khai không thông tin đăng nhập hoặc port tùy ý. Miền gần giống không được nhận.

Composio vẫn là công cụ tìm/đọc. Mỗi phiên dùng tối đa 4 truy vấn, 4 lượt đọc, 8 URL trong 180 giây; chương trình giữ tối đa hai phiên nghiên cứu mỗi đợt. GSC/GA4 chỉ cung cấp tín hiệu tổng hợp chọn đề tài. Tin vẫn phải có hai nhà xuất bản gốc độc lập, bằng chứng toàn văn, ngày hợp lệ, news trong 24 giờ và evergreen trong 10 năm.

Receipt ghi nguồn gốc từ byline và host; bí danh Reuters/Bloomberg/AP/BI được chuẩn hóa. Reuters trên Kitco và Reuters trực tiếp không tính hai nguồn. BI và Markets Insider không tính hai nguồn nếu cùng BI biên soạn. Mô hình kiểm chứng phải đối chiếu nguồn gốc với toàn văn, không suy ra độc lập chỉ từ hai tên miền. Nguồn tài trợ/thông cáo, bản trả phí/challenge/preview và miền đích ngoài danh sách không làm bằng chứng toàn văn. Khi Composio không trả miền đích, receipt không được tuyên bố đã xác minh redirect; URL phản hồi không khớp URL yêu cầu không được gắn nhầm vào receipt.

## Đa dạng và phục hồi

Năm nhóm đề tài: vàng Việt Nam, vàng quốc tế, vĩ mô, cung cầu/ETF/ngân hàng trung ương, kiến thức. Lịch sử bản nháp/chờ duyệt/công khai trong bảy ngày định hướng ưu tiên nhóm ít dùng. Chủ đề người dùng khóa được giữ nguyên.

Đề tài/bộ nguồn thiếu bằng chứng có bộ nhớ 24 giờ; có nguồn thay thế thì có thể đánh giá lại. Lỗi URL vận hành có thời gian chờ 5 phút; không loại cả nhà xuất bản. Gợi ý kiến thức tránh chủ đề vừa bị từ chối, gồm dữ liệu cũ về 24K/18K. Giới hạn lựa chọn dự phòng được mở thêm các góc liên quan vàng.

URL bị kiểm chứng loại vì thiếu ngày/đọc lỗi/mâu thuẫn thời điểm được nhớ trong 24 giờ; chỉ thay URL đó, vẫn cho phép bài khác từ cùng nhà xuất bản. Nguồn quá 24 giờ của tin mới vẫn có thể hỗ trợ bài kiến thức khác trong giới hạn 10 năm; không cấm toàn bộ URL vì một claim không được chứng minh.

Nguồn toàn văn quá 15 phút không được đưa vào tổng hợp; cần đọc lại hoặc giữ checkpoint. Lỗi worker/Composio được lưu với nguyên nhân được che credentials. Checkpoint và báo cáo lưu tổ hợp đã đọc, nhóm đề tài, nguồn gốc, lời gọi/provider, thời gian và nguyên nhân chặn.

## Kiểm tra nội dung và điều kiện phát hành

Kết quả kiểm tra mới nằm trong `check.compliance`: phiên bản, status, findings/warnings, hash nội dung và hồ sơ nguồn, thời điểm. Findings xác định kênh/trường/lý do cần sửa. Thiếu kết quả có cấu trúc, dữ kiện/nguồn không đủ, sao chép, tư vấn mua bán cá nhân, cam kết lợi nhuận, dữ liệu riêng tư và tiêu đề gây hiểu nhầm đều chặn bước duyệt. Kiểm chứng độc lập phải đối chiếu caption, toàn bộ website/SEO và ảnh minh họa với chứng cứ; hash giữ ràng buộc bản thảo. coverAlt do visual review và illustration binding quản lý riêng khi thay bằng mô tả ảnh đã tạo.

Telegram hiển thị nhóm đề tài, các nguồn gốc, kết quả kiểm tra và nhãn duyệt nội bộ. Gói Hermes v2/v3 và digest không đổi, metadata kiểm tra giữ trong bot. Các gói cũ không được tự khởi động lại.

`config.json.editorial_release` hiện là `pending_legal_review`. Nút đăng không được hiển thị cho gói mới chưa có điều kiện phát hành; callback duyệt và cả worker đăng cũng kiểm tra gate trước write. Khi đã có xác nhận pháp lý, gate vẫn kiểm tra lại tuổi nguồn trước duyệt/đăng, không cho tin quá 24 giờ đi qua. Chỉ thiết lập `status=verified` cùng `verified_by` và `evidence_reference` sau khi người chịu trách nhiệm xác nhận loại hình website, quyền sử dụng nguồn và nghĩa vụ giấy phép. Không dùng một lời PASS của AI để tự điền các trường này. Thay đổi nội dung phải kiểm chứng lại; Telegram vẫn yêu cầu chủ trang duyệt đúng bản.

Các căn cứ được kiểm tra khi lập kế hoạch:

- [Nghị định 147/2024/NĐ-CP](https://chinhphu.vn/?classid=1&docid=211654&orggroupid=2&pageid=27160), đối chiếu các sửa đổi hiện hành và loại hình website trước khi kết luận nghĩa vụ giấy phép.
- [Văn bản hợp nhất 6154/2026 về quyền tác giả](https://chinhphu.vn/?classid=2629&docid=219630&pageid=27160): ghi nguồn hoặc giới hạn 25 từ không tự bảo đảm quyền trích dẫn/sao chép.
- [Luật An ninh mạng 116/2025/QH15](https://chinhphu.vn/?classid=1&docid=216499&pageid=27160&typegroupid=3), có hiệu lực từ 01/07/2026, và [Luật Bảo vệ dữ liệu cá nhân 91/2025/QH15](https://vanban.chinhphu.vn/?docid=214590&pageid=27160).
- [Meta chống spam](https://about.fb.com/news/2025/04/cracking-down-spammy-content-facebook/), [Google Spam Policies](https://developers.google.com/search/docs/essentials/spam-policies), [Discover](https://developers.google.com/search/docs/appearance/google-discover).

## Triển khai và bằng chứng

Website dùng source archive của production `dpl_HfJJfAzpAzdFbhpzssF2wcWZdwcM`, chỉ sửa validator nguồn. Các thay đổi khác đang có trong workspace không được đưa vào gói deploy. Gói được lint, kiểm thử nguồn và Next.js build trước khi deploy.

Production mới: `dpl_EXjNWmnSNHTiBN86kYebq3HkkC8c`, Ready, alias `www.vanghomnay.online`. Probe HMAC với digest cố ý không khớp xác nhận năm host mới đi qua validator nguồn rồi bị chặn trước mọi ghi dữ liệu; host giả bị từ chối ngay. Trang chủ, Nhịp vàng, Phương pháp biên tập trả HTTP 200.

Composio thật đọc được toàn văn hai bài BI về lãi suất/quan điểm Dalio, có ngày xuất bản. Trang biểu đồ vàng Markets Insider đọc được nhưng không có ngày; không dùng nó như tin mới. Bằng chứng ở `outputs/source-expansion-20261009/composio-probe.json` của bot.

Probe thêm qua Composio đọc được hai bài Bloomberg và hai bài AP; các bài mẫu này quá 24 giờ nên không được dùng làm tin mới. Hai URL Reuters trực tiếp không có toàn văn trong lần thử; có thể dùng bản đăng lại hợp lệ với nguồn gốc Reuters và kiểm chứng đầy đủ, nhưng không báo đã đọc được Reuters trực tiếp. Bằng chứng ở `agency-probe.json`.

Các script nghiệm thu chỉ đọc/chuẩn bị bản duyệt; không tạo phê duyệt hoặc tự đăng công khai. Kết quả ba phiên thực và báo cáo cuối được lưu trong `outputs/source-expansion-20261009` của bot. Báo cáo phải phân biệt số lượt nghiên cứu với số bản duyệt đạt và các điểm chặn thực tế.

Rollback: khôi phục mã/prompts/config từ backup rồi nạp lại riêng gateway fanpage; dùng deployment production trước nếu cần rollback validator. Giữ SQLite ledger, ID đã đăng và approval hiện có.

## Kết quả nghiệm thu cuối

- Bot: 513 kiểm thử, 509 đạt, 4 bỏ qua theo môi trường, không lỗi. Sau chỉnh bộ che credentials và chọn nguồn bị loại, 20 ca mở nguồn đã được chạy lại và đạt. Website: 448 đạt, 32 bỏ qua theo môi trường; 34 ca tích hợp nguồn/Hermes/review/auth đạt. Lint và build đều đạt.
- Ba phiên đầu có 1 bản duyệt hợp lệ: `30E57CFA87` (lãi suất thực và vàng). Tin quốc tế thiếu hai nguồn phù hợp trong 24 giờ; tin Việt Nam bị chặn vì timestamp VnExpress International mâu thuẫn toàn văn.
- Hai phiên bổ sung có thêm `57F3AC863B` (giá tham chiếu vàng quốc tế và giá giao dịch thực tế). Phiên Việt Nam đã tránh URL mâu thuẫn nhưng vẫn chỉ có một nguồn báo chí đúng ngày hỗ trợ trực tiếp; bảng giá PNJ không có ngày xuất bản bài, BTMC và nguồn khác quá hạn nên không được dùng bù.
- Tổng cộng **2/5 bản duyệt nội bộ**, chưa đạt ba bản duyệt từ ba nhóm. Đây là kết quả quan sát thực tế, không báo cả năm phiên thành công. Hai gói đều có compliance PASS, chưa có approval/publication; gate pháp lý vẫn hoạt động.
- Phiên bổ sung đầu bị gián đoạn trong lúc thực hiện. Kết quả được phục hồi từ run/draft bền vững, không tạo lại bài; thời gian 3.995,56 giây gồm gián đoạn nên không thể coi là thời gian AI xử lý thuần.
- Bằng chứng riêng tư của bot: `unit-results.json`, `composio-probe.json`, `agency-probe.json`, `production-readback.json`, `final-acceptance.json`, `metrics.json` trong `outputs/source-expansion-20261009`. Bản tóm tắt deployment/checks/acceptance nằm ở thư mục cùng tên trong website.
