# Tối ưu tạo, duyệt và đăng bài — 08/10/2026

## Phiên bản triển khai

Bot ở `C:/Users/LENOVO/kim-tuyen-ai`. Đã sao lưu mã, prompts, cấu hình và SQLite bằng API backup nhất quán vào `backups/publication-reliability-20261008-081648` trước khi thay đổi. API website, bridge HMAC và điều kiện chủ trang duyệt vẫn dùng hợp đồng hiện hành.

`config.json.creation` là nguồn cấu hình runtime: tổng thời gian `null`, mỗi provider có 30 giây khởi động/xác thực và 120 giây xử lý, thu thập nguồn 120 giây, heartbeat 20 giây và khóa xử lý 120 giây. Giới hạn mỗi bước model được tính theo số provider; không chia thời gian còn thừa. Số phiên nghiên cứu, lượt sửa bài và lượt đăng mỗi kênh giữ nguyên.

Worker được định danh riêng. Khóa gia hạn qua kết nối SQLite riêng; mọi ghi cơ sở dữ liệu của pipeline kiểm tra quyền trong transaction. Polling worker kiểm tra quyền/hủy mỗi giây. Phục hồi dùng khóa hết hạn, không dùng tuổi 15 phút. Lượt gián đoạn giữ `run_id`, bước và checkpoint; không tự khởi động lại các lượt cũ đã kết thúc. Khung lịch gắn với `run_id`, không hao số lần thử khi pipeline bận.

## Nguồn và khả năng phục hồi

- Thu thập và tổng hợp có ranh giới lưu riêng. Timeout tổng hợp giữ nguồn để tiếp tục; lỗi vận hành/JSON không trở thành `eligible=false`.
- Chuẩn hóa nhãn độ chính xác từ giá trị ngày hợp lệ; không thêm giờ/múi giờ hoặc thay đổi ngày. Giữ kiểm tra tuổi nguồn, metadata, checksum, nguồn gốc độc lập và claim.
- Lưu hồ sơ AI trước khi kiểm tra. Nguồn phụ lỗi có thể bị loại cùng claim phụ thuộc khi phần còn lại vẫn đủ điều kiện.
- Nguồn trong phản hồi AI được gắn bằng mã snapshot; URL lấy từ bản đọc đã lưu. Model không được tự dựng lại đường dẫn nguồn.
- Kiểm tra trùng chủ đề/bộ nguồn tin mới trước biên tập. Gợi ý kiến thức mở rộng sang ETF, khai thác/tái chế, độ tinh khiết và hợp đồng vàng; vẫn phải có hai nguồn độc lập thực sự hỗ trợ bài.
- Số liệu sản lượng có năm rõ ràng không bị bộ lọc giá hiện tại chặn nhầm. Báo giá/biến động giá vàng vẫn bị chặn trong bài kiến thức.
- Kết quả đọc lỗi, bị cắt hoặc quá hạn không được dùng như cache thành công. Đọc lại nằm trong ngân sách hai truy vấn/hai lượt đọc/bốn URL của phiên.
- Thêm nút Hủy lượt tạo, giữ checkpoint và ngăn gửi bản duyệt sau hủy. Tiếp tục có chủ đích mở đợt xử lý mới; không tự tăng số lần thử vô hạn.
- Mỗi đợt Tiếp tục do người dùng yêu cầu có tối đa một lượt sửa mới, giữ bản thảo và lỗi cụ thể. Phục hồi worker tự động không đặt lại số lần sửa. Ngân sách kiểm chứng tính riêng cả việc đọc lại nguồn để provider cuối vẫn có đủ 120 giây.

## Xác minh

Baseline: 468 trường hợp, 4 bỏ qua, không có lỗi. Phiên bản cuối: **493 trường hợp — 489 đạt, 4 bỏ qua theo môi trường, không có lỗi**. Website: **26 kiểm thử thuộc bốn tệp tích hợp đạt**. Kiểm thử bao gồm khóa gia hạn, worker cũ trả muộn, hủy, nguồn hết hạn trong lúc tạo ảnh khi không có deadline tổng, giới hạn provider độc lập, tiếp tục checkpoint, sửa có giới hạn, cache lỗi và năm ca lịch sử.

`publication_metrics.py` đọc cơ sở dữ liệu ở chế độ chỉ đọc, báo riêng tỷ lệ tạo bản duyệt và tỷ lệ đăng đủ hai kênh, cùng số lần gọi/provider và thời gian mỗi bước. Bằng chứng nghiệm thu ở `outputs/publication-reliability-20261008/live-acceptance.json` của bot.

Xuất bản thật vẫn cần chủ trang bấm duyệt đúng gói trong Telegram. Bản được duyệt chỉ được báo hoàn tất sau khi đọc lại website, bài Facebook và bình luận nguồn. Facebook chưa rõ kết quả phải đối soát trước khi thử lại.

## Kết quả nghiệm thu thật

Năm yêu cầu mới tạo được **2/5 bản duyệt ở lượt đầu**. Sau các đợt Tiếp tục có giới hạn và sửa các lỗi được phát hiện, **4/5 yêu cầu có bản duyệt hợp lệ**. Đây là kết quả của cả luồng phục hồi, không phải tuyên bố tỷ lệ đạt 80% ngay từ lượt đầu hoặc cho mọi yêu cầu tương lai.

| Mã lượt | Bản duyệt | Kết quả |
| --- | --- | --- |
| d14dfad7 | 2287C0CA18 | Đã gửi duyệt; còn chờ chủ trang |
| 879a6350 | BFD0FA415E | Chủ trang đã duyệt; website và Facebook đã xác nhận |
| 6e0fc35f | 9E14DE2CD5 | Chủ trang đã duyệt; website và Facebook đã xác nhận |
| 0bdbf247 | C70C4A337F | Chủ trang đã duyệt; website và Facebook đã xác nhận |
| 8a219f6a | — | Chặn đúng: toàn văn nguồn S2 không chứng minh hai dữ kiện được dùng; sau loại bỏ chưa đủ hai nguồn độc lập |

Phát hiện và sửa thêm lỗi xuất bản thật: truy vấn Composio tổng hợp bỏ sót `FACEBOOK_GET_COMMENTS`, khiến Facebook dừng trước khi gửi bài. Bộ khám phá nay tìm riêng từng công cụ còn thiếu, chỉ nạp schema sau khi công cụ được tìm thấy. Kiểm thử xác nhận thiếu công cụ thật vẫn chặn trước mọi ghi công khai. Ba bài được chủ trang duyệt đã hoàn tất **3/3** trên hai kênh, không đặt lại bộ đếm thử và không đăng lại website đã thành công.

Kiểm tra độc lập bằng API đã xác nhận đúng caption, một ảnh, bình luận nguồn và package website không thay đổi. Bằng chứng: `publication-readback.json` và `metrics.json` trong thư mục outputs nêu trên. Lỗi cũ của các lượt đã phục hồi được gỡ khỏi trạng thái hiện tại; dữ liệu trước khi gỡ nằm ở `resolved-errors.json`.

## Production và bài đã đăng

Gateway `quan-tri-fanpage` đã nạp phiên bản cuối; hai gateway khác giữ nguyên. Website được redeploy từ chính bản production hiện hành vào project Vercel `chart-gold`, không đưa các chỉnh sửa ngoài nhiệm vụ trong working tree lên production. Alias `www.vanghomnay.online` đã Ready; trang chủ, Nhịp vàng và các bài công khai đều được xác minh.

| Bài | Website | Facebook |
| --- | --- | --- |
| ETF vàng và vàng vật chất | [Đọc bài](https://www.vanghomnay.online/nhip-vang/etf-vang-va-vang-vat-chat-co-che-nam-giu-chi-phi-va-khac-biet-can-hieu) | [Xem bài](https://www.facebook.com/122093430315425087/posts/122121742827425087) |
| Hai lớp chi phí của vàng | [Đọc bài](https://www.vanghomnay.online/nhip-vang/cach-doc-hai-lop-chi-phi-cua-vang-gia-giao-ngay-hop-dong-tuong-lai-va-lai-suat-thuc-uoc-tinh) | [Xem bài](https://www.facebook.com/122093430315425087/posts/122121742821425087) |
| Nguồn cung vàng tái chế | [Đọc bài](https://www.vanghomnay.online/nhip-vang/nguon-cung-vang-tai-che-bo-sung-cho-khai-mo-nhu-the-nao) | [Xem bài](https://www.facebook.com/122093430315425087/posts/122121742623425087) |
