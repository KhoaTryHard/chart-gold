# Khắc phục upload ảnh qua Telegram — 14/10/2026

Lỗi nằm ở bot tại `C:/Users/LENOVO/kim-tuyen-ai`. Khi một cuộc trò chuyện AI đang chạy, Hermes đưa ảnh mới vào hàng chờ rồi xử lý tiếp bên trong cuộc trò chuyện, bỏ qua `pre_gateway_dispatch`. Ảnh trả lời đúng prompt upload đã bị chuyển sang AI; câu xác nhận nhận ảnh không phản ánh trạng thái lưu và gắn ảnh trong database.

## Thay đổi

- Plugin newsroom 1.2.0 xử lý ảnh/tệp ảnh và tin trả lời upload ngay tại adapter Telegram, trước gom ảnh và hàng chờ. Giữ kiểm tra owner, nhóm và topic; album liên quan upload được tiêu thụ và từ chối một lần. Không sửa Hermes core.
- Mở upload tạo khóa duyệt trong transaction. Server chặn callback cũ; giao diện thay nút duyệt bằng Thử lại/Hủy thay ảnh. Hết hạn hoặc lỗi không tự mở khóa bản cũ.
- SQLite bổ sung liên kết bản nháp kết quả, thời điểm hoàn tất, lỗi, bộ đếm retry, khóa bản cũ, topic và lịch sử prompt. Trạng thái `accepted` tiếp tục là bằng chứng ảnh đã được nhận; nó không có nghĩa bản duyệt đã gửi.
- Tệp nhận được lưu bất biến. Tạo bản thay thế, liên kết upload/run và vô hiệu hóa bản cũ cùng transaction. Retry/restart dùng lại đúng bản nháp; nhận cập nhật trùng không tải hoặc tạo thêm bản.
- Retry thủ công mở lại một vòng chuẩn bị gói có giới hạn, giữ nguyên manifest đã đóng băng. Phục hồi kiểm tra lại hash ảnh trước khi đánh dấu hoàn tất; lỗi xác thực/TTL vẫn giữ khóa cho đến khi chủ trang hủy.
- Upload đã lưu được phục hồi theo lease và retry có giới hạn. Chỉ xác nhận hoàn tất sau khi ảnh trong package khớp và tin duyệt đã được lưu. Các phiên trỏ đến bài đã xuất bản không được phục hồi để sửa/đăng lại.
- Đổi ảnh giữ `used_claim_ids` và metadata kiểm chứng. Lỗi gửi bản duyệt không khôi phục một bản đã bị thay thế.
- Hợp đồng website giữ nguyên; gói upload vẫn truyền và kiểm tra `imageOrigin=owner_upload` cho Website/Facebook.

Mã chính: `owner_images.py`, `newsroom.py`, `hermes_plugin/__init__.py`. Kiểm thử bổ sung nằm trong `test_owner_upload_reliability.py`; kiểm thử adapter registry và fixture upload hiện có cũng được cập nhật.

## Kiểm chứng

- Toàn bộ bot: 657 kiểm thử, 653 đạt, 4 bỏ qua theo môi trường.
- Bộ hồi quy trên bản cài: 37 kiểm thử đạt.
- Kiểm thử Website/Hermes: 19 đạt; lint, TypeScript và production build đạt.
- Kiểm thử xuyên suốt sử dụng lớp adapter Telegram thực với mạng giả lập và SQLite riêng: bot bận → nhận ảnh → lưu → chuẩn bị gói hai kênh → gửi bản duyệt. Xác nhận nguồn gốc và pixels ảnh, không gọi AI tạo ảnh.
- Bao phủ lỗi tạo bản nháp, lỗi bridge/Telegram, gửi ảnh thành công nhưng gửi nội dung thất bại, upload lặp, album, chạy đồng thời, hủy, hết hạn, restart và run chuyển thành draft.

## Phát hành và bằng chứng

Gateway `quan-tri-fanpage` được cập nhật tại thời điểm không có lease/tác vụ xuất bản đang chạy, sau đó khởi động lại và xác nhận Telegram connected. Hash plugin cài khớp source đã kiểm thử. Gateway được khởi động qua Scheduled Task hiện có để tách khỏi vòng đời phiên terminal. Các profile khác giữ nguyên.

Vercel production: `dpl_9CrBkbkUQKFUuHWAK32JyLh8Qtdg`, trạng thái READY, alias `https://www.vanghomnay.online`. `/`, `/nhip-vang`, `/bien-tap`, bài của sự cố và endpoint media đều trả HTTP 200. Đọc gói Hermes có chữ ký xác nhận bài cũ còn published và `contentUnchanged=true`.

Phạm vi chỉ sửa hệ thống. Nội dung và ảnh bài đã đăng được giữ nguyên; SHA-256 ảnh vẫn là `96436ce31788706de4742b433c07892cf93b515d0dcb5995f1d586cf84ddad67`. Fingerprint các bảng drafts, runs, audit, publication_channels, dual_approvals và publication_attempts không đổi qua migration và khởi động lại.

Bằng chứng và bản sao lưu: `C:/Users/LENOVO/kim-tuyen-ai/outputs/owner-upload-fix-20261014/`, gồm `changes.diff`, `release-manifest.json`, `bot-tests-audit-final.txt`, `installed-tests.txt`, `bot-installation.json`, `acceptance.json`, `production-verification.json` và `backup/`.

Chưa có lượt upload thật của chủ trang sau phát hành trong đợt nghiệm thu. Không tạo bài đăng thử công khai; các ca có gửi tin hoặc chuẩn bị package đều dùng mạng giả lập. Kiểm tra production là đọc trạng thái, trang và ảnh đang có.
