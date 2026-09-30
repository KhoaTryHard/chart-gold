export type ComparisonLanding = {
  slug: string;
  set: 'sjc-bar' | 'ring-9999' | 'ring-9999-vs-sjc';
  title: string;
  description: string;
  eyebrow: string;
  intro: string;
  method: string[];
  limits: string[];
  faqs: Array<{ question: string; answer: string }>;
};

/**
 * Editorial landing pages are intentionally finite. Query-string filters stay
 * canonical to these pages so the site does not publish a page for every
 * possible combination of brand, region or quantity.
 */
export const comparisonLandings: readonly ComparisonLanding[] = [
  {
    slug: 'nhan-9999',
    set: 'ring-9999',
    eyebrow: 'Tích lũy vàng · Nhẫn trơn 9999',
    title: 'So sánh giá nhẫn trơn 9999 giữa các thương hiệu',
    description:
      'Đối chiếu giá mua vào, bán ra và chênh lệch của nhẫn trơn 9999 từ các nguồn đang có dữ liệu hai chiều.',
    intro:
      'Trang này dành cho người tích lũy vàng muốn nhìn cùng một nhóm nhẫn trơn 9999 trên một mặt bằng. Kim Tuyến chỉ xếp hạng những dòng có đủ giá mua và bán, đồng thời hiển thị nguồn và thời điểm quan sát để bạn kiểm tra lại trước giao dịch.',
    method: [
      'Giá mua được xếp từ thấp đến cao; giá bán lại được xếp từ cao đến thấp.',
      'Tổng tiền tham khảo = giá theo lượng × số lượng sau khi quy đổi chỉ hoặc gram.',
      'Chênh lệch thành tiền chỉ phản ánh các dòng đang được chọn và chưa gồm phí, công hay điều kiện chi nhánh.',
    ],
    limits: [
      'Các thương hiệu có thể áp dụng điều kiện thu mua, tình trạng sản phẩm và khu vực khác nhau.',
      'Quy cách 0,5 chỉ, 1 chỉ, 2 chỉ và 5 chỉ là phép quy đổi tham khảo khi nguồn chỉ công bố giá theo lượng.',
      'Dữ liệu thiếu một chiều hoặc dùng giá dự phòng không được gọi là lựa chọn rẻ nhất/tốt nhất.',
    ],
    faqs: [
      {
        question: 'Giá nhẫn 9999 nào rẻ nhất?',
        answer:
          'Bảng chỉ trả lời trong các dòng có đủ dữ liệu hai chiều tại thời điểm quan sát. Hãy xem cột nguồn, thời điểm và điều kiện thu mua trước khi kết luận.',
      },
      {
        question: 'Mua 2 chỉ thì chênh lệch được tính thế nào?',
        answer:
          'Giá chênh theo lượng được nhân với 0,2 lượng. Ví dụ chênh 200.000 đồng mỗi lượng tương đương 40.000 đồng cho 2 chỉ, trước phí.',
      },
    ],
  },
  {
    slug: 'vang-mieng-sjc',
    set: 'sjc-bar',
    eyebrow: 'Cùng dòng sản phẩm · Vàng miếng SJC',
    title: 'So sánh giá vàng miếng SJC tại các đơn vị',
    description:
      'Xem giá vàng miếng SJC theo cùng quy cách, đối chiếu biên mua–bán và nguồn công bố tại từng đơn vị.',
    intro:
      'Khi so sánh vàng miếng SJC, cùng tên sản phẩm vẫn có thể đi kèm khác biệt về khu vực và điều kiện thu mua. Bảng dưới đây giúp bạn xem nhanh giá niêm yết, spread và trạng thái dữ liệu của từng nguồn.',
    method: [
      'Chỉ xếp hạng các dòng được nhận diện là vàng miếng SJC và có đủ giá mua/bán.',
      'Mua vàng dùng giá bán ra; bán vàng dùng giá mua vào.',
      'Giá trị theo số lượng được quy đổi từ đơn vị bạn chọn về lượng.',
    ],
    limits: [
      'Nguồn tổng hợp có thể trễ hơn bảng giá tại cửa hàng.',
      'Không suy ra còn hàng, phí vận chuyển hay mức giá áp dụng cho mọi chi nhánh.',
      'Hai dòng cùng thuộc một nguồn báo giá không được tính thành hai lựa chọn độc lập.',
    ],
    faqs: [
      {
        question: 'Vì sao giá SJC giữa các đơn vị khác nhau?',
        answer:
          'Mỗi đơn vị có chính sách cung cầu, khu vực và điều kiện thu mua riêng. Kim Tuyến hiển thị các mức niêm yết cạnh nhau để bạn xác nhận trực tiếp.',
      },
      {
        question: 'Spread có ý nghĩa gì?',
        answer:
          'Spread là chênh giữa giá bán ra và giá mua vào của cùng dòng. Spread lớn làm tăng chi phí khi mua rồi bán lại trong thời gian ngắn.',
      },
    ],
  },
  {
    slug: 'nhan-9999-va-vang-mieng-sjc',
    set: 'ring-9999-vs-sjc',
    eyebrow: 'Đối chiếu khác nhóm · Hiểu trước khi chọn',
    title: 'Nhẫn 9999 và vàng miếng SJC khác nhau thế nào?',
    description:
      'Đặt nhẫn trơn 9999 cạnh vàng miếng SJC để xem chênh lệch giá, quy cách và điều kiện giao dịch mà không gộp thành một bảng xếp hạng.',
    intro:
      'Nhẫn trơn 9999 và vàng miếng SJC đều được nhiều người dùng để tích lũy, nhưng chúng không phải cùng một sản phẩm. Trang này trình bày hai nhóm cạnh nhau, giải thích khác biệt về nhận diện, biên mua–bán và quy cách để bạn tự quyết định.',
    method: [
      'Mỗi nhóm được tính giá tham khảo và spread riêng.',
      'Tổng tiền dùng cùng số lượng sau quy đổi để việc đối chiếu dễ đọc hơn.',
      'Không gắn nhãn rẻ nhất giữa hai nhóm có bản chất, thương hiệu và điều kiện khác nhau.',
    ],
    limits: [
      'Giá tham khảo không thay thế xác nhận của nơi giao dịch.',
      'Hình thức, thương hiệu, hóa đơn và chính sách thu mua có thể ảnh hưởng mức giá thực tế.',
      'Nữ trang, tiền công và đá gắn kèm nằm ngoài phạm vi landing page này.',
    ],
    faqs: [
      {
        question: 'Nên mua nhẫn 9999 hay vàng miếng SJC?',
        answer:
          'Không có một lựa chọn đúng cho mọi người. Hãy cân nhắc mục tiêu tích lũy, quy cách, ngân sách, spread và điều kiện bán lại tại nơi bạn dự định giao dịch.',
      },
      {
        question: 'Có thể so giá hai nhóm bằng cùng số tiền không?',
        answer:
          'Có thể dùng máy Tính lãi/lỗ để ước tính số lượng và giá hòa vốn, nhưng kết quả chỉ là tham khảo vì mỗi nhóm có điều kiện và biên giá riêng.',
      },
    ],
  },
] as const;

export function getComparisonLanding(slug: string) {
  return comparisonLandings.find((landing) => landing.slug === slug);
}

const englishComparisonLandings: Record<string, Omit<ComparisonLanding, 'slug' | 'set'>> = {
  'nhan-9999': {
    eyebrow: 'Gold accumulation · 9999 plain rings',
    title: 'Compare 9999 plain-ring prices across dealers',
    description: 'Compare dealer buy, dealer sell, and spread for 9999 plain rings from sources with two-sided pricing.',
    intro: 'This page is for gold accumulators who want to view comparable 9999 plain rings together. Kim Tuyến ranks only products with both dealer-buy and dealer-sell prices, and shows the source and observation time so you can check again before trading.',
    method: ['Dealer sell prices are ranked low to high for purchases; dealer buy prices are ranked high to low for resale.', 'Reference total = price per lượng × quantity after converting chỉ or grams.', 'The price difference reflects only selected rows and excludes fees, fabrication, and branch conditions.'],
    limits: ['Dealers can apply different buyback conditions, product conditions, and regional rules.', '0.5 chỉ, 1 chỉ, 2 chỉ, and 5 chỉ sizes are reference conversions when a source publishes only per-lượng pricing.', 'A row missing either side of the quote or using fallback data is never called the cheapest or best option.'],
    faqs: [{ question: 'Which 9999 ring is cheapest?', answer: 'The table answers only among rows with two-sided data at the observed time. Check source, observation time, and buyback conditions before deciding.' }, { question: 'How is the difference calculated for 2 chỉ?', answer: 'The per-lượng difference is multiplied by 0.2 lượng. For example, a 200,000 VND difference per lượng equals 40,000 VND for 2 chỉ before fees.' }],
  },
  'vang-mieng-sjc': {
    eyebrow: 'Same product line · SJC gold bars',
    title: 'Compare SJC gold-bar prices across dealers',
    description: 'View matching SJC gold-bar products, compare their buy–sell spread, and review each dealer’s published source.',
    intro: 'When comparing SJC gold bars, the same product name can still involve regional differences and different buyback conditions. This table gives a quick view of listed price, spread, and data status for every source.',
    method: ['Only rows identified as SJC gold bars with both dealer buy and dealer sell prices are ranked.', 'Buyers pay the dealer sell price; sellers receive the dealer buy price.', 'Values are converted from your selected unit to lượng.'],
    limits: ['Aggregated sources can lag a dealer’s own price table.', 'The table does not imply stock availability, delivery fees, or a price available to every branch.', 'Two rows from the same quote source are not counted as two independent choices.'],
    faqs: [{ question: 'Why do SJC prices differ between dealers?', answer: 'Each dealer has its own supply, demand, region, and buyback policy. Kim Tuyến shows listed prices together so you can confirm directly.' }, { question: 'What does spread mean?', answer: 'Spread is the difference between a dealer’s sell and buy price for the same product. A large spread raises the cost of buying and selling back over a short period.' }],
  },
  'nhan-9999-va-vang-mieng-sjc': {
    eyebrow: 'Cross-group comparison · Understand before choosing',
    title: 'How do 9999 rings and SJC gold bars differ?',
    description: 'Place 9999 plain rings beside SJC gold bars to see price, unit, and trading-condition differences without merging them into one ranking.',
    intro: '9999 plain rings and SJC gold bars are both used for accumulation, but they are not the same product. This page presents the groups side by side and explains differences in identity, buy–sell spread, and unit so you can decide for yourself.',
    method: ['Each group has its own reference price and spread.', 'Both groups use the same converted quantity to make the comparison easier to read.', 'Neither group is labelled cheapest because their product, brand, and conditions differ.'],
    limits: ['Reference prices do not replace confirmation from the transaction venue.', 'Form, brand, invoice, and buyback policy can affect the actual price.', 'Jewellery, workmanship, and attached stones are outside this page’s scope.'],
    faqs: [{ question: 'Should I buy a 9999 ring or an SJC gold bar?', answer: 'There is no single correct choice. Consider your accumulation goal, unit, budget, spread, and resale conditions at the venue you plan to use.' }, { question: 'Can I compare both groups at the same amount of money?', answer: 'You can use the profit/loss calculator to estimate quantity and break-even, but the result is reference-only because each group has different terms and price spreads.' }],
  },
};

export function getComparisonLandingForLocale(slug: string, locale: 'vi' | 'en') {
  const landing = getComparisonLanding(slug);
  if (!landing || locale === 'vi') return landing;
  const translation = englishComparisonLandings[slug];
  return translation ? { ...landing, ...translation } : landing;
}
