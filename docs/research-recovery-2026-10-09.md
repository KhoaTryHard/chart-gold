# Khắc phục thu thập nguồn — 09/10/2026

## Phạm vi và sao lưu

Mã runtime ở `C:/Users/LENOVO/kim-tuyen-ai`. Backup nhất quán mã, prompts, cấu hình và SQLite: `backups/research-recovery-20261009-192310`. Website/Hermes v2/v3 giữ hợp đồng và deployment production hiện hành; thay đổi đợt này nằm trong bot.

## Những lỗi đã sửa

- AI chỉ đọc bằng `candidate_ids` có trong kết quả tìm kiếm hoặc nguồn gợi ý được cấu hình. Ledger giữ URL nguyên bản, không dựng lại slug từ tiêu đề. Plugin Hermes dịch URL đã tìm được sang mã ứng viên; URL chưa có ứng viên bị từ chối trước network.
- Snapshot tổng hợp bắt buộc có `snapshot_id` trong corpus đã được chọn của phiên hiện tại. URL và ngày metadata được gắn bởi chương trình; AI không tự sửa. Ngày thiếu metadata vẫn phải được chứng minh từ toàn văn và qua kiểm chứng, không suy đoán ngày hoặc thêm giờ.
- Điều kiện ngày/tuổi/HTTPS/checksum/toàn văn được kiểm tra sau mỗi lượt đọc bằng cùng quy tắc với bước cuối. Nguồn 2014 bị loại khỏi bài kiến thức ngay, nguồn quá 24 giờ chỉ bị loại khỏi news. Hai nguồn World Gold Council chỉ tính một nguồn gốc.
- Nguồn từ phiên trước chỉ góp vào corpus khi được chọn lại trong phiên hiện tại. Giới hạn 8 URL tính cả các bản đọc cache được chọn. Redirect sang URL bài khác không bị gắn nhầm vào URL yêu cầu, kể cả khi host đích thuộc allowlist.
- Tổng hợp hồ sơ chạy trong vòng thu thập. Nếu hồ sơ thiếu nguồn đúng đề tài/nguồn độc lập/ngày/dedupe và còn lượt đọc/thời gian, lỗi được trả về để đọc ứng viên thay thế. Chỉ hồ sơ đã vượt kiểm tra mới đi sang biên tập. Gói qualified checkpoint gắn với phase, request hash và source hashes; dùng lại phải kiểm tra tính đầy đủ/freshness.
- Góc bài có `angle_id` ổn định, gợi ý ban đầu và tiêu đề cuối riêng. Dữ liệu cũ phục hồi từ gợi ý/checkpoint. Hai lượt 17:48 và 18:01 đều phục hồi thành `gold-assay-hallmark` dù tên bài khác. Bộ nhớ thất bại tính theo góc/bộ nguồn trong 24 giờ, không biến lỗi claim thành lệnh cấm toàn nhà xuất bản.
- `select_angles` cho phép tối đa ba góc dựa trên mã ứng viên; chủ đề người dùng khóa được giữ nguyên. Hai truy vấn đầu ưu tiên hai nhóm nhà xuất bản khác nhau; hai lượt còn lại bổ sung nguồn chính thức/phần còn thiếu.
- Lỗi Composio qua JSONL `{id,result}` giữ đúng mã yêu cầu, bước `setup/connect/initialize/discovery/schema`, loại lỗi, HTTP status thực tế, nguyên nhân đã che thông tin xác thực và cờ retryable. Worker không tăng giới hạn retry; client chỉ thử lại một lần với timeout/mạng/5xx trong deadline cũ. 401/403, thiếu công cụ và lỗi không phân loại được không tự lặp.
- Luồng Telegram phân biệt lỗi kết nối công cụ và thiếu bằng chứng, hiển thị số bản đọc và số nguồn qua kiểm tra; lỗi kết nối có nút thử lại kết nối. PASS kỹ thuật vẫn không thay thế hồ sơ pháp lý hoặc duyệt xuất bản của chủ trang.

## Ràng buộc vận hành

Giữ 4 truy vấn, 4 lượt đọc, 8 URL, 180 giây mỗi phiên; tối đa hai phiên mỗi đợt. Giới hạn model/provider hiện tại không thay đổi. Nguồn cần hai nhà xuất bản gốc độc lập thực sự hỗ trợ nội dung; news trong 24 giờ và evergreen trong 10 năm. Nguồn không có đủ bằng chứng vẫn bị chặn, không hạ tiêu chuẩn để đạt số bản duyệt.

Không chạy lại thủ công các lượt cũ. Gateway có thể tiếp tục lịch/khôi phục do chính cấu hình lịch hiện hành; sự kiện đó được tách khỏi các yêu cầu nghiệm thu mới. Các bản thử chỉ đi đến chuẩn bị/gửi duyệt nội bộ, không tạo approval/publication.

## Kiểm thử và bằng chứng

Kiểm thử gồm URL AP từ kết quả thật không bị dựng lại, nguồn 2014 bị loại sớm, same-origin, phase/cache URL cap, phản hồi thiếu nguồn dẫn đến lượt đọc bổ sung, angle ID không mất khi đổi tiêu đề, lỗi init có framing, retry có giới hạn và nguồn/news quá hạn không tự được phát hành.

Bằng chứng của bot được lưu tại `outputs/research-recovery-20261009`: `unit-results.json`, `regression-audit.json`, `live-acceptance.json`, `final-verification.json` và báo cáo cuối. Các kết quả phải tách số lượt chạy, số bản duyệt đạt và lý do chặn. Không dùng các unit test đạt để khẳng định mọi yêu cầu thực đều sẽ tạo bài.

Rollback: khôi phục mã/prompts từ backup rồi nạp lại riêng gateway `quan-tri-fanpage`; giữ ledger và các gói bài đã tạo. Không xóa run hoặc public artifact để giả lập rollback.

## Kết quả cuối

- Bot: **549 trường hợp, 545 đạt, 4 bỏ qua theo môi trường**, không lỗi. **22 ca tương thích website/Hermes/review/auth đạt**.
- Ba yêu cầu mới: **1/3 bản duyệt nội bộ** (`7412AF8247`, vàng và USD). Lượt nguồn cung bị chặn vì không đủ nguồn gốc độc lập hỗ trợ dữ kiện; lượt hợp đồng bị chặn vì model viết lệch metadata ngày.
- Sau khi bắt buộc snapshot_id và gắn ngày từ receipt, hai yêu cầu xác minh mới đều qua nghiên cứu/biên tập và đến kiểm chứng nội dung. Bài hợp đồng bị chặn vì phát biểu/attribution chưa được toàn văn hỗ trợ; bài ETF bị chặn vì tiêu đề khái quát sai phạm vi vật chất/tổng hợp và ghi nguồn chưa rõ. Không còn lỗi model tự viết URL/ngày hoặc khởi tạo công cụ chung chung trong các phiên này.
- Tổng cộng **1/5 bản duyệt hợp lệ** trong đợt thử. Đây là kết quả thực tế, không phải khẳng định pipeline đã đạt tỷ lệ tạo bài cao hoặc mọi lỗi nội dung đã được xử lý. Gói đạt vẫn pending, chưa có approval/publication; gate hồ sơ pháp lý giữ nguyên.
- Gateway fanpage đã nạp mã cuối. Hai profile còn lại không được restart trong nhiệm vụ. Trang chủ, Nhịp vàng và Phương pháp biên tập production đọc lại HTTP 200. Probe HMAC cố ý digest sai xác minh API nối được và dừng trước ghi dữ liệu. Website không thay source/contract nên không cần deployment mới trong đợt sửa bot này.
- Hồi quy snapshot cũ xác nhận hai lượt 17:48/18:01 có cùng `gold-assay-hallmark` và chỉ một nguồn gốc đủ ngày cho góc đó. Lượt lịch 18:00 chưa mở được collection; lỗi gốc trước sửa đã mất và không được suy đoán lại.

Hạn chế còn lại: chất lượng claim/tiêu đề/attribution của AI vẫn cần kiểm chứng và có thể khiến bài bị chặn sau một lượt sửa giới hạn. Các nguồn thiếu quyền truy cập hoặc không có ngày/bằng chứng vẫn không đủ điều kiện. Tăng tỷ lệ tạo bản duyệt cần tiếp tục cải thiện hồ sơ dữ kiện và biên tập; không giải quyết bằng hạ tiêu chuẩn hoặc tự đăng lại các lượt đã bị loại.
