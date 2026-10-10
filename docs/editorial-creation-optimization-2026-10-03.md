# Rà soát và tối ưu “Tạo bài mới” — 03/10/2026

## Dữ liệu trước khi sửa

Năm lượt không gắn lịch tự động được đối chiếu với SQLite và các request/result đã lưu. Nhật ký cũ chưa gắn trực tiếp message/callback với run; liên kết lời gọi AI của lượt cũ được suy ra bằng khoảng thời gian. Không coi lượt lịch 13:00 là một lần bấm của Admin.

| Lượt, giờ Việt Nam | Thời gian | Kết quả tạo bản duyệt | Nguyên nhân |
|---|---:|---|---|
| `57da93fc`, 03/10 13:18 | 254,639 giây | Thất bại | Bộ lọc chỉ dùng claim Facebook, bỏ C7–C8/S2 riêng website. Đồng thời nguồn quá 24 giờ, tiêu đề sai “hôm nay”, giờ bảng giá sai phút. |
| `4e650df7`, 03/10 11:59 | 272,622 giây | Thất bại | Fed 2009 quá giới hạn 10 năm, phát hiện sau editor và verifier PASS. |
| `72cb17a8`, 03/10 11:53 | 232,755 giây | Thất bại | Fed 2012 quá giới hạn 10 năm, phát hiện sau verifier PASS. |
| `4ff44076`, 03/10 11:45 | 300,392 giây | Thất bại | HTTP Kitco, tiêu đề sai ngày và cách đánh giá nguồn gốc; lỗi URL phát hiện muộn. |
| `58ed986c`, 02/10 21:25 | 227,724 giây | Thành công | Đã gửi `498A875493`; không suy ra việc xuất bản thành công từ trạng thái tạo bài. |

Trung bình **257,626 giây**, **1/5** lượt gửi được bản duyệt, **15 lời gọi AI**. Nghiên cứu trung bình 126,408 giây, biên tập 47,076 giây, kiểm chứng 78,092 giây. Hai lượt bổ sung `d8337f91` và `4a96098d` tái hiện sửa thiếu chỉ dẫn, alias `newsworthy` bị hiểu sai và tiêu đề evergreen “Giá vàng hôm nay”. Bảy fixture giữ nội dung/claims/check thực tế, không giữ thông tin xác thực.

## Thay đổi đã triển khai

- `editorial_policy.py` kiểm tra nguồn trước editor: miền, HTTPS, ngày/độ chính xác, tin 24 giờ, kiến thức 10 năm theo lịch, evidence và nhà xuất bản gốc. Giữ ngày-only đúng ngày, không bịa giờ. `eligible` chuẩn hóa từ alias legacy `newsworthy`.
- Preflight hai bản trước verifier: cấu trúc, độ dài, claim references, nguồn dùng thực tế và “hôm nay” theo ngày dữ liệu Việt Nam. Giữ riêng claim của từng kênh, tính hợp khi đánh giá toàn gói.
- Nếu hồ sơ có nguồn bổ sung không đạt nhưng vẫn còn đủ hai nguồn gốc hợp lệ, bỏ đúng nguồn đó và mọi claim phụ thuộc rồi chạy lại cùng preflight. Ghi rõ phần bỏ vào nhật ký/bản duyệt; không đổi tuổi nguồn hoặc thay tham chiếu để giữ claim. Replay dữ liệu `6fb6a358` giữ S1/S2 và bỏ S3/C7, tránh hai lượt nghiên cứu thừa.
- Hàm lọc luôn trả kết quả và lý do có cấu trúc, giữ nguồn website-only. Sửa nhận nội dung của cả hai kênh, lỗi theo trường và dữ kiện được phép; tối đa một lượt sửa. Không khôi phục claim bị loại qua website.
- Nghiên cứu tối đa ba lần: tìm ban đầu, bổ sung, rồi một đề tài kiến thức khác. Runtime chặn đổi nhãn cùng đề tài bị loại. Model không đổi.
- `creation_runtime.py` giới hạn 180 giây cho nghiên cứu/kiểm chứng, 90 giây cho editor và 480 giây toàn lượt. Heartbeat 20 giây, dừng cả cây tiến trình Windows khi timeout, lưu request/result/metadata bền vững trước dispatch.
- SQLite thêm `creation_stages`, `creation_requests` và metadata trigger vào `runs`. Bấm trùng chỉ hiện lượt đang chạy. Draft và mapping tới run commit cùng transaction; lỗi lưu mapping rollback cả draft. Restart giữ draft đã lưu và phục hồi gửi bản duyệt, không chạy lại AI hoặc tạo draft thứ hai.
- Telegram báo mã lượt, bước, thời gian chờ và lỗi cụ thể; trạng thái kết thúc thay tin đang chạy. Lỗi cập nhật giao diện không phá trạng thái nghiệp vụ.
- Khi pool tài khoản biên tập đã được provider đánh dấu `usage_limit_reached` và chưa đến giờ reset, kiểm tra trạng thái chỉ đọc trước nghiên cứu, báo đúng profile ngay. Không tự reset exhaustion hoặc làm mới/copy credential. Một credential mới khỏe hoặc thời điểm reset đã qua sẽ cho phép kiểm tra provider thật lại.

## Lỗi đọc nguồn phát hiện khi nghiệm thu thật

Lượt `de531773` dừng đúng 180 giây ở nghiên cứu. Kiểm tra chỉ đọc xác nhận Composio trả `successful=true` nhưng kết quả dài nằm trong tệp `/mnt/files/mex/*.json`; inline chỉ có `data_preview`. `web_worker.py` trước đó truy cập `response['data']`, gây `KeyError` rồi AI tiếp tục thử nguồn khác đến timeout.

Đã bổ sung đọc **toàn bộ** artifact qua chương trình cố định chỉ đọc, kiểm tra đường dẫn, độ dài, SHA-256 và đúng tool identity. Chuyển nén/chunk để không bị cắt phản hồi lần nữa. Không sử dụng preview làm evidence. Nếu tệp thiếu, thay đổi hoặc checksum sai, nguồn vẫn bị từ chối. Đã đọc thật hai nguồn WGC và Fed sau sửa. Nâng giới hạn đọc trang lên 100.000 ký tự và đánh dấu nguồn chạm giới hạn là bị cắt, để không mặc định đã đọc toàn văn.

## Kiểm chứng và vận hành

- **143 kiểm thử Python đạt**; bao phủ nghiệp vụ cũ, bridge hai kênh, fixture bảy lượt, alias/coverage, repair, callback đồng thời, restart, timeout, mất mạng Telegram, artifact source dài, chọn phần nguồn hợp lệ, mapping atomic, phân biệt quota/tần suất 429/403 và chặn quota sớm trước khi gọi nghiên cứu. Kết quả cuối được ghi tại `creation-tests.txt`. Có kiểm thử Windows thật dừng worker cùng tiến trình con.
- **7 kiểm thử HMAC website đạt**. Đọc production bằng chữ ký thật xác nhận package đã public trước đó còn nguyên nội dung; đọc trang và PNG/hash thành công.
- Backup trước sửa: `C:/Users/LENOVO/kim-tuyen-ai/backups/creation-20261003-133824`. Schema SQLite chỉ bổ sung, giữ lịch sử và ledger xuất bản. Chỉ restart Gateway `quan-tri-fanpage`.
- Website API xuất bản không thay đổi; đợt này triển khai bot Windows. Thay đổi chỉ có tài liệu trong repo website.

## Đo thật sau sửa và giới hạn nghiệm thu

| Lượt sau sửa | Tổng thời gian | Lời gọi AI | Kết quả |
|---|---:|---:|---|
| `de531773`, trước sửa đọc artifact dài | khoảng 182 giây | 1 | Timeout nghiên cứu 180 giây; không tạo draft. Đã phát hiện nguyên nhân đọc preview sai. |
| `afe906b4`, sau sửa đọc artifact | **224,111 giây** | **3** | Nghiên cứu 92,546 giây, bổ sung 103,297 giây, editor 24,765 giây. Bị chặn bởi provider hết quota, chưa có draft. |
| `6fb6a358`, provider probe từng trả lời | 451,997 giây | 6 | Ba lượt nghiên cứu, hai editor và một verifier. Dừng đúng lỗi quan hệ tổng/cấu phần nguồn cung; không gửi nội dung sai. Hồ sơ nghiên cứu đầu có thể giữ đủ hai nguồn sau khi bỏ nguồn phụ; đã bổ sung phép chọn phần nguồn hợp lệ. |
| `5fea3fa2`, sau chọn phần nguồn | 226,981 giây | 3 | Không đủ hai nguồn đủ ngày/độ mới, dừng trước editor/verifier. Sau đó sửa gợi ý nguồn dự phòng sang FEDS Notes có ngày rõ. |
| `c6b86bc6`, sau xác minh nguồn có ngày | **94,855 giây** | **2** | Nghiên cứu **67,875 giây**, đủ hai nguồn date-only hợp lệ WGC/Fed. Editor **24,687 giây** trả lỗi quota. Không tạo draft. |

Ở lượt `afe906b4`, nguồn Báo Tin tức ngày 02/10 09:50 đã bị chặn ngay sau nghiên cứu vì quá 24 giờ. Lượt bổ sung tìm được hai nguồn mới ngày 02/10 20:48 UTC và 03/10 13:52 giờ Việt Nam; mới sau đó gọi editor. Không gọi verifier cho hồ sơ nguồn cũ.

Editor thực tế trả `API call failed after 3 retries: HTTP 429: The usage limit has been reached` qua stdout, dù exit code là 0. Trước sửa phân loại lỗi, runtime ghi `INVALID_JSON`. Đã đối soát nguyên nhân và cập nhật tin tiến độ Telegram message `393` thành lỗi quota (API xác nhận cập nhật thành công), giữ reason gốc trong details để bảo toàn lịch sử. Runtime mới phân loại `PROVIDER_QUOTA`/`PROVIDER_AUTH` thay vì báo JSON sai; lỗi này không được biến thành thiếu bằng chứng.

Kiểm tra auth chỉ đọc xác nhận `quan-tri-fanpage` và profile nghiên cứu dùng credential khác nhau. Pool biên tập ghi `exhausted`, `usage_limit_reached` (429), thời điểm reset dự kiến **17:15:17 ngày 03/10/2026 giờ Việt Nam**; singleton còn ghi `refresh_token_reused`. Một probe ngắn thành công không chứng minh tài khoản biên tập đủ hạn mức cho lượt viết bài. Không sao chép token giữa profile hoặc đổi model để che lỗi.

**Chưa nghiệm thu việc gửi một bản duyệt mới và mục tiêu thời gian thành công dưới 5 phút**, vì tài khoản biên tập bị giới hạn. Năm lần thử sau sửa có **0/5** bản duyệt; đây là tập có timeout/quota và các thay đổi trung gian, không được dùng để tuyên bố luồng thành công nhanh hơn. Có thể khôi phục đăng nhập đúng profile bằng `hermes -p quan-tri-fanpage auth add openai-codex --type oauth` với tài khoản còn hạn mức, hoặc chờ reset rồi kiểm tra lại phiên. Giữ model hiện tại, chạy tiếp luồng thật đến `awaiting_approval` và kiểm tra package/ảnh/nội dung Telegram. Không thay nội dung hoặc tạo approval để vượt chặn này.

Artifact kiểm chứng trong `outputs/dual-publication`: `creation-baseline.json`, `creation-tests.txt`, `creation-after-audit.json`, `creation-live-blocker.json`, `creation-source-readback.json`, `creation-dated-source-probe.json`, `creation-subset-replay.json`, `creation-auth-blocker.json`, `creation-deployment.json`, `creation-completion-audit.json`. Các kết quả lượt thật giữ riêng theo run. Báo cáo lưu rõ trạng thái chưa hoàn tất nghiệm thu thật.

Rollback: khôi phục file bot/prompt từ backup rồi restart riêng profile fanpage. Giữ SQLite, package, approval và receipt; không khôi phục snapshot DB cũ đè lên ledger mới, không xóa bài công khai.
