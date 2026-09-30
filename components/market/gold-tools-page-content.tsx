'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import { ComparePanel } from '@/components/market/compare-panel';
import { ConverterPanel } from '@/components/market/converter-panel';
import { ToolPage } from '@/components/tool-page';
import { useLocale } from '@/components/locale-provider';

type ToolIntent = 'buy' | 'sell' | 'profit';

function intentFromTool(tool?: 'lai-lo' | 'so-sanh'): ToolIntent {
  return tool === 'lai-lo' ? 'profit' : 'buy';
}

export function GoldToolsPageContent({
  tool,
  queryKey,
}: {
  tool?: 'lai-lo' | 'so-sanh';
  queryKey: string;
}) {
  const { locale } = useLocale();
  const english = locale === 'en';
  // Explicit tool URLs remain combined so old share links keep both panels.
  const legacyCombined = Boolean(tool);
  const [intent, setIntent] = useState<ToolIntent>(() => intentFromTool(tool));

  useEffect(() => {
    if (tool) return;
    const timer = window.setTimeout(() => {
      const hash = window.location.hash;
      if (hash === '#hoa-von') setIntent('profit');
      if (hash === '#so-sanh') setIntent('buy');
    }, 0);
    return () => window.clearTimeout(timer);
  }, [tool]);

  const chooseIntent = (next: ToolIntent) => {
    setIntent(next);
    window.setTimeout(() => {
      document
        .getElementById(next === 'profit' ? 'hoa-von' : 'so-sanh')
        ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 0);
  };

  const showCompare = legacyCombined || intent !== 'profit';
  const showCalculator = legacyCombined || intent === 'profit';
  const compareDirection = intent === 'sell' ? 'sell' : 'buy';

  return (
    <ToolPage
      eyebrow={
        english
          ? 'Free tools · Decisions with context'
          : 'Công cụ miễn phí · Quyết định có cơ sở'
      }
      title={english ? 'Gold tools' : 'Công cụ vàng'}
      description={
        english
          ? 'Choose what you want to do first. We will ask only for the information needed for that answer.'
          : 'Chọn việc bạn muốn làm trước. Hệ thống chỉ hỏi những thông tin cần thiết để trả lời.'
      }
    >
      <section
        className="glass-panel mb-6 p-5 sm:p-7"
        aria-labelledby="tool-intent-title"
      >
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-primary">
          {english ? 'Start here' : 'Bắt đầu tại đây'}
        </p>
        <h2
          id="tool-intent-title"
          className="mt-2 font-heading text-2xl font-semibold sm:text-3xl"
        >
          {english ? 'What do you want to do with gold?' : 'Bạn muốn làm gì với vàng?'}
        </h2>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
          {english
            ? 'Choose one. You can change your choice later without losing your entries.'
            : 'Chọn một mục. Bạn có thể đổi lựa chọn sau mà không mất dữ liệu đã nhập.'}
        </p>
        <div
          className="mt-5 grid gap-3 sm:grid-cols-3"
        >
          {([
            [
              'buy',
              english ? 'I want to buy gold' : 'Tôi muốn mua vàng',
              english ? 'See the amount you need to pay.' : 'Xem số tiền bạn cần trả.',
            ],
            [
              'sell',
              english ? 'I want to sell gold' : 'Tôi muốn bán vàng',
              english
                ? 'See the amount a dealer may pay you.'
                : 'Xem số tiền cửa hàng có thể trả bạn.',
            ],
            [
              'profit',
              english ? 'Calculate profit or loss' : 'Tính lời hoặc lỗ',
              english
                ? 'Compare what you paid with today’s buyback price.'
                : 'So sánh số đã trả với giá cửa hàng mua lại.',
            ],
          ] as const).map(([value, title, description]) => (
            <button
              key={value}
              type="button"
              aria-pressed={intent === value}
              onClick={() => chooseIntent(value)}
              className={
                'min-h-24 rounded-2xl border p-4 text-left transition-colors ' +
                (intent === value
                  ? 'border-primary bg-primary/10 shadow-sm'
                  : 'border-border bg-card/60 hover:bg-card')
              }
            >
              <span className="block text-base font-semibold">{title}</span>
              <span className="mt-1 block text-sm leading-5 text-muted-foreground">
                {description}
              </span>
            </button>
          ))}
        </div>
        <details className="mt-4 rounded-xl border border-border/70 bg-card/40 p-4">
          <summary className="cursor-pointer text-sm font-semibold">
            {english
              ? 'I do not know which gold type I have'
              : 'Tôi chưa rõ mình đang có loại vàng nào'}
          </summary>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            {english
              ? 'Check the receipt or product label. “9999 ring” means plain ring gold; “SJC bar” means an SJC gold bar. If the receipt is unclear, ask the dealer before using an estimate.'
              : 'Xem hóa đơn hoặc nhãn sản phẩm. “Nhẫn 9999” là vàng nhẫn trơn; “Vàng miếng SJC” là miếng SJC. Nếu hóa đơn không rõ, hãy hỏi cửa hàng trước khi dùng giá ước tính.'}
          </p>
        </details>
      </section>

      {legacyCombined ? (
        <nav
          className="tool-jump-nav mb-6 flex flex-wrap gap-2"
          aria-label={english ? 'Go to a tool' : 'Đi tới công cụ'}
        >
          <Link
            href="#so-sanh"
            className="min-h-11 rounded-full border border-border bg-card/70 px-4 py-2 text-sm font-semibold hover:bg-card"
          >
            {english ? 'Compare gold prices' : 'So sánh giá vàng'}
          </Link>
          <Link
            href="#hoa-von"
            className="min-h-11 rounded-full border border-primary/30 bg-primary/10 px-4 py-2 text-sm font-semibold text-primary hover:bg-primary/15"
          >
            {english ? 'Profit, loss, and break-even' : 'Tính lãi/lỗ và hòa vốn'}
          </Link>
        </nav>
      ) : null}

      <section
          id="so-sanh"
          hidden={!showCompare}
          className="tool-anchor space-y-6"
          aria-labelledby="gold-comparison-title"
        >
          <div className="max-w-3xl">
            <p className="tool-eyebrow">
              <span aria-hidden="true" />
              {english
                ? 'Step 1 of 3 · Compare before buying or selling'
                : 'Bước 1/3 · Đối chiếu trước khi mua hoặc bán'}
            </p>
            <h2
              id="gold-comparison-title"
              className="mt-3 font-heading text-2xl font-semibold tracking-tight sm:text-3xl"
            >
              {english ? 'Compare gold prices' : 'So sánh giá vàng'}
            </h2>
            <p className="mt-2 text-base font-semibold text-primary">
              {intent === 'sell'
                ? english
                  ? 'Find the best buyback price'
                  : 'Tìm nơi mua lại giá tốt'
                : english
                  ? 'Find the price you pay'
                  : 'Tìm nơi bạn cần trả ít nhất'}
            </p>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              {english
                ? 'Choose the gold group, enter your quantity, and compare equivalent products.'
                : 'Chọn nhóm vàng, nhập khối lượng và so sánh các sản phẩm tương đương.'}
            </p>
          </div>
          <ComparePanel
            key={compareDirection}
            readQueryParams={tool !== 'lai-lo'}
            queryKey={queryKey}
            initialShowAll
            initialDirection={compareDirection}
          />
          <section
            className="glass-panel p-5 sm:p-7"
            aria-labelledby="comparison-topics"
          >
            <h3 id="comparison-topics" className="font-heading text-xl font-semibold">
              {english ? 'Choose a gold group' : 'Chọn nhóm vàng'}
            </h3>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              {english
                ? 'Compare like with like. Rings and SJC bars have different conditions and are shown side by side without a shared “cheapest” rank.'
                : 'So sánh cùng một mặt bằng. Nhẫn và vàng miếng SJC có điều kiện khác nhau nên chỉ được đặt cạnh nhau, không xếp chung “rẻ nhất”.'}
            </p>
            <div className="mt-5 grid gap-3 sm:grid-cols-3">
              <Link
                href="/so-sanh/nhan-9999"
                className="min-h-20 rounded-[18px] border border-border bg-card/70 p-4 transition-colors hover:bg-card"
              >
                <p className="text-base font-semibold">
                  {english ? '9999 plain rings' : 'Nhẫn trơn 9999'}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {english ? 'For accumulation.' : 'Dành cho tích lũy.'}
                </p>
              </Link>
              <Link
                href="/so-sanh/vang-mieng-sjc"
                className="min-h-20 rounded-[18px] border border-border bg-card/70 p-4 transition-colors hover:bg-card"
              >
                <p className="text-base font-semibold">
                  {english ? 'SJC gold bars' : 'Vàng miếng SJC'}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {english
                    ? 'The same bar line across dealers.'
                    : 'Cùng dòng miếng tại các nơi bán.'}
                </p>
              </Link>
              <Link
                href="/so-sanh/nhan-9999-va-vang-mieng-sjc"
                className="min-h-20 rounded-[18px] border border-border bg-card/70 p-4 transition-colors hover:bg-card"
              >
                <p className="text-base font-semibold">
                  {english ? 'Rings and bars' : 'Nhẫn và miếng'}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {english ? 'Understand the difference.' : 'Hiểu khác nhau trước khi chọn.'}
                </p>
              </Link>
            </div>
          </section>
        </section>

      <section
          id="hoa-von"
          hidden={!showCalculator}
          className="tool-anchor mt-12 space-y-6"
          aria-labelledby="gold-calculator-title"
        >
          <div className="max-w-3xl">
            <p className="tool-eyebrow">
              <span aria-hidden="true" />
              {english
                ? 'Step 2 of 3 · Use your real transaction'
                : 'Bước 2/3 · Dùng giao dịch thực tế của bạn'}
            </p>
            <h2
              id="gold-calculator-title"
              className="mt-3 font-heading text-2xl font-semibold tracking-tight sm:text-3xl"
            >
              {english ? 'Profit, loss, and break-even' : 'Tính lãi/lỗ và hòa vốn'}
            </h2>
            <p className="mt-2 text-base font-semibold text-primary">
              {english
                ? 'See what you may receive after selling fees'
                : 'Xem số tiền bạn có thể nhận sau phí bán'}
            </p>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              {english
                ? 'Enter what you actually paid. The result is an estimate and does not include conditions a dealer may apply at the counter.'
                : 'Nhập số tiền bạn đã trả thật. Kết quả là ước tính và chưa bao gồm điều kiện riêng của cửa hàng khi giao dịch.'}
            </p>
          </div>
          <ConverterPanel
            readQueryParams={tool !== 'so-sanh'}
            sectionId="gold-calculator"
            queryKey={queryKey}
          />
        </section>
    </ToolPage>
  );
}
