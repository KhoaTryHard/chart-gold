# Tối ưu Vercel chart-gold — 04/10/2026

Đã triển khai ba đợt lên project Vercel `chart-gold`, xác minh trên `www.vanghomnay.online`. Baseline mã nguồn và các chỉnh sửa có sẵn được lưu trước triển khai; không mất file baseline và mã nguồn ứng dụng trong workspace khớp gói phát hành cuối.

## Kết quả và phạm vi đo

| Hạng mục | Trước | Sau | Bằng chứng |
| --- | --- | --- | --- |
| Request nền công khai của một tab ủng hộ | Hai request mỗi 3 giây, khoảng 402/10 phút | Một request mỗi 25 giây, 25/10 phút | Fake timers; production desktop smoke đo chu kỳ 25 giây |
| Thời gian cập nhật thanh toán | Cả người trả tiền và khách khác ≤5 giây | Người trả tiền ≤5 giây, khách khác ≤30 giây | E2E webhook + PostgreSQL cô lập |
| HTML trang chủ | `private, no-store`, `MISS` | ISR 300 giây, `HIT` sau khi làm nóng | `verification-final.json` |
| HTML bài công khai | Render động | ISR 300 giây, `HIT` sau khi làm nóng | Runtime cache E2E + production HTTP |
| HTML hub Nhịp vàng | Render động | Vẫn render động theo searchParams; cache truy vấn 300 giây | Runtime list/related invalidation E2E |
| Payload HTML trang chủ | 110.684 byte | 93.254 byte trong lần kiểm tra cuối | Hai lần GET; khoảng 15,7% giảm dung lượng HTML, không phải toàn bộ trang/bundle |
| Chất lượng nguồn giá | HTTP thành công không phân biệt tuổi giá | Tuổi bản ghi, tuổi công bố nguồn và log nghiệp vụ riêng | Unit/E2E + UI PNJ production |

Giảm khoảng 94% request công khai và 88% lượt truy vấn tổng hợp là kết quả cho riêng polling trang ủng hộ. Không suy ra toàn bộ Function Invocations giảm cùng tỷ lệ. TTFB trong vài lượt GET là phép đo một máy, không phải p75 thực tế.

Ảnh ban đầu ghi 804 CDN requests, 386 function invocations và Error Rate 0,3% trong 6 giờ, nhưng 43 visitors trong 1 tuần. Hai khoảng thời gian không dùng chung mẫu số. Deployment ban đầu là `dpl_Chknut8HUNMjB1ef56KePcV8QjdE`.

## Thay đổi

- `GET /api/donations/public?period=month|all` trả `{ enabled, period, summary, rows }`; mặc định month. Tất cả response `no-store`, đầu vào sai trả 400, DB lỗi trả 503; endpoint cũ được giữ.
- Client gộp polling public 25 giây; dừng khi tab ẩn/offline, resume khi trở lại, chống overlap và response sai kỳ. Giữ polling pending/needs_review 3 giây, expired 30 giây, theo dõi mã cũ và kiểm tra thủ công. Paid và sửa thông tin thành công làm mới dữ liệu công khai ngay.
- Khi tiếng Anh đang tắt, locale không đọc cookie; home không tải thêm bài tiếng Anh. Giữ nhánh cookie để bật lại tiếng Anh. Admin, session và các đọc riêng tư không được cache công khai.
- Các cache bài viết dùng tag `editorial-public`, key theo locale/slug hoặc locale/category/page/limit, TTL 300 giây. Các mutation public sau commit làm hết hạn tag ngay và revalidate các path cần thiết. Gỡ bài, thay revision, dịch và ẩn bản dịch đều có invalidation.
- `/api/sjc` thêm `freshness: { evaluatedAt, recordAgeSeconds, sourceAgeSeconds }`. Giữ `mode`, `stale`, status và TTL tương thích; timestamp thiếu/không hợp lệ/tương lai trả tuổi null. Snapshot dự phòng giữ timestamp cũ. Client tính tuổi từ timestamp hiện tại, không dùng nguyên số tuổi trong payload CDN.
- Log JSON `market_origin` phân biệt network, cache nội bộ, deduplication, lỗi HTTP upstream, timeout, hủy và lỗi parser/adapter. Log `market_history_sync` phân biệt kết quả hoàn tất, một phần, thất bại và các ngày thiếu dữ liệu. Log chỉ phản ánh origin executions.
- E2E phát hiện kiểm tra Origin cũ ở các mutation ủng hộ/billing so sánh URL nội bộ của Next với host bên ngoài. Đã dùng helper `isTrustedOrigin` có sẵn; request hợp lệ qua forwarded host được chấp nhận, origin không liên quan vẫn bị từ chối.

## Kiểm chứng

- **418/418 unit/integration tests đạt**, gồm 32 test PostgreSQL cô lập; `npx tsc --noEmit`, `npm run lint` và production build đạt.
- **43/43 E2E đạt**, không skip/flaky: thanh toán, duplicate/mismatch/expiry/privacy, thời gian 5/30 giây, guest/member/admin, cache nóng và gỡ bài, revision mới cùng metadata/JSON-LD, negative cache, locale, nhãn tuổi dữ liệu và bố cục footer nhiều kích thước.
- Cache runtime test dùng bản Next production và các mutation HTTP thật trên database riêng. Production không tạo đơn, gửi webhook giao dịch hoặc đăng/gỡ bài thử.
- Production donation smoke desktop/mobile đạt; chu kỳ polling 25 giây, API mới, không gọi hai endpoint public cũ từ UI, theme/locale, không tràn ngang và không có lỗi console/page.
- Quan sát UI production PNJ: nguồn công bố 07:57 ngày 03/10, hệ thống lấy dữ liệu 16:38 ngày 04/10; hiển thị tuổi nguồn 1 ngày, không kết luận nguồn bị lỗi. Viewport 390px có scrollWidth 375px.
- Slug không tồn tại được `noindex`. Next có thể trả 200 nếu layout đã bắt đầu stream trước `notFound()`; không lấy HTTP status riêng lẻ làm bằng chứng bài nháp bị lộ.

## Phát hành và bằng chứng

| Đợt | Deployment | Xác minh production |
| --- | --- | --- |
| Polling và log | `dpl_3jdZyyTSF6PFgkRLoDqaBpVmXtoK` | `verification-polling-log.json` đạt |
| Cache | `dpl_6stXyQtSb8w4CnvhYSha7vkuFmcC` | `verification-cache.json` đạt |
| Tuổi dữ liệu và bản cuối | `dpl_3Een3RPF9NtW8978Mji225qTY6R5` | `verification-final.json` đạt |

Evidence nằm trong `outputs/optimization-20261004`: baseline/hashes và archive, manifest từng gói phát hành, deployment/domain identity, unit/E2E JSON, các HTTP verification và log origin đã lọc dữ liệu. Ảnh/báo cáo donation smoke nằm trong `test-results/donate-production-smoke/2026-10-04T09-37-01-466Z-cpmzk5`.

Có thể kiểm tra lại bằng:

```powershell
node scripts/verify-optimization-production.mjs
npm run smoke:donate
node scripts/collect-optimization-observability.mjs dpl_3Een3RPF9NtW8978Mji225qTY6R5
```

Rollback code bằng promote deployment đã xác minh trước đó; không xóa dữ liệu thanh toán hoặc ledger nội dung. Không có migration database hay dịch vụ trả phí mới trong lượt tối ưu này.

## Theo dõi sau phát hành và giới hạn

Đã tạo heartbeat theo dõi trong chat, đánh giá khoảng 24 giờ vào **05/10/2026 lúc 17:30** và tổng hợp 7 ngày vào **11/10/2026 lúc 17:30**, giờ Việt Nam. Lịch kết thúc sau mốc 7 ngày. Giữ yên lặng trước mốc hoặc khi chưa có thay đổi cần xử lý.

Metrics chi tiết theo route hiện bị Vercel trả `payment_required` vì chưa có Observability Plus. Billing cost cũng chưa khả dụng; điều này không có nghĩa usage bằng zero. Truy log 5xx trong giờ gần nhất không có kết quả, nên chưa xác định được nguồn lỗi 0,3% trong ảnh. Không mua add-on.

Các lần đánh giá sau phát hành phải so sánh cùng cửa sổ production, tách bot/verification khi dữ liệu cho phép. Thu log giữ lại và chạy kiểm tra chỉ đọc; ghi rõ khi không đủ retention hoặc quyền metrics. Báo cáo 24 giờ/7 ngày vẫn là dữ liệu tương lai, chưa được coi là kết quả đo hôm nay.

Lịch công bố theo từng provider chưa được xác minh; không đặt SLA tuổi giá chung hoặc suy đoán lịch cuối tuần/ngày lễ. Việc thu hồi bytes ảnh đã cache và cạnh tranh giữa job dịch đang chạy với lệnh ẩn bản dịch là các vấn đề cũ chưa được xử lý trong lượt tối ưu này; không tuyên bố các kiểm chứng HTML chứng minh hai tình huống đó.
