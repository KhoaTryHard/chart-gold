# Cổng xác minh chia sẻ bài Facebook gốc lên Tin — 16/10/2026

## Kết quả

**BLOCKED — chưa xác minh được hợp đồng API chia sẻ bài gốc lên Tin qua Composio.**

Đã thực hiện giai đoạn 1 của kế hoạch bằng chính `publisher.connect()` trong bot `C:/Users/LENOVO/kim-tuyen-ai`, dùng Python của Hermes và OAuth transport hiện hữu. Không dùng kết nối của chat để thay thế kết quả kiểm tra môi trường bot.

Thời điểm bắt đầu kiểm tra: 15:06:01 ngày 16/10/2026, múi giờ Asia/Saigon. Kiểm tra chỉ đọc, không gọi thao tác xuất bản Facebook.

Yêu cầu đã chốt: chỉ API Composio; Tin phải chứa thẻ bài gốc bấm mở đúng bài Facebook; chỉ áp dụng bài ảnh mới của bot. Story ảnh riêng và điều khiển trình duyệt không thuộc phương án được chấp nhận.

## Bằng chứng từ môi trường bot

| Kiểm tra | Kết quả |
| --- | --- |
| Kết nối Composio qua `publisher.connect()` | Thành công; Facebook account `facebook_assail-trouse` đang ACTIVE |
| Page đích | `1262243656966414` — Kim Tuyến - Giá Vàng Hôm Nay |
| Page tasks | Có `CREATE_CONTENT` và `MANAGE` |
| OAuth permissions | Có `pages_manage_posts`, `pages_read_engagement`, `pages_show_list` và các quyền khác; xem JSON bằng chứng |
| Tìm công cụ chia sẻ bài gốc lên Tin | Không tìm được công cụ có hợp đồng đúng yêu cầu; kết quả trả về các công cụ bài bảng tin, ảnh và đọc Graph |
| Đọc trường Story qua `FACEBOOK_GET_GRAPH_OBJECT` | Facebook trả HTTP 400; wrapper không cung cấp nguyên nhân chi tiết |
| `GET /1262243656966414/stories` qua Composio proxy | HTTP 400, OAuthException code `190`: `This call requires user access token that can access the profile plus` |

Trường đọc Story được giới hạn ở `post_id,status,url,creation_time`, tối đa một kết quả. Không yêu cầu đọc hoặc xuất access token. Quyền đăng bài và trạng thái ACTIVE không chứng minh proxy có ngữ cảnh token phù hợp cho endpoint Story. Không kết luận token hết hạn hoặc chỉ cần OAuth lại là khắc phục được.

Bằng chứng máy đọc nằm tại:

- `outputs/facebook-story-gate-20261016/bot-connection-check.json`: kết quả từ bot, schema discovery, quyền và lỗi đọc Story.
- `outputs/facebook-story-gate-20261016/sdk-contract-review.json`: endpoint/tham số trích xuất bằng AST từ SDK Meta chính thức, kèm SHA-256 của nguồn.
- `outputs/facebook-story-gate-20261016/gate-result.json`: quyết định dừng cổng xác minh và các phần chưa triển khai.

## Đối chiếu hợp đồng API

[Danh mục Facebook của Composio](https://docs.composio.dev/toolkits/facebook), phiên bản hiển thị `20261014_00`, liệt kê 55 công cụ nhưng chưa có hành động native share-to-story.

[SDK Meta chính thức](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/page.py) có `POST /photo_stories` nhận `photo_id`, `GET /stories`, và `POST /feed` có `target_surface=STORY|TIMELINE`. Sự tồn tại của những tham số này chưa chứng minh tổ hợp nào tạo thẻ chia sẻ bài đã tồn tại và bấm mở đúng bài đó. Không thử POST bằng tham số suy đoán. Đây là kết luận **chưa xác minh**, không phải khẳng định Meta tuyệt đối không hỗ trợ.

Tài liệu [Composio Proxy Execute](https://docs.composio.dev/docs/extending-sessions/proxy-execute) cho phép gọi endpoint chưa có công cụ và gắn xác thực từ connected account. Tài liệu không chứng minh việc tự chuyển sang đúng ngữ cảnh token Facebook cần cho native share. Không trích xuất token hoặc tự ghi đè Authorization. Trang hướng dẫn Meta Stories trực tiếp không truy cập được qua công cụ web ở lượt kiểm tra này; phần xác minh cấu trúc dựa trên SDK chính thức.

## Quyết định triển khai

Dừng trước giai đoạn 2 theo điều kiện của kế hoạch. Không thêm hàng đợi SQLite, worker, lịch, callback, cờ bật hoặc thay đổi luồng xuất bản đang chạy. Tính năng chia sẻ Tin chưa được triển khai hoặc bật; không có bài/Story công khai nào được tạo trong lượt kiểm tra.

Điểm nối đã xác định vẫn là phần xác nhận cả website và Facebook thành công ở `C:/Users/LENOVO/kim-tuyen-ai/dual_channel.py`, sau bước Facebook `readback_confirmed`. Điểm nối này chỉ được sử dụng khi cổng API đạt.

Chỉ bổ sung tài liệu và bằng chứng. Không thay mã nguồn ứng dụng hoặc bot, không migration, không restart gateway, không deploy Vercel. Các thay đổi mã nguồn có sẵn trong working tree được giữ nguyên và không được đưa lên production bởi tác vụ này.

## Điều kiện mở lại triển khai

1. Có tài liệu hoặc xác nhận kỹ thuật chính thức của Meta/Composio nêu endpoint, phiên bản, tham số gắn bài Facebook gốc, quyền và loại token được hỗ trợ. Composio phải quản lý xác thực đó.
2. Kiểm tra đọc Story bằng chính bot thành công; xác định được cách đối soát kết quả gửi không rõ mà không đăng trùng.
3. Có bằng chứng trên một bài ảnh mới được chủ trang duyệt: Story thuộc đúng Page, chứa thẻ bấm mở đúng permalink/ID bài gốc, không sinh thêm bài bảng tin.

Chưa thực hiện kiểm thử hàng đợi, retry, concurrent worker hoặc nghiệm thu Story production vì chưa vượt cổng API và chưa có mã tích hợp. Không báo các bước này là đã đạt.
