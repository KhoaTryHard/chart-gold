import nextEnv from '@next/env';

nextEnv.loadEnvConfig(process.cwd());

const { and, eq } = await import('drizzle-orm');
const { getDatabase } = await import('@/db');
const { articleRevisions, articles } = await import('@/db/schema');

const accessedAt = new Date().toISOString();
const sources = {
  sjc: { title: 'SJC — bảng giá vàng', url: 'https://sjc.com.vn/xml/tygiavang.xml', accessedAt },
  gold: { title: 'World Gold Council — Goldhub', url: 'https://www.gold.org/goldhub', accessedAt },
  fed: { title: 'Federal Reserve — Monetary Policy', url: 'https://www.federalreserve.gov/monetarypolicy.htm', accessedAt },
  pnj: { title: 'PNJ — thông tin vàng', url: 'https://www.pnj.com.vn/blog/gia-vang/', accessedAt },
};

const content: Array<{ title: string; body: string; sourceKeys: Array<keyof typeof sources>; evidence?: Array<{ label: string; value: string; sourceUrl?: string; observedAt?: string }> }> = [
  {
    title: 'Nhịp vàng hôm nay: đọc giá mua vào, bán ra và biên chênh lệch',
    body: `## Đọc nhanh bảng giá\n\nKhi xem một bảng giá vàng, hãy tách ba con số: **mua vào** là mức cửa hàng dự kiến trả khi mua lại, **bán ra** là mức bạn trả khi mua, còn **biên mua–bán** là khoảng chi phí cần vượt qua nếu giao dịch trong thời gian ngắn.\n\nĐơn vị và thời điểm phải đi cùng con số. Giá theo lượng không thể so trực tiếp với giá theo chỉ nếu chưa quy đổi; giá dự phòng cũng không nên gọi là giá hiện tại.\n\n## Cách dùng cho quyết định thực tế\n\n- Nếu bạn chuẩn bị mua, đối chiếu giá bán ra của cùng nhóm sản phẩm.\n- Nếu bạn chuẩn bị bán, hỏi lại giá mua vào áp dụng cho đúng sản phẩm, khu vực và hóa đơn.\n- Ghi lại thời điểm quan sát; bảng giá có thể thay đổi sau vài phút.\n\nSố liệu trong bài là ảnh chụp tại thời điểm ghi nhận, không phải dự báo. Xem [bảng giá Kim Tuyến](/) để đối chiếu dữ liệu mới nhất.`,
    sourceKeys: ['sjc'],
  },
  {
    title: 'Biên mua bán vàng nói gì về chi phí giao dịch?',
    body: `## Spread là gì?\n\nSpread = giá bán ra − giá mua vào của cùng một sản phẩm. Nếu mua rồi bán lại ngay, giá vàng phải tăng vượt spread và các khoản phí liên quan thì giao dịch mới bắt đầu hòa vốn.\n\n## Ví dụ minh họa\n\nGiả sử giá bán ra là 148 triệu đồng/lượng và giá mua vào là 145 triệu đồng/lượng. Spread là 3 triệu đồng/lượng, tương đương khoảng 2,03% so với giá bán ra. Đây là ví dụ tính toán, không phải báo giá hiện tại.\n\nSpread giữa các thương hiệu chỉ có ý nghĩa khi sản phẩm, đơn vị, khu vực và điều kiện thu mua tương đương. Không nên xếp “rẻ nhất” giữa nhẫn 9999 và vàng miếng SJC.\n\nBạn có thể dùng [Công cụ vàng](/cong-cu-vang#so-sanh) để xem các mức giá cùng nhóm.`,
    sourceKeys: ['sjc', 'pnj'],
  },
  {
    title: 'Tính hòa vốn sau phí: ví dụ với một lượng vàng',
    body: `## Công thức\n\nGiá thu mua hòa vốn mỗi lượng = (tổng tiền mua + phí mua + phí bán) ÷ tổng khối lượng. Với nhiều lần mua, cần cộng từng khoản thực trả rồi mới chia cho tổng khối lượng quy đổi.\n\n## Ví dụ\n\nBạn mua 1 lượng với giá 145 triệu đồng và trả 200.000 đồng phí mua, không có phí bán. Giá hòa vốn là 145,2 triệu đồng/lượng. Nếu cửa hàng mua lại thấp hơn mức này, giao dịch đang lỗ theo các giả định đã nhập.\n\nĐây là ví dụ minh họa để kiểm tra cách tính; hóa đơn, điều kiện thu mua và tình trạng sản phẩm có thể làm kết quả thực tế khác đi. [Mở máy tính lãi/lỗ](/cong-cu-vang#hoa-von).`,
    sourceKeys: ['sjc'],
  },
  {
    title: 'Bán vàng khác nơi mua: bốn điểm cần xác nhận',
    body: `## Đừng chỉ hỏi một con số\n\nKhi bán ở nơi khác, hãy xác nhận bốn điểm: cửa hàng có nhận đúng sản phẩm không, giá mua vào áp dụng cho đúng quy cách là bao nhiêu, có yêu cầu hóa đơn hoặc kiểm định không, và khoản khấu trừ nào được tính thêm.\n\nGiá của sản phẩm khác thương hiệu hoặc khác nhóm không phải là giá thu mua thay thế. Nếu nguồn không có báo giá đúng sản phẩm, hãy nhập giá cửa hàng báo vào [Công cụ vàng](/cong-cu-vang#hoa-von) thay vì suy ra từ một dòng khác.\n\nGhi lại tên cửa hàng và thời điểm báo giá để có thể đối chiếu khi giao dịch.`,
    sourceKeys: ['sjc', 'pnj'],
  },
  {
    title: 'USD và lãi suất tác động đến vàng qua những kênh nào?',
    body: `## Ba kênh thường gặp\n\nĐồng USD và lãi suất có thể ảnh hưởng đến vàng thông qua sức mua của nhà đầu tư quốc tế, chi phí cơ hội của tài sản không sinh lãi và kỳ vọng về chính sách tiền tệ. Quan hệ này không phải lúc nào cũng đi cùng một chiều; rủi ro địa chính trị, dòng tiền và cung cầu cũng có thể chi phối.\n\nKhi đọc tin, hãy tách dữ kiện đã công bố khỏi suy luận về giá tương lai. Một quyết định mua hoặc bán không nên dựa trên một tiêu đề hoặc một biến số duy nhất.\n\nNguồn chính sách cần xem ở [Federal Reserve](https://www.federalreserve.gov/monetarypolicy.htm) và dữ liệu vàng ở [World Gold Council](https://www.gold.org/goldhub); các liên kết chỉ là điểm bắt đầu để kiểm tra, không phải lời khuyên đầu tư.`,
    sourceKeys: ['fed', 'gold'],
  },
  {
    title: 'Đọc giá dự phòng: khi nào nên chờ dữ liệu chính thức?',
    body: `## Phân biệt trạng thái dữ liệu\n\nGiá trực tiếp có thời điểm quan sát và nguồn đang phản hồi. Snapshot hoặc dữ liệu dự phòng giúp giao diện không trống khi nguồn tạm lỗi, nhưng không nên dùng để khẳng định giá hiện tại.\n\nNếu bài viết hoặc bảng giá ghi “dự phòng”, hãy xem đó là mốc tham khảo lịch sử. Khi chuẩn bị giao dịch, mở lại nguồn chính thức, hỏi cửa hàng và ghi nhận giá áp dụng tại thời điểm thực hiện.\n\nKim Tuyến hiển thị trạng thái nguồn cạnh dữ liệu để người đọc biết phần nào đã được xác minh.`,
    sourceKeys: ['sjc'],
  },
];

const db = getDatabase();
for (const item of content) {
  const [article] = await db.select().from(articles).where(eq(articles.slug, item.title.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 160))).limit(1);
  if (!article) continue;
  const [revision] = await db.select().from(articleRevisions).where(and(eq(articleRevisions.articleId, article.id), eq(articleRevisions.status, 'draft'))).orderBy(articleRevisions.createdAt).limit(1);
  if (!revision) continue;
  await db.update(articleRevisions).set({ contentMarkdown: item.body, excerpt: 'Bản nháp thực hành dựa trên dữ kiện và nguồn được ghi rõ; cần biên tập viên kiểm tra trước khi xuất bản.', sources: item.sourceKeys.map((key) => sources[key]), evidence: [] }).where(eq(articleRevisions.id, revision.id));
}
process.stdout.write(JSON.stringify({ enriched: content.length }) + '\n');
