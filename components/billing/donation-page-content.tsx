'use client';

import { DonationPanel } from '@/components/billing/donation-panel';
import { useLocale } from '@/components/locale-provider';
import { ToolPage } from '@/components/tool-page';

export function DonationPageContent() {
  const { locale } = useLocale();
  const english = locale === 'en';
  return (
    <ToolPage
      eyebrow={english ? 'From the community · For the community' : 'Từ cộng đồng · Dành cho cộng đồng'}
      title={english ? 'Keep a transparent view of gold' : 'Cùng giữ góc nhìn vàng minh bạch'}
      description={english ? 'Every contribution helps Kim Tuyến remain useful. Support is entirely voluntary and does not unlock features or add AI usage.' : 'Mỗi đóng góp giúp Kim Tuyến tiếp tục hữu ích. Ủng hộ hoàn toàn tự nguyện, không mở khóa tính năng hay cộng lượt AI.'}
    >
      <DonationPanel />
      <p className="mt-6 text-center text-xs leading-5 text-muted-foreground">
        {english
          ? 'Contributions are reconciled through SePay. This is not a gold trade or a promise of returns.'
          : 'Khoản ủng hộ được đối soát qua SePay. Đây không phải giao dịch mua bán vàng hay cam kết lợi nhuận.'}
      </p>
    </ToolPage>
  );
}
