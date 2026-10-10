# ElevenLabs và video HTML cho Kim Tuyến — ngày 05/10/2026

## Trạng thái bàn giao

**Đã chuyển backend sang `direct_api`, xác minh key và tạo giọng Giang thật thành công. Chưa hoàn tất nghiệm thu ba video hoặc đăng video Facebook thật.** Điểm chặn hiện tại là tài khoản AI biên tập Hermes hết hạn mức HTTP 429. Facebook và Sheets tiếp tục dùng Composio; quyền TTS của kết nối Composio không còn là cổng của backend trực tiếp.

## Chuyển sang API trực tiếp — trạng thái mới nhất

Đã sao lưu cấu hình trong `C:\Users\LENOVO\kim-tuyen-ai\backups\direct-api-activation-1791215571`, bật `backend="direct_api"`, giữ Giang/Flash v2.5 và trần 20.000 credits/tháng, 2.000/video. Xóa bằng chứng giá UI gắn với tài khoản Composio khỏi cấu hình đang dùng; API trực tiếp phải xác minh giá lại qua metadata và đúng voice ID trong thư viện với `include_custom_rates=false`.

Đã kiểm tra lưu và đọc credential bằng Windows DPAPI. Tệp `data/elevenlabs-direct.secret` chỉ cho tài khoản Windows LENOVO và SYSTEM truy cập; key không nằm trong cấu hình, tham số tiến trình, mã nguồn hoặc log. Biểu mẫu `setup_elevenlabs_key.ps1` có ô che ký tự để chủ trang nhập key. Giá trị ban đầu là API key ID bị provider từ chối; chủ trang đã cung cấp key đầy đủ để thay thế. Lỗi này được bot báo riêng, không đưa nội dung phản hồi có thể chứa credential vào thông báo.

API thật đã đọc Creator subscription, giọng Giang đúng ID, model Flash v2.5 có tiếng Việt, overage tắt và mức **0,5 credit/ký tự**. Thư viện `/v1/shared-voices?include_custom_rates=false` trả đúng voice ID nên direct backend xác minh giá bằng provider, không kế thừa proof UI Composio. Bằng chứng: [preflight trực tiếp](../outputs/elevenlabs-video/direct-api-preflight.json).

Đã gửi một POST tạo giọng ngắn từ nội dung giải thích có nguồn, nhận MP3 **12,631655 giây**, FFprobe đạt. Response báo **44 credits**, ledger giữ chỗ **100 credits**, subscription đọc lại dùng 44/còn **130.956 credits**. Đã chạy lại cùng job từ audio đã lưu trong điều kiện không cho đọc key/kết nối: checksum giữ nguyên, số lời gọi trong ledger vẫn **1**. Đây là kiểm tra quyền TTS và phục hồi artifact; chưa được tính là video nghiệm thu 60–90 giây. [Bằng chứng audio thật và cached replay](../outputs/elevenlabs-video/direct-api-live-tts.json).

Đã thử bước soạn kịch bản thật bằng worker Hermes; provider trả **HTTP 429/PROVIDER_QUOTA**. Metadata profile `quan-tri-fanpage` ghi reset dự kiến **07:14 ngày 10/10/2026 giờ Việt Nam**, chưa bảo đảm provider sẽ cấp lại đúng thời điểm. Cần đăng nhập tài khoản AI còn hạn mức hoặc chờ hạn mức của tài khoản hiện tại; không đổi model hoặc ghi PASS giả. [Bằng chứng worker](../outputs/elevenlabs-video/direct-api-script-readiness.json).

Các thành phần `elevenlabs_direct.py`, `elevenlabs_secrets.py` và routing/ledger trong `elevenlabs_video.py` đã được nối. Transport chỉ gửi key tới `https://api.elevenlabs.io`; không theo redirect, không tự retry và không chuyển backend. MP3 được giới hạn dung lượng, FFprobe kiểm tra rồi lưu file/checksum. Request/history ID và credits do response header trả về được lưu trước khi tải hết body; thiếu số phí giữ null và ngân sách đã giữ chỗ vẫn được tính.

Ledger phân biệt `rejected` khi API trả từ chối xác thực/quyền/hạn mức và `uncertain` khi kết quả gửi chưa rõ. Cả hai đều không tự POST lại cùng cảnh. Đổi key hoặc quyền sau yêu cầu bị từ chối cần lượt mới có kiểm tra ngân sách; audio đã lưu luôn được dùng lại khi render hoặc upload lỗi. Cancellation đóng kết nối, giữ marker và checkpoint. Giới hạn credits được kiểm tra ngay tại ledger để không bị tăng qua cấu hình tạm.

**61 kiểm thử ElevenLabs transport/credential/ledger đạt**; **85 kiểm thử workflow/UI/dual đạt**. Kiểm thử mới đi qua HTTP mock và SQLite thật: preflight chỉ GET, exact voice/rate, thiếu/sai key, 401/403/429, header trước body, timeout, callback lỗi, cache sau restart, audio_stored sau FFprobe lỗi, trần ngân sách và không gọi Composio từ direct backend. Đây chưa phải bằng chứng API thật tạo giọng thành công.

Key và preflight thật đã đạt; gateway `quan-tri-fanpage` đã được restart riêng và xác nhận chạy với PID 11200 sau khi kiểm thử đạt/key đúng. Website bridge không đổi trong đợt chuyển backend này. Các bước còn lại: khôi phục hạn mức AI để soạn/kiểm chứng ba video và chủ trang duyệt một bản để xác minh website/video Facebook/bình luận. Không có bài Facebook mới phát sinh từ đoạn thử audio.

```powershell
Set-Location 'C:\Users\LENOVO\kim-tuyen-ai'
powershell -NoProfile -STA -File .\setup_elevenlabs_key.ps1
& 'C:\Users\LENOVO\AppData\Local\hermes\hermes-agent\venv\Scripts\python.exe' .\elevenlabs_video.py status
```

`status` phải báo backend direct_api, không còn lỗi key, metadata/giọng/model/giá/số dư/overage đạt. Trường `tts_authorization_status="not_tested_by_generation"` nhắc rằng chỉ một POST thành công mới chứng minh quyền TTS thực tế. Bấm Tạo video khi có bản nháp còn hạn; bản `97D01C1DCB` được nêu phía dưới là bằng chứng giao diện trước chuyển đổi và hiện đã hết cửa sổ duyệt.

Phần kiểm tra Composio và UI dưới đây là bằng chứng lịch sử trước khi chuyển backend; không dùng nó để kết luận direct API đã hoạt động.

Khi tìm trực tiếp chức năng chuyển tiếng Việt thành giọng đọc, Composio từng trả thông báo: “Restricted tools (not returned; you cannot execute these in this environment)”. Backend Composio giữ cổng kiểm tra này; backend direct_api được chủ trang chọn riêng dùng credential local độc lập. Bằng chứng lịch sử: [kết quả khám phá công cụ](../outputs/elevenlabs-video/tts-capability-targeted.json).

Nút **Tạo video giọng đọc** đã được bổ sung vào bản duyệt `97D01C1DCB`, Telegram message `471`; tại thời điểm kiểm tra ban đầu bài pending và chưa có approval/post mới. Bản này nay đã hết cửa sổ duyệt, nên nghiệm thu trực tiếp cần bản hợp lệ hiện tại. Chỉ chủ trang được thao tác. Một lượt video bị chặn có thể trở lại bài ảnh bằng lựa chọn riêng; hệ thống không tự đăng ảnh thay video.

## Kết nối và điều kiện mở TTS

| Hạng mục | Kết quả kiểm tra từ bot ngày 05/10/2026 |
|---|---|
| ElevenLabs | Tài khoản `elevenlabs_switch-lysis`, ACTIVE; subscription `creator` |
| Số dư API | `character_count=0`, `character_limit=131000`; số dư được API báo là 131.000. Không suy diễn từ ảnh gói thuê bao |
| Trả phí vượt mức | `can_extend_character_limit=false` |
| Model | `eleven_flash_v2_5`; chọn theo kế hoạch, hỗ trợ tiếng Việt |
| Giọng nữ Việt trong thư viện | `Giang - Northern female Narrator`, ID `f5q6kePPoQAjCPYG6moa`, nhãn female/vi/northern |
| Giọng đã được chủ trang chọn | Đã chọn giọng đầu tiên, Giang, theo yêu cầu trực tiếp ngày 05/10/2026; ID và thời điểm lựa chọn đã lưu, bot đọc lại đúng |
| Mức credits của giọng/model | Đã xác minh dự toán 0,5 credit/ký tự với Giang + Flash v2.5: model 0,5 × discount 1 × giọng chuẩn 1. Bằng chứng UI có hạn tối đa 24 giờ, đối chiếu lại metadata tài khoản trước gọi |
| Quyền TTS | Hai công cụ TTS bị hạn chế trong môi trường Composio hiện tại |
| Google Sheets | Đã nâng header lên phiên bản 2, 27 cột A:AA; đọc lại đúng 34 dòng/34 khóa duy nhất, outbox đã đồng bộ |
| Search Console / GA4 | Kết nối ACTIVE nhưng chưa có property; độc lập với luồng video |

Điều kiện gọi giọng phải đồng thời đạt: kết nối ACTIVE, công cụ TTS được phép và có schema đầy đủ, chủ trang đã chọn giọng nữ Việt, model hỗ trợ vi, số dư và đơn giá credits xác minh được, overage tắt, và còn ngân sách. Chủ trang đã yêu cầu chọn Giang; lựa chọn này không phải bằng chứng đã nghe/nghiệm thu một video thật. `status` chỉ đọc số liệu; không gọi TTS.

Lựa chọn giọng đã lưu tại `data/video-settings.local.json`, được xác minh bằng chính Composio của bot. Bằng chứng: [lựa chọn giọng](../outputs/elevenlabs-video/voice-selection.json). Giọng và mức dự toán credits đã được xác minh; quyền TTS của Composio là điều kiện còn chặn tạo giọng hiện tại.

Đã kiểm tra metadata riêng của Giang bằng `ELEVENLABS_GET_VOICE`, không tạo audio. Model trả `character_cost_multiplier=0.5`, `cost_discount_multiplier=1`; metadata giọng trả `sharing.rate=1`, `fiat_rate=null` và `financial_rewards_enabled=false`. `sharing.rate` không được tự coi là `credit_multiplier`: tài liệu ElevenLabs cho biết hệ số credits của giọng có giá riêng còn phụ thuộc gói thuê bao người sử dụng. Kết quả API riêng lẻ giữ trạng thái chưa đủ bằng chứng tại [kiểm tra giá giọng](../outputs/elevenlabs-video/voice-pricing-audit.json).

Sau khi chủ tài khoản đăng nhập thành công trong trình duyệt Codex, đã tìm đúng **Giang - Northern female Narrator**. Giọng này vẫn xuất hiện khi chọn **Custom rates → Exclude**, URL `https://elevenlabs.io/app/voice-library?search=Giang&include_custom_rates=false`; kết quả còn 15 giọng. Đây là bằng chứng tích cực giọng không có giá riêng, thay vì suy diễn từ việc không thấy nhãn. Đã chọn Flash v2.5 trong màn hình TTS và đọc được số dư 131.000 khớp API. Đoạn nhập thử 20 ký tự đã được xóa; không bấm Generate speech. Công cụ Composio hiện thiếu tham số loại custom rate nên không ghi nhận kiểm tra này là bộ lọc API thành công.

Bot lưu `voice_standard_rate_verification` ràng buộc đúng account, gói Creator, voice ID và model ID. Mỗi preflight đối chiếu metadata giá mới với snapshot; proof hết hạn sau tối đa 24 giờ, hoặc metadata/account/model/gói thay đổi, thì quay về chưa xác minh và chặn tính phí. Dự toán hiện tại là **0,5 credit/ký tự**, không phải hóa đơn TTS đã phát sinh. Bằng chứng kết hợp và kết quả đọc lại: [giọng chuẩn và dự toán credits](../outputs/elevenlabs-video/voice-standard-rate-check.json). Việc xác minh giá không gỡ hạn chế TTS.

Sau cập nhật cổng giá, 48 kiểm thử adapter/reporting/script-editor và 25 kiểm thử video workflow đạt. Kiểm thử mới chặn proof hết hạn, account/gói/giọng/model không khớp, metadata custom rate thay đổi hoặc chỉ có `sharing.rate` mà thiếu bằng chứng UI. Gateway `quan-tri-fanpage` đã được restart và xác nhận chạy sau bản sửa; ledger vẫn không có lời gọi TTS thật.

## Cách sử dụng

```text
/vang@Manager_Dang_bot moi Chênh lệch mua–bán ảnh hưởng điểm hòa vốn thế nào?
```

1. Nhận bản nháp đã kiểm chứng, xem bài website, caption và ảnh.
2. Bấm **Tạo video giọng đọc**. Bản duyệt ảnh cũ được khóa trong lúc chuẩn bị video.
3. Bot kiểm tra ElevenLabs, soạn 5–6 cảnh và kiểm chứng lời đọc. Chỉ sau các cổng kiểm tra mới được giữ chỗ credits và gọi giọng.
4. Bot gửi MP4 để xem/nghe, cùng caption và bản website. Bấm **Duyệt và đăng Website + Video Facebook** mới xuất bản.
5. Website đăng trước và được đọc lại. Facebook đăng đúng một video, tiếp tục kiểm tra xử lý, bài công khai và bình luận nguồn.

**Tiếp tục video** dùng lại checkpoint, audio và video đã lưu. **Sửa kịch bản** mở ô trả lời Telegram: nhập yêu cầu bằng tiếng Việt tối đa 1.500 ký tự, chẳng hạn “Rút ngắn mở đầu và giải thích hòa vốn rõ hơn”. Phiên nhập có hiệu lực 15 phút và có nút thoát. Bản sửa tạo job mới, kiểm chứng lại, không kế thừa duyệt hoặc audio cũ. Không cần nhập JSON trong giao diện thông thường.

**Dùng bài ảnh** cần thao tác của chủ trang. Với video đã chuẩn bị, bot tạo bản duyệt ảnh mới; bản video cũ mất hiệu lực. Nút cũ, bấm đúp hoặc yêu cầu trong lúc worker khác đang chạy không tạo thêm job. Lịch nháp 07:00/12:00/18:00 giữ nguyên và không tự tiêu credits ElevenLabs.

## Sản phẩm video và kiểm chứng

Video dọc 1080×1920, 30 fps, MP4 H.264/AAC, faststart, 60–90 giây, tối đa 45 MiB. Không nhạc nền. Phụ đề theo đoạn/cảnh và thời lượng audio thực; không giả định timing từng từ. Tiêu đề cảnh tối đa 100 ký tự, nội dung màn hình không rỗng và tối đa 220 ký tự, lời đọc tối đa 650 ký tự/cảnh.

Kịch bản chỉ dùng claims của bài đã kiểm chứng. Các cảnh giải thích có `claimIds`; kiểm chứng độc lập phải PASS và bao phủ các claims đã dùng. Chuẩn hóa cách đọc ngày, số tiền, phần trăm, chỉ/lượng, SJC và PNJ trước TTS. Nếu tổng audio ngoài 60–90 giây, giữ audio và yêu cầu sửa; không cắt lời hoặc tự gọi lại.

Các cảnh cố định gồm mở đầu, giải thích, khoảng cách mua–bán, tích lũy theo trình tự, so sánh nhẫn–miếng, quan hệ lãi suất–vàng và kết thúc. Chọn cảnh theo nội dung, kết hợp đúng ảnh bài. Không dựng đường giá hoặc số liệu không có nguồn. Văn bản được đưa vào DOM bằng `textContent`; không thực thi HTML/JS lấy từ bài. Renderer chặn mạng, tải sẵn ảnh/font và dùng `setFrame(t)` để dựng cùng một timeline.

## Phục hồi, dữ liệu và ngân sách

- SQLite thêm `video_jobs` và ledger `video_credit_calls`. Chỉ một worker video xử lý tại một thời điểm; giới hạn 15 phút riêng với luồng bài tám phút.
- Lưu kịch bản/kiểm chứng trước TTS, giữ chỗ credits trước từng cảnh, đánh dấu dispatch trước lời gọi có thể tính phí. Cảnh đã lưu checksum không được gọi lại. Kết quả chưa rõ phí hoặc thiếu audio cần đối soát.
- Phục hồi đọc lại audio từ ledger kể cả khi crash xảy ra trước checkpoint. Gián đoạn dựng HTML dùng lại audio và các chunk đã xác nhận.
- Kiểm tra tuổi nguồn khi bắt đầu, sau render và trước chuẩn bị bản duyệt. Không thay timestamp nguồn cũ thành thời điểm hiện tại để vượt kiểm chứng.
- Tạo child draft và gắn `review_draft_id` trong cùng transaction. Replay bản duyệt không tạo thêm child/audio/upload.
- Manifest v3 có `facebookMode=video` và descriptor asset; các gói v2 ảnh giữ hợp đồng và digest cũ. Approval bao phủ bài, caption, script, giọng/model, audio, cảnh và MP4 qua các hashes đã đóng băng.
- Giới hạn **20.000 credits/tháng** và **2.000 credits/video**, tính cả thử nghiệm và tạo lại. Kiểm tra toàn bộ dự toán script trước cảnh đầu; không tự tăng hạn mức hoặc bật overage.
- Đã có **một lời gọi TTS trực tiếp thật**, API báo 44 credits; ledger giữ 100 credits dự toán và tiếp tục dùng mức giữ chỗ bảo thủ để kiểm tra ngân sách. Phí Composio, Blob, CPU và quy đổi VND chưa có hóa đơn/usage đầy đủ; không ghi là miễn phí. Giữ trần chi tăng thêm 3 triệu đồng/tháng của chiến lược.
- Sheets ghi chế độ Facebook, mã job, trạng thái video và credits đã giữ chỗ. Chưa biết credits để trống. Retry báo cáo không gọi publication; SQLite vẫn là nguồn trạng thái chính.

## Bridge và production

Migration `0017_editorial_video_assets` thêm bảng/index và đã áp dụng production; không thay dữ liệu bài cũ. Cờ `HERMES_VIDEO_ENABLED` mặc định false trong ví dụ cấu hình, đã bật ở bridge production sau kiểm tra; bot vẫn chặn TTS cho đến khi toàn bộ điều kiện khả dụng đạt.

Các endpoint dưới `/api/editorial/integrations/hermes/videos`:

| Endpoint | Chức năng |
|---|---|
| `POST upload-token` | HMAC, identity root/draft/version và descriptor; quyền private Blob có hạn, giới hạn đúng file MP4 |
| `POST {assetId}/complete` | Kiểm tra bytes, checksum, track H.264/AAC, kích thước, fps, duration và sample maps/extents |
| `POST {assetId}/url` | Chỉ cấp URL tải có hạn cho đúng gói đã được duyệt và website đã xuất bản |
| `GET/HEAD {assetId}/media` | Chữ ký có hạn, kiểm tra gói vẫn public, hỗ trợ Range; không có chữ ký trả 401 |

MP4 được upload trực tiếp lên private Blob bằng scoped token truyền qua stdin; không gửi file qua endpoint ảnh PNG. Token không nằm trong argv, mã nguồn, log hay descriptor duyệt. URL hết hạn được cấp lại cho cùng asset, không tạo audio/video mới.

Deployment mới nhất: `dpl_2FuHP4PNfAuAZ1EGwZo5uE4vnjRS`, project `chart-gold`, trạng thái READY, alias [www.vanghomnay.online](https://www.vanghomnay.online). Gateway `quan-tri-fanpage` được restart riêng; các gateway khác giữ hoạt động.

## Bằng chứng kiểm tra

| Kiểm tra | Kết quả / giới hạn |
|---|---|
| Bot | Bộ chính đã chạy 232 tests: 228 đạt, 4 bỏ qua có chủ đích. Sau rà soát cuối, 85 tests workflow/UI/dual và 46 tests adapter/reporting/script-editor đạt |
| Renderer | 10 tests gồm capture frame, overflow và tiếp tục chunk đều đạt khi bật QA render |
| Website | Các bộ video/v3/auth/review: 53 tests đạt; 32 database fixtures cần môi trường riêng bỏ qua. TypeScript, lint và production build đạt. Rà soát cuối chạy lại 38 tests video/v3, đều đạt |
| MP4 thật | Fixture FFmpeg 60 giây được parser nhận; malformed codecs, sample maps, offsets và overlap bị từ chối |
| Render offline | Video HTML 60 giây, 1080×1920, 30 fps, H.264/AAC, 2.500.136 bytes; đã xem frame hòa vốn, tích lũy và nhẫn–miếng |
| Production asset | `ff5c1217-6e11-43e7-98c2-1a8a779162af` ready; upload/complete cùng identity trả cùng asset, không cấp token mới cho asset ready |
| Cổng xuất bản | URL của asset cho gói chưa duyệt bị từ chối 409; media không ký trả 401; trang chủ và Nhịp vàng trả 200 |
| Telegram | Nút video đã được cập nhật trên message 471; không thay bài/caption/digest/approval |
| Facebook chỉ đọc | Đã xác minh Page đúng ID, quyền CREATE_CONTENT/MANAGE, công cụ tạo video nhận `file_url`; đọc được ba video cũ ở trạng thái ready. Không dùng chúng làm nghiệm thu luồng mới |

Rà soát cuối đã sửa cách đọc tiền Việt có một dấu phân nhóm hoặc ký hiệu tiền dính sát (`500.000đ`, `99.000đ`), phần trăm thập phân và độ tinh khiết “vàng 9999”. Ngày dạng `05/10/2026`, `05.10.2026` hoặc `2026-10-05` được đọc cùng ý; ngày không hợp lệ bị chặn trước TTS. Cấu hình local vượt trần 20.000/2.000 credits bị từ chối trước dispatch. Retry bình luận nguồn đã gửi nhưng chưa xác nhận giữ checkpoint ngay cả khi video hoặc bài tạm không đọc được; không gửi lại bình luận vì bước xử lý video thay đổi.

Video offline dùng **âm thanh tổng hợp để kiểm thử**, không phải giọng đọc ElevenLabs và không được coi là nghiệm thu ba chủ đề. Xem [video kỹ thuật](C:/Users/LENOVO/kim-tuyen-ai/data/video-renderer-qa/production-60s/technical-fixture.mp4). Bằng chứng production: [bridge sau kiểm tra MP4](../outputs/elevenlabs-video/production-bridge-hardened.json), [nút Telegram](../outputs/elevenlabs-video/telegram-controls.json), [runtime bot](../outputs/elevenlabs-video/bot-runtime.json), [Sheets đọc lại](../outputs/elevenlabs-video/sheets-readback.json), [ElevenLabs đọc lại](../outputs/elevenlabs-video/elevenlabs-readback.json).

Bằng chứng rà soát cuối: [runtime và ví dụ phát âm](../outputs/elevenlabs-video/final-audit.json), [khả năng Facebook chỉ đọc](../outputs/elevenlabs-video/facebook-readback.json). Gateway đã được restart sau các bản sửa bot; website giữ deployment đã xác minh vì không có thay đổi source website trong lượt rà soát này.

## Đối chiếu phạm vi nghiệm thu

| Yêu cầu của kế hoạch | Bằng chứng hiện tại | Kết luận |
|---|---|---|
| Nút tạo video dưới bản duyệt, chỉ chạy theo thao tác, lịch không tự TTS | Telegram message 471; callback owner/chat; không có TTS trong scheduler | Đã triển khai; lượt giọng thật chưa chạy |
| Giọng nữ Việt, Flash v2.5, kiểm tra số dư/quyền/rates | Creator, số dư 131.000, Giang đã chọn; UI Exclude custom rates + model API xác minh 0,5 credit/ký tự; `can_synthesize=false` | Giọng/rates đạt trong cửa sổ proof; quyền TTS vẫn chưa đạt |
| 5–6 cảnh từ bài và kiểm chứng lời trước tính phí | Prompt/script validator, source claims, verifier và tests trước TTS | Mã và kiểm thử đạt; chất lượng giọng thật chưa chứng minh |
| Ngân sách, giữ chỗ, không overage, không tự gọi lại khi kết quả chưa rõ | Ledger và các tests caps/uncertain/cache; API overage false | Đã triển khai; chưa có phí TTS thực để đối soát |
| HTML/CSS/SVG, phụ đề, 1080×1920/30fps/60–90 giây/H.264/AAC/faststart/≤45 MiB | Renderer tests, MP4 kỹ thuật 60 giây, parser và private asset production | Kỹ thuật đạt; chưa thay âm thanh tổng hợp bằng giọng đã duyệt |
| Một worker/15 phút/checkpoint, dùng lại audio khi retry | Tests worker serialization, cached ledger, timeout/chunk recovery | Kiểm thử đạt |
| Sửa thành phần tạo bản mới; approval bao phủ đúng nội dung/media | Canonical v3 hashes, validators, revision transaction, stale approval tests | Kiểm thử đạt; bản video thật chưa duyệt |
| v2 tương thích và tất cả nhánh v3, upload riêng, URL có hạn | Unit/integration v2/v3; bridge production, asset ready, media 401/URL chưa duyệt 409 | Mã/bridge đạt; chưa có URL video public cho package mới đã được chủ trang duyệt |
| Website trước Facebook; video ID chưa đủ coi là thành công | Adapter checkpoint/poll/post read-back/comment; partial failure tests; Facebook read-only preflight | Mã/kiểm thử đạt; chưa đăng video mới để chứng minh toàn luồng |
| Báo cáo Sheets không điều khiển xuất bản | 27 cột đúng, 34 dòng/34 khóa duy nhất và outbox synced | Đã xác minh |
| Ba video hòa vốn/tích lũy/nhẫn–miếng xem/nghe đầy đủ trong Telegram | Chỉ có fixture kỹ thuật; chưa có ba audio ElevenLabs | Chưa đạt, chờ quyền TTS; rates phải còn hợp lệ tại lúc gọi |
| Chủ trang duyệt một bản; đúng website/một video Facebook/bình luận nguồn, ghi calls/credits | Bài đang pending, không approval mới, số calls TTS bằng 0 | Chưa đạt, phụ thuộc bước trên và thao tác duyệt thật |
| Tài liệu vận hành và chiến lược cập nhật | Báo cáo này, README bot, `chienluoccomposio.md` | Đã cập nhật; sẽ bổ sung bằng chứng nghiệm thu thật khi khả dụng |

Không thể kết luận toàn kế hoạch hoàn tất từ kiểm thử mô phỏng hoặc asset kỹ thuật. Các bước còn lại cần thay đổi quyền công cụ trong môi trường Composio và lựa chọn/duyệt thật của chủ trang; không tự tạo kết quả duyệt hoặc đi vòng cổng TTS.

Các test phục hồi kiểm tra crash ở bước review, ledger đã có audio nhưng checkpoint thiếu, lỗi render không tạo lại giọng, source hết hạn trong lúc dựng, stale callback, hai yêu cầu đồng thời và Sheets lỗi không làm phát sinh xuất bản. Test TTS/Facebook dùng mock; chưa chứng minh phản hồi thực tế của provider hoặc bài video công khai. Audio TTS externalized/không đúng định dạng xác minh được phải đối soát, không suy diễn dữ liệu.

## Việc còn lại để nghiệm thu toàn bộ

1. API key, subscription, overage, Giang/Flash v2.5 và quyền TTS đã được xác minh; không cần kết nối lại ElevenLabs.
2. Khôi phục hạn mức AI của Hermes để soạn/kiểm chứng kịch bản. Giá được đọc lại trực tiếp trước từng lời gọi; giữ Giang và model đã chốt.
3. Chạy ba video giọng đọc thật: hòa vốn, tích lũy, nhẫn–miếng. Xem/nghe đầy đủ trong Telegram; ghi phát âm, thời lượng, số lần gọi, credits và chi phí biết được.
4. Chủ trang duyệt một bản video thật. Đối chiếu đúng bài website, đúng một video Facebook, caption và bình luận nguồn; thử lại phần đã hoàn tất để chứng minh không đăng trùng.
5. Ghi kết quả mới vào báo cáo này và `chienluoccomposio.md`. Chỉ khi các bước trên đạt mới đánh dấu plan hoàn tất. GA4/GSC property là đầu việc đo lường riêng còn thiếu.

## Lệnh vận hành

Dùng Python trong venv Hermes, tại `C:\Users\LENOVO\kim-tuyen-ai`:

```powershell
python elevenlabs_video.py status
python connect_composio_channels.py sync --limit 5 --retry-now
python -m unittest test_video_workflow test_newsroom test_telegram_bridge test_dual_prepare test_dual_channel
python -m unittest discover -s tests -p 'test_*video*.py'
hermes -p quan-tri-fanpage gateway status
```

Cấu hình không chứa credentials tại `data/video-settings.local.json`: model, voice ID đã duyệt, bằng chứng lựa chọn và hạn mức. Chỉ bật/thay giọng theo lựa chọn thật của chủ trang; không tự thêm bằng chứng giá hoặc duyệt. Không xóa ledger khi lời gọi có trạng thái chưa đối soát. Nếu dừng video, có thể tắt `enabled` local; lịch tạo bài ảnh vẫn giữ nguyên.

## Nguồn tham khảo

- [ElevenLabs models](https://elevenlabs.io/docs/overview/models): Flash v2.5 hỗ trợ `vi`; không tự suy ra đơn giá của giọng chuyên nghiệp.
- [Custom rates and credit multipliers](https://elevenlabs.io/docs/help-center/product/voices/voice-library/what-are-custom-rates-and-credit-multipliers): giọng có custom rate có thể tăng credits; hệ số phụ thuộc giọng và gói người dùng.
- [List shared voices](https://elevenlabs.io/docs/api-reference/voices/voice-library/get-shared): phân biệt giọng có custom rate bằng bộ lọc `include_custom_rates`; kiểm tra đợt này thực hiện qua giao diện đăng nhập vì toolkit thiếu tham số.
- [Get voice](https://elevenlabs.io/docs/api-reference/voices/get): metadata giọng và thông tin sharing; không suy ra đơn vị của hệ số credits từ một trường giá chưa rõ nghĩa.
- [Image & Video quickstart](https://elevenlabs.io/docs/eleven-api/guides/cookbooks/image-and-video): tham khảo khả năng API; đợt này chuyển động dựng local bằng HTML, không gọi Image & Video.
- [Telegram Bot API](https://core.telegram.org/bots/api): xem trước MP4 và điều khiển inline.
- Bằng chứng kết nối, subscription và hạn chế công cụ lấy từ Composio runtime của bot ngày 05/10/2026; không lấy ảnh danh mục ứng dụng làm số kết nối.
