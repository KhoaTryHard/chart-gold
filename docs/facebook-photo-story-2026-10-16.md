# Story ảnh tự động sau đăng bài — 16/10/2026

## Nghiệm thu production — cập nhật 17:05 ngày 16/10/2026

**Đã nghiệm thu bài mới `FF53D9236A`: Website + Facebook + Story ảnh đều đăng thành công.** Bài “Vàng có nhiều động lực, cần tách riêng khi đánh giá rủi ro đầu tư” được chủ trang duyệt lúc 16:57:50; Facebook đăng lúc 16:58:07, bình luận nguồn lúc 16:58:15, Story lúc 16:58:42.

- Đối chiếu live: website công khai và không đổi nội dung; digest gói khớp bản duyệt; SHA-256 ảnh website khớp; caption và bình luận nguồn Facebook khớp bản duyệt.
- Story trả `post_id=3333351066865652`, `media_id=122123566905425087`, khớp `photo_id` đã upload. Danh sách Story trả một bản, trạng thái thực tế là `published` chữ thường.
- Phát hiện và sửa lỗi xác nhận: hai lớp transport/ledger trước đó chỉ nhận `PUBLISHED` chữ hoa. Nay so sánh không phân biệt hoa/thường, vẫn giữ nguyên trạng thái thô trong bằng chứng; không nới điều kiện khớp ảnh hoặc ID biên nhận.
- 42 kiểm thử Story/dual publication đạt, có ca dùng phản hồi production chữ thường và kiểm tra đối soát không gọi upload/POST thêm.
- Đã cài bản sửa, cập nhật preflight đúng hash transport và đối soát job cũ sang `published`, xóa lỗi. Chạy worker lần thứ hai trả `idle`; không gửi lại Story. Gateway được khởi động lại.
- Bằng chứng: `outputs/facebook-story-browser-20261016/acceptance-status.json`, `readback-fix-tests.txt`, `readback-fix-preflight.json`, `readback-fix-release.json`.

[Bài Facebook](https://www.facebook.com/122093430315425087/posts/122123566773425087) · [Story đã xác nhận](https://facebook.com/stories/122093366559425087/UzpfSVNDOjMzMzMzNTEwNzAxOTg5ODU=/?view_single=1).

Các ghi chú “chờ nghiệm thu” bên dưới là trạng thái tại thời điểm cài đặt ban đầu lúc 16:40, đã được cập nhật bằng kết quả ở mục này.

## Kết quả triển khai

Đã cài và bật luồng **Story ảnh qua API Composio** trong bot `C:/Users/LENOVO/kim-tuyen-ai`. Mốc bật: **16:40:51 ngày 16/10/2026, giờ Việt Nam** (`enabled_at=1792143651.2176182`).

Chủ trang đã đổi yêu cầu trong phiên triển khai: cho phép Story ảnh riêng, không cần thẻ bấm về bài gốc. Cửa sổ Chrome dành cho thử nghiệm đã đóng; mã production không sử dụng trình duyệt. Báo cáo `facebook-native-story-api-gate-2026-10-16.md` vẫn mô tả giới hạn của phương án chia sẻ thẻ bài gốc, không phải trạng thái của phương án Story ảnh mới này.

**Chưa nghiệm thu một Story công khai thật.** Chủ trang chọn dùng bài ảnh mới kế tiếp được duyệt, không chia sẻ bổ sung bài cũ. Tại thời điểm cài xong chưa có bản mới được duyệt; hàng đợi Story trống. Kiểm tra API đọc và kiểm thử bằng giả lập đã đạt; không trình bày những kết quả này như bằng chứng POST Story production đã thành công.

## Sửa nguyên nhân và luồng mới

- Proxy Story dùng ngữ cảnh token mặc định từng trả Meta `190`. Lấy Page access token bằng `FACEBOOK_GET_PAGE_DETAILS` rồi dùng ngữ cảnh Page đó bên trong sandbox Composio đã đọc được `/v26.0/1262243656966414/stories`, trả danh sách trống.
- Transport giữ Page token trong bộ nhớ từ xa. Mọi đầu ra debug của helper được chặn bằng redirect stdout/stderr; chỉ trả trường kết quả được cho phép về bot. Token không được lưu trong mã nguồn, SQLite, bằng chứng triển khai hoặc cấu hình local.
- Sau khi Website và Facebook đều thành công, bot tạo một job Story trong cùng giao dịch chốt bài. Job dùng khóa duy nhất theo Page và ID bài Facebook; chỉ áp dụng bài ảnh có phê duyệt mới sau mốc bật.
- Trước gửi, kiểm tra bài Facebook còn công khai và caption khớp bản duyệt; tải ảnh từ URL media của website để đối chiếu SHA-256 với ảnh đã duyệt. Upload qua `FACEBOOK_UPLOAD_PHOTOS_BATCH` với `published=false`, lưu `photo_id`, ghi checkpoint gửi rồi mới gọi `/photo_stories`.
- Xác nhận Story bằng `media_id` đúng ID ảnh đã upload, `status=PUBLISHED` và ID Story khớp biên nhận. HTTP thành công đơn lẻ không đủ. Không có chức năng tạo ảnh mới hoặc thay ảnh bằng nội dung khác.
- Lỗi riêng của Tin không thay đổi kết quả bài chính. Sau lần gửi không rõ kết quả, chỉ đọc lại đối soát; không tự đăng lại. Các lỗi tạm thời trước gửi có tối đa ba lần thử lại, theo 5/15/60 phút. Công việc chưa gửi quá 24 giờ được đánh dấu hết hạn.
- Worker có lease gia hạn và kiểm tra chủ sở hữu ở checkpoint; tick 5 phút phục hồi công việc bị gián đoạn. Bản sao SQLite và môi trường test không được chạy API thật.
- Telegram bổ sung trạng thái Tin, nút tiếp tục/đối soát riêng và nhãn duyệt Website + Facebook + Tin ảnh. Quyền thao tác vẫn thuộc chủ trang.

## Kiểm chứng

| Kiểm tra | Kết quả |
| --- | --- |
| API preflight qua chính `publisher.connect()` của bot | Đạt; đúng Page, account ACTIVE, đọc Story thành công bằng Page token |
| Bộ kiểm thử bot trong bản staging | 726 ca, không lỗi, 4 ca skip theo cấu hình hiện hữu |
| Kiểm thử cuối phần Story/dual publication/Telegram | 82 ca, không lỗi |
| Bao phủ Story | Chống job trùng; phê duyệt/cutoff/video; rollback; lease; restart; checkpoint trước ghi công khai; timeout; sai ảnh; trạng thái chưa published; phân trang; chống lộ token trong đầu ra helper |
| Cài mã | Hash toàn bộ 6 tệp cài đặt khớp bản đã kiểm tra |
| SQLite | `PRAGMA quick_check=ok`; giữ nguyên 83 bản nháp; 0 job Story, không hồi đăng |
| Chạy worker sau cài | `idle`, không có bài mới đủ điều kiện |
| Website production | Bài “Giá trị dự trữ vàng tăng có đồng nghĩa mua thêm?” trả HTTP 200 |
| Đăng và đọc lại Story công khai | Chờ bài ảnh mới kế tiếp được chủ trang duyệt |

Một lần chạy kiểm thử staging ban đầu thiếu thư mục `hermes_plugin`; đã bổ sung các thư mục plugin/fixture hiện hữu vào staging và chạy lại đạt. Không sửa mã Hermes để xử lý lỗi môi trường kiểm thử này.

## Tệp, bằng chứng và vận hành

Tệp bot được cài: `facebook_story.py`, `facebook_story_api.py`, `test_facebook_story.py`, `dual_channel.py`, `newsroom.py`, `README.md`.

Bằng chứng trong `outputs/facebook-story-browser-20261016/` (tên thư mục giữ từ lúc bắt đầu phương án trình duyệt; nội dung release cuối là API):

- `api-preflight.json`, `bot-tests.txt`, `final-targeted-tests.txt`.
- `release-manifest.json`, `changes.diff`, `installed-verification.json`.
- `staging/` chứa bản được kiểm tra trước cài đặt.

Đã dùng SQLite backup API trước migration. Backup: `C:/Users/LENOVO/kim-tuyen-ai/backups/facebook-photo-story-20261016-cc6d3d1b/`. Gateway profile `quan-tri-fanpage` được dừng sạch, cài mã rồi khởi động lại; các profile khác không được thay đổi.

Tắt khi cần: chạy `facebook_story.py disable` bằng Python Hermes. Lệnh này giữ lịch sử và công việc đã gửi để đối soát. Để bật lại, chạy `preflight --proof <file>` rồi `enable --proof <file>`; chỉ chấp nhận bằng chứng mới, đúng Page và đúng hash transport. Mỗi lần bật lại sau khi tắt đặt mốc mới cho bài mới.

Nghiệm thu tiếp theo: chủ trang duyệt bài ảnh mới theo luồng Telegram hiện hữu; kiểm tra một job Story có `state=published`, đúng `photo_id/media_id`, biên nhận và trạng thái đọc lại. Chạy phục hồi lần nữa phải không tạo thêm Story. Nếu lỗi, dùng dòng Tin và nút đối soát/tiếp tục riêng, không đăng lại bài chính.

Không sửa mã ứng dụng Next.js nên không có deployment Vercel trong đợt này. Các thay đổi website có sẵn trong working tree không được đưa lên production bởi tác vụ Story.
