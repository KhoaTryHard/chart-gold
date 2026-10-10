# Google audience signals before editorial research

The Windows bot reads Search Console and GA4 through its existing Composio OAuth
transport before a new editorial run. These reports describe audience preferences
on this website. Market claims still require full source text, two independent
publishers and independent verification. Telegram owner approval remains required
before website/Facebook publication.

## Runtime

- The owned `audience_worker.py` process has a 45-second cap inside the existing
  900-second creation deadline. Startup, discovery and schema loading count.
- Google calls are read only, each capped at 30 seconds, with at most two in
  flight. Each source resolves and reads independently; a slow GA4 request cannot
  prevent a Search Console report from being saved.
- Search Console requests separate top-query and top-page reports, up to 100 rows
  each, from seven final days ending
  D−3 in America/Los_Angeles, plus the previous seven days.
- GA4 validates report fields and compatibility, then requests up to 100
  hostName/landingPage rows with sessions, engagedSessions and engagementRate.
  Its windows use the property timezone and end yesterday.
- Top signals interleave source ranks and merge identical topics, without adding
  clicks to sessions. Missing previous top rows are marked unknown, not zero.
- Cache TTL is six hours. A failed refresh may use a successful snapshot up to
  24 hours old, clearly marked stale. Successful empty reports clear old hints.
- Snapshots and hashes live under `data/audience`; `runs.audience_checkpoint`
  binds a run to its snapshot and selected topic. Resume retains that topic and
  rechecks market sources using the existing verification path.
- `connect_composio_channels.py audience` performs a bounded read probe without
  posting, initializing Google accounts, or creating a spreadsheet.

## Website configuration

`GOOGLE_SITE_VERIFICATION` renders the Search Console ownership meta tag.
`NEXT_PUBLIC_GA4_MEASUREMENT_ID` enables aggregate public page measurement once
it is set to a real `G-…` web stream ID. No placeholder IDs are enabled.

Before enabling the measurement ID, disable **automatic page views on browser
history changes** in the GA4 web stream's Enhanced Measurement settings. The
website sends explicit page views and disables the automatic config page view;
enabling history measurement simultaneously would duplicate navigation events.

The tracking component records only price, article, guide and gold-tool pages.
It excludes account, ledger, AI, admin and payment routes, strips query/hash data,
uses fixed public page titles, and never sends user IDs, questions or transactions.
No event is sent from localhost or preview deployments. Automatic Google events
are disabled while a private route is active.

## Setup and verification

1. Reuse an existing property for `https://www.vanghomnay.online/` when accessible.
2. Deploy the real ownership meta tag, verify in Search Console, then submit
   `/sitemap.xml` and `/news-sitemap.xml` through Composio.
3. Create/reuse a GA4 property with Asia/Ho_Chi_Minh timezone and VND currency.
   Save its `properties/…` resource and web stream/measurement IDs in the bot's
   local integration configuration; add the measurement ID to Vercel Production.
4. Verify one page view for initial load and each public navigation, none for
   private routes, and then read the property reports through Composio.
5. Distinguish connected, property readable, tracking observed, and report data
   available. A new property may legitimately have no finalized historical data.

The October 7 live read probe found an unverified Search Console property and no
accessible Analytics property. The bot correctly continued without Google hints.
Acceptance output is retained at
`C:/Users/LENOVO/kim-tuyen-ai/outputs/google-audience-20261007/`.
The fresh run stopped for insufficient independent evergreen sources; the legacy
resume stopped because a re-read publication date disagreed with its saved dossier.
Neither run posted or sent Telegram messages. These are evidence blockers, not
successful end-to-end article acceptance.

## Các bước Google còn cần bạn làm

Thẻ xác minh đã có trên production. Mở Search Console, chọn
`https://www.vanghomnay.online/`, phương thức **Thẻ HTML**, rồi bấm **XÁC MINH**.

Với GA4, dùng cùng tài khoản Google đang nối Composio:

1. Mở [Google Analytics](https://analytics.google.com/), chọn **Bắt đầu đo lường**
   nếu chưa có tài khoản. Đặt tên tài khoản `Kim Tuyến`.
2. Tạo tài sản `Vanghomnay.online`, chọn múi giờ Việt Nam và tiền tệ VND.
   Hoàn tất thông tin doanh nghiệp và tự chấp nhận điều khoản Google khi được hỏi.
3. Tạo luồng **Web**, địa chỉ `https://www.vanghomnay.online/`, tên `Kim Tuyến Web`.
4. Tắt đo lường nâng cao tự động trước khi bật mã đo lường trên website để tránh
   lượt xem tự động trùng với lượt xem do ứng dụng gửi.
5. Gửi **mã tài sản** (số) và **mã đo lường** dạng `G-…`. Chưa cần dán thêm script
   vào website; phần mã đã triển khai sẽ được bật bằng cấu hình Vercel.

Tham khảo [hướng dẫn thiết lập chính thức](https://support.google.com/analytics/answer/9304153?hl=vi).
