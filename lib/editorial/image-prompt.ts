function compact(value: string, limit: number) {
  return value.replace(/\s+/g, ' ').trim().slice(0, limit);
}

export function editorialImagePrompt(input: {
  title: string;
  excerpt: string;
  category: 'news' | 'explain' | 'practice';
  suggestedPrompt?: string | null;
}) {
  const categoryDirection =
    input.category === 'news'
      ? 'một cảnh minh họa khái niệm về chuyển động thị trường vàng'
      : input.category === 'explain'
        ? 'một minh họa biên tập giải thích mối quan hệ kinh tế'
        : 'một minh họa bình tĩnh về quyết định đầu tư vàng có trách nhiệm';
  const suggested = input.suggestedPrompt
    ? ` Chủ đề gợi ý: ${compact(input.suggestedPrompt, 500)}.`
    : '';
  return `Ảnh minh họa biên tập cho bài “${compact(input.title, 160)}”. ${categoryDirection}. Phong cách Nét vàng tối giản, tinh tế, nền trắng ngà và than mực, điểm nhấn vàng trầm, bố cục ngang rộng, không khí tin cậy dành cho nhà đầu tư vàng Việt Nam. ${compact(input.excerpt, 280)}.${suggested} Không có chữ, số, logo, watermark, biểu đồ giá chính xác, thương hiệu vàng, người thật, ảnh sự kiện thật, lá cờ hoặc dữ liệu có thể bị hiểu là sự kiện đã xác thực. Đây là ảnh minh họa khái niệm, không phải ảnh tin tức.`;
}
