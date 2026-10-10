# Ảnh minh họa riêng cho bài mới qua bot — 04/10/2026

Phạm vi đã chốt: bài mới tạo qua bot Telegram hiện tại. Dùng nguồn lực AI sẵn có; các bài đã đăng không nằm trong đợt cập nhật này.

## Triển khai

Bot tại `C:/Users/LENOVO/kim-tuyen-ai` bổ sung `editorial_images.py` và `image_worker.py`. Sau khi nội dung website/Facebook đã được kiểm chứng, `newsroom.create_draft()` tạo ảnh từ tiêu đề, tóm tắt và toàn văn trước khi lưu gói duyệt. Worker riêng gọi backend `openai-codex` của Hermes bằng OAuth hiện có, model `gpt-image-2-medium`; không sửa Hermes core hoặc cấp thêm API key.

Prompt diễn giải chủ đề thành cảnh minh họa, thay đổi bố cục theo nội dung, giữ bảng màu vàng trầm–ngà–than. Các hướng cảnh gồm danh mục tài sản, chính sách tiền tệ, sức mua, tỷ giá, thanh khoản, chế tác và rủi ro. Không chèn chữ, số, logo, dữ liệu biểu đồ hoặc mô phỏng ảnh sự kiện.

Ảnh được giải mã, chuẩn hóa PNG 1200×675 và lưu bất biến dưới `assets/generated/`. Checkpoint theo lượt và hash nội dung giúp tiếp tục cùng ảnh. Kiểm tra hash ảnh gốc và ảnh chuẩn hóa chặn việc lấy lại ảnh của bài khác hoặc ảnh chung cũ. Prompt, alt, provider, model và hash nội dung được lưu riêng trong `bundle.illustration`, nên còn nguyên khi bridge chuẩn hóa `bundle.media`.

Bước ảnh dùng timeout 180 giây trong giới hạn toàn lượt 8 phút, có heartbeat và checkpoint bền vững. Nội dung/tuổi nguồn được kiểm tra lại sau khi tạo ảnh. Lỗi ảnh không tạo bản duyệt giả và không chuyển sang ảnh chung/provider khác. Khôi phục lượt xử lý nhận trạng thái `illustrating`; gửi lại bản duyệt, duyệt hoặc xuất bản không gọi lại tạo ảnh. Phiên bản sửa cùng bài kế thừa ảnh của bài đó.

Website nhận ảnh qua bridge hiện có; không đổi schema API, cơ sở dữ liệu website hoặc luồng phê duyệt. Bản mới vẫn cần Admin duyệt đúng nội dung và ảnh trước khi xuất bản website/Facebook.

## Kiểm chứng

- Python unittest: 177 trường hợp, 176 đạt; 1 symlink bỏ qua do quyền Windows. Bao phủ nội dung/prompt, ảnh riêng, decode/kích thước/đường dẫn, checkpoint, ảnh trùng, quota/auth, deadline/hủy subprocess, tuổi nguồn, digest, sửa bài, gửi lại và phục hồi.
- Nguồn AI thật tạo hai ảnh khác nhau: phân bổ danh mục và lãi suất/chính sách tiền tệ. Đã xem ảnh và xác nhận đúng 1200×675. Gọi lại cùng checkpoint không tạo ảnh mới.
- Hai lượt ảnh thật: `illustration-smoke-17ed85fa` và `illustration-smoke-7b0b5167`. Kết quả và metadata ở `data/creation-stages/`; ảnh và manifest ở `assets/generated/` của bot.
- Website: lint và production build đạt. Signed GET trên production đọc hai gói đã đăng, nội dung và hash ảnh còn đúng. Báo cáo: `outputs/editorial-illustrations/production-bridge-readback.json`.
- Nghiệm thu tạo ảnh và kiểm thử pipeline không gửi Telegram, không phê duyệt hoặc tạo bài công khai mới. Ảnh mới xuất hiện trong bản duyệt ở lần tạo bài mới tiếp theo.

Backup trước sửa: `C:/Users/LENOVO/kim-tuyen-ai/backups/article-images-20261004-142249`.

## Vận hành

Đã khởi động lại riêng Gateway `quan-tri-fanpage` sau khi kiểm thử và tạo ảnh thật đạt; trước restart đã kiểm tra không có lượt tạo hoặc bản đang xuất bản. Kiểm tra vận hành cuối xác nhận Gateway đang chạy. Giữ nguyên lịch và các profile khác. Nếu cần hoàn tác, khôi phục hai file điều phối từ backup và restart profile; giữ nguyên ảnh, checkpoint, bản duyệt và ledger xuất bản.

Deployment production đã Ready: `dpl_Chknut8HUNMjB1ef56KePcV8QjdE`, alias `www.vanghomnay.online`. Kiểm tra sau deployment xác nhận `/` và `/nhip-vang` trả 200; signed GET của hai gói đã đăng xác nhận nội dung và hash ảnh đúng. Chưa đăng bài công khai mới trong đợt nghiệm thu này. Báo cáo tổng hợp ở `outputs/editorial-illustrations/acceptance.json`; các lần tạo bài mới tiếp theo qua bot sẽ có ảnh riêng trong gói Admin duyệt.
