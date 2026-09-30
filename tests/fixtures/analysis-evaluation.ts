import type { AnalysisIntent } from '@/lib/analysis/intent';
type Case = {
  question: string;
  kind: AnalysisIntent['kind'];
  scope: AnalysisIntent['scope'];
  history?: string;
};
export const analysisEvaluation: Case[] = [
  {
    question:
      'So với hôm qua thì đâu là loại vàng biến động lớn nhất về giá mua vào',
    kind: 'comparison',
    scope: 'market',
  },
  {
    question: 'SJC loại nào biến động mạnh nhất hôm qua?',
    kind: 'comparison',
    scope: 'companies',
  },
  {
    question: 'So sanh gia mua vao PNJ va DOJI',
    kind: 'comparison',
    scope: 'companies',
  },
  {
    question: 'Loại vàng nhẫn nào tăng mạnh nhất theo phần trăm?',
    kind: 'comparison',
    scope: 'market',
  },
  {
    question: 'Xếp hạng giá bán ra các thương hiệu',
    kind: 'comparison',
    scope: 'market',
  },
  {
    question: 'Giá mua vào loại nào cao nhất?',
    kind: 'comparison',
    scope: 'market',
  },
  {
    question: 'Nhẫn PNJ và nhẫn SJC loại nào rẻ nhất?',
    kind: 'comparison',
    scope: 'companies',
  },
  {
    question: 'So sánh vàng miếng BTMC và Phú Quý hôm qua',
    kind: 'comparison',
    scope: 'companies',
  },
  {
    question: 'Top 5 loại vàng biến động hôm nay',
    kind: 'comparison',
    scope: 'market',
  },
  {
    question: 'Còn giá bán ra thì sao?',
    history: 'So sánh PNJ và DOJI hôm qua',
    kind: 'comparison',
    scope: 'companies',
  },
  {
    question: 'Giá mua vào hiện tại bao nhiêu?',
    kind: 'lookup',
    scope: 'selected',
  },
  { question: 'Spread là gì?', kind: 'lookup', scope: 'selected' },
  { question: 'MA7 có ý nghĩa gì?', kind: 'lookup', scope: 'selected' },
  { question: 'Giá vàng bán ra hôm nay?', kind: 'lookup', scope: 'selected' },
  {
    question: 'Mua 2 lượng bán lại ngay lỗ bao nhiêu?',
    kind: 'investment',
    scope: 'selected',
  },
  {
    question: 'Tính điểm hòa vốn sau phí giao dịch',
    kind: 'investment',
    scope: 'selected',
  },
  {
    question: 'Tôi có giá vốn 150 triệu một lượng, tính lãi lỗ',
    kind: 'investment',
    scope: 'selected',
  },
  {
    question: 'Vàng mua 100 triệu giờ cửa hàng mua lại 99 triệu, lỗ bao nhiêu?',
    kind: 'investment',
    scope: 'selected',
  },
  {
    question: 'Tính chi phí giao dịch 5 lượng vàng',
    kind: 'investment',
    scope: 'selected',
  },
  {
    question: 'Với mức phí 200 nghìn, điểm hòa vốn là gì?',
    kind: 'investment',
    scope: 'selected',
  },
  {
    question: 'Tại sao giá vàng tăng hôm nay?',
    kind: 'macro',
    scope: 'selected',
  },
  {
    question: 'Fed tác động tới vàng thế nào?',
    kind: 'macro',
    scope: 'selected',
  },
  {
    question: 'Tin mới về chính sách quản lý vàng',
    kind: 'macro',
    scope: 'selected',
  },
  {
    question: 'CPI Mỹ mới nhất ảnh hưởng vàng Việt Nam?',
    kind: 'macro',
    scope: 'selected',
  },
  { question: 'Triển vọng 6 tháng của vàng', kind: 'macro', scope: 'selected' },
  { question: 'Xu huong vang thang toi', kind: 'macro', scope: 'selected' },
  {
    question: 'Tỷ giá USD và giá vàng quốc tế mới nhất',
    kind: 'macro',
    scope: 'selected',
  },
  {
    question: 'Lãi suất hiện nay làm vàng hấp dẫn hơn không?',
    kind: 'macro',
    scope: 'selected',
  },
  {
    question: 'Phân tích sâu các kịch bản giá vàng năm tới',
    kind: 'macro',
    scope: 'selected',
  },
  {
    question: 'Nhu cầu ETF vàng mới nhất là gì?',
    kind: 'macro',
    scope: 'selected',
  },
  {
    question: 'Phân bổ vốn 500 triệu vào vàng thế nào?',
    kind: 'investment',
    scope: 'selected',
  },
  {
    question: 'Tôi cần tiền mặt sau 3 tháng, nên mua vàng không?',
    kind: 'investment',
    scope: 'selected',
  },
  {
    question: 'Tôi chịu rủi ro thấp, có nên mua ngay?',
    kind: 'investment',
    scope: 'selected',
  },
  {
    question: 'Lập kịch bản lãi lỗ cho danh mục đang giữ',
    kind: 'investment',
    scope: 'selected',
  },
  {
    question: 'Tích lũy mỗi tháng hay giải ngân một lần?',
    kind: 'investment',
    scope: 'selected',
  },
  {
    question: 'Tôi muốn giữ tiền, cân nhắc thanh khoản',
    kind: 'investment',
    scope: 'selected',
  },
  {
    question: 'Với hồ sơ của tôi và tin Fed mới nhất, nên mua không?',
    kind: 'macro',
    scope: 'selected',
  },
  {
    question: 'So sánh mua ngay và chờ thêm',
    kind: 'investment',
    scope: 'selected',
  },
  {
    question: 'Viết code trò chơi bóng đá',
    kind: 'out-of-scope',
    scope: 'selected',
  },
  { question: 'Công thức nấu phở', kind: 'out-of-scope', scope: 'selected' },
];
