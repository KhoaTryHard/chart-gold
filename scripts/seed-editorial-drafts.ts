import nextEnv from '@next/env';

nextEnv.loadEnvConfig(process.cwd());

const { inArray } = await import('drizzle-orm');
const { getDatabase } = await import('@/db');
const { articleRevisions } = await import('@/db/schema');
const { createArticleDraft } = await import('@/lib/editorial/admin');

const drafts = [
  ['Nhịp vàng hôm nay: đọc giá mua vào, bán ra và biên chênh lệch', 'news'],
  ['Biên mua bán vàng nói gì về chi phí giao dịch?', 'explain'],
  ['Tính hòa vốn sau phí: ví dụ với một lượng vàng', 'practice'],
  ['Bán vàng khác nơi mua: bốn điểm cần xác nhận', 'practice'],
  ['USD và lãi suất tác động đến vàng qua những kênh nào?', 'explain'],
  ['Đọc giá dự phòng: khi nào nên chờ dữ liệu chính thức?', 'explain'],
] as const;

const db = getDatabase();
const existing = await db.select({ title: articleRevisions.title }).from(articleRevisions).where(inArray(articleRevisions.title, drafts.map(([title]) => title)));
const existingTitles = new Set(existing.map((row) => row.title));
let created = 0;
for (const [title, category] of drafts) {
  if (existingTitles.has(title)) continue;
  await createArticleDraft({
    title,
    category,
    excerpt: 'Bản nháp chờ biên tập viên bổ sung dữ kiện, thời điểm và nguồn trước khi xuất bản.',
    contentMarkdown: `## Mục tiêu bài viết\n\nGiải thích **${title}** bằng dữ liệu có thể kiểm tra.\n\n## Những điểm cần bổ sung\n\n- Đối chiếu số liệu với nguồn chính thức.\n- Ghi rõ thời điểm quan sát và đơn vị.\n- Phân biệt dữ kiện, suy luận và ví dụ minh họa.\n\n> Bản nháp này chưa được xuất bản.`,
    sources: [],
  });
  created++;
}
process.stdout.write(`${JSON.stringify({ created })}\n`);
