import type { AnalysisRequest } from './provider';
import { answerFocus, comparisonRows } from './focus';
import { resolveIntent } from './intent';
import { buildAnalysisFacts } from './response';

/** The limited response follows the same question focus as the model prompt. */
export function focusedFactualAnswer(request: AnalysisRequest) {
  const english = request.locale === 'en';
  const intent = request.intent ?? resolveIntent(request.question);
  const focus = answerFocus(request.question, intent, request.goal);
  const context = request.marketContext;
  if (focus === 'forecast')
    return english
      ? 'The reference ranges and their availability are shown above. They are historical estimates; current news could not be verified.'
      : 'Khoảng tham chiếu và tình trạng dữ liệu được hiển thị ở trên. Đây là ước tính từ lịch sử; chưa xác minh được tin mới để giải thích thêm.';
  if (focus === 'market')
    return english
      ? 'Current information could not be verified, so there is not enough evidence to explain this market move.'
      : 'Chưa xác minh được thông tin cập nhật nên chưa đủ căn cứ để giải thích diễn biến bạn hỏi.';
  if (!context?.eligible)
    return english
      ? 'There is not enough current price data to answer this question.'
      : 'Chưa có đủ giá hiện tại để trả lời câu hỏi này.';
  if (focus === 'comparison') {
    const rows = comparisonRows(
      context.ranking,
      intent.depth === 'deep' ? 10 : 5,
    );
    const fmt = (value: number | null) =>
      value === null
        ? '—'
        : new Intl.NumberFormat(english ? 'en-US' : 'vi-VN', {
            maximumFractionDigits: 4,
          }).format(value);
    const side =
      intent.side === 'buy'
        ? english
          ? 'Dealer buy'
          : 'Giá mua vào'
        : english
          ? 'Dealer sell'
          : 'Giá bán ra';
    const heading = english ? 'Product' : 'Sản phẩm';
    const table = rows.map((rank) => {
      const row = context.rows.find((entry) => entry.key === rank.key);
      return `| ${rank.label} | ${fmt(row?.comparison?.today ?? null)} |${intent.daily ? ` ${fmt(rank.change)} |` : ''}`;
    });
    const coverage = english
      ? `${context.eligible}/${context.requested} groups have usable data on ${context.today}; VND million/lượng.`
      : `${context.eligible}/${context.requested} nhóm đủ dữ liệu ngày ${context.today}; đơn vị triệu đồng/lượng.`;
    return `${coverage}${intent.daily ? ` ${english ? 'Compared with' : 'Đối chiếu'} ${context.yesterday}.` : ''}\n\n| ${heading} | ${side} |${intent.daily ? ` ${english ? 'Change' : 'Thay đổi'} |` : ''}\n| --- | ---: |${intent.daily ? ' ---: |' : ''}\n${table.join('\n')}`;
  }
  const facts = buildAnalysisFacts(
    context,
    intent,
    request.goal,
    request.locale,
    undefined,
    request.question,
  );
  if ((focus === 'hold' || focus === 'buy') && facts.facts.length)
    return english
      ? 'The figures below are calculated from the available dealer quotes and the details you supplied. The AI explanation is currently unavailable.'
      : 'Các số liệu bên dưới được tính theo giá niêm yết và thông tin bạn đã khai. Hiện chưa có phần giải thích từ AI.';
  const row = context.rows.find(
    (entry) => entry.exclusion === null && entry.comparison,
  );
  if (!row?.comparison)
    return english
      ? 'There is not enough matching price data.'
      : 'Chưa đủ dữ liệu giá phù hợp.';
  return english
    ? `The available quote for **${row.label}** is shown below, as of ${row.observedAt}.`
    : `Giá niêm yết của **${row.label}** được hiển thị bên dưới, ghi nhận ${row.observedAt}.`;
}
