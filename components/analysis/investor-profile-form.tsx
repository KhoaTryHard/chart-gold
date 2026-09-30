'use client';

import { useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useLocale } from '@/components/locale-provider';
import {
  MARKET_COMPANIES,
  getDefaultMarketProduct,
  getMarketProducts,
  isMarketProductSelectable,
  presentMarketCompany,
  presentMarketProduct,
} from '@/lib/market-sources';
import {
  investorProfileSchema,
  profileKey,
  readInvestorProfile,
  saveInvestorProfile,
  type InvestorProfile,
} from '@/lib/analysis/investor-profile';

export function InvestorProfileForm({
  account,
  onChange,
  disabled,
}: {
  account: string;
  onChange: (profile: InvestorProfile | undefined) => void;
  disabled: boolean;
}) {
  const { locale } = useLocale();
  const english = locale === 'en';
  const descriptionId = useId();
  const [draft, setDraft] = useState<InvestorProfile>(
    () => readInvestorProfile(account) ?? { holdings: [] },
  );
  const [notice, setNotice] = useState('');
  const copy = english
    ? {
        summary: 'Investment profile · optional',
        description:
          "Saved on this device for this account. The profile is sent with your question to personalize the analysis. Quantities use Vietnam's lượng unit (37.5 g). You can edit or delete it at any time.",
        capital: 'Planned capital (VND)',
        cashNeeded: 'Cash to keep (VND)',
        fees: 'Fee per position (VND)',
        horizon: 'Holding period',
        risk: 'Risk tolerance',
        unspecified: 'Not specified',
        low: 'Low',
        balanced: 'Balanced',
        high: 'High',
        position: 'Position',
        company: 'Brand',
        product: 'Product',
        quantity: 'Quantity (37.5 g units)',
        cost: 'Cost basis (VND per 37.5 g unit)',
        horizonShort: '1–4 weeks',
        horizonMedium: '1–3 months',
        horizonLong: '6–12 months',
        removePosition: 'Remove position',
        removePositionFor: (number: number) => `Remove position ${number}`,
        addPosition: 'Add position',
        save: 'Save profile',
        delete: 'Delete profile',
        invalidProduct: 'A selected holding product is invalid.',
        cashExceedsCapital: 'Cash to keep cannot exceed planned capital.',
        invalidProfile: 'The profile is invalid. Check the entered values.',
        saved: 'Profile saved and applied.',
        saveFailed:
          'Could not save on this device. Check your browser storage permissions.',
        deleted: 'Profile deleted from this device.',
        deleteFailed: 'Could not delete the profile from this device.',
      }
    : {
        summary: 'Hồ sơ đầu tư · tùy chọn',
        description:
          'Chỉ lưu trên thiết bị theo tài khoản. Hồ sơ đã lưu được gửi cùng câu hỏi để cá nhân hóa; bạn có thể sửa hoặc xóa.',
        capital: 'Vốn dự kiến (VNĐ)',
        cashNeeded: 'Tiền cần giữ (VNĐ)',
        fees: 'Phí cho mỗi vị thế (VNĐ)',
        horizon: 'Thời gian nắm giữ',
        risk: 'Mức chịu rủi ro',
        unspecified: 'Chưa xác định',
        low: 'Thấp',
        balanced: 'Cân bằng',
        high: 'Cao',
        position: 'Vị thế',
        company: 'Thương hiệu',
        product: 'Sản phẩm',
        quantity: 'Số lượng (lượng)',
        cost: 'Giá vốn (VNĐ/lượng)',
        horizonShort: '1–4 tuần',
        horizonMedium: '1–3 tháng',
        horizonLong: '6–12 tháng',
        removePosition: 'Bỏ vị thế',
        removePositionFor: (number: number) => `Bỏ vị thế ${number}`,
        addPosition: 'Thêm vị thế',
        save: 'Lưu hồ sơ',
        delete: 'Xóa hồ sơ',
        invalidProduct: 'Sản phẩm nắm giữ không hợp lệ.',
        cashExceedsCapital: 'Tiền cần giữ không được vượt vốn dự kiến.',
        invalidProfile: 'Hồ sơ chưa hợp lệ.',
        saved: 'Đã lưu và áp dụng hồ sơ.',
        saveFailed:
          'Không lưu được trên thiết bị. Kiểm tra quyền lưu trữ của trình duyệt.',
        deleted: 'Đã xóa hồ sơ trên thiết bị.',
        deleteFailed: 'Không thể xóa hồ sơ trên thiết bị.',
      };

  const validationMessage = (message?: string) => {
    if (message === 'Sản phẩm nắm giữ không hợp lệ.')
      return copy.invalidProduct;
    if (message === 'Tiền cần giữ không được vượt vốn dự kiến.')
      return copy.cashExceedsCapital;
    return copy.invalidProfile;
  };

  const numberValue = (value: string) =>
    value === '' ? undefined : Number(value);
  const fieldClass =
    'mt-1 min-h-10 w-full rounded-[14px] border border-input bg-[var(--surface-solid)] px-3 py-1.5 text-xs';
  return (
    <details
      className="rounded-[16px] border border-border bg-card/70 p-3 text-xs"
      aria-describedby={descriptionId}
    >
      <summary className="cursor-pointer font-medium">{copy.summary}</summary>
      <p id={descriptionId} className="mt-2 text-muted-foreground">
        {copy.description}
      </p>
      <form
        className="mt-3 space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          const result = investorProfileSchema.safeParse(draft);
          if (!result.success) {
            setNotice(validationMessage(result.error.issues[0]?.message));
            return;
          }
          try {
            saveInvestorProfile(account, result.data);
            onChange(result.data);
            setNotice(copy.saved);
          } catch {
            setNotice(copy.saveFailed);
          }
        }}
      >
        <fieldset disabled={disabled} className="grid grid-cols-2 gap-3">
          {(
            [
              ['capitalVnd', copy.capital],
              ['cashNeededVnd', copy.cashNeeded],
              ['feesVnd', copy.fees],
            ] as const
          ).map(([key, label]) => (
            <label key={key}>
              {label}
              <input
                className={fieldClass}
                type="number"
                min="0"
                max="1000000000000000"
                step="any"
                value={draft[key] ?? ''}
                onChange={(event) =>
                  setDraft({ ...draft, [key]: numberValue(event.target.value) })
                }
              />
            </label>
          ))}
          <label>
            {copy.horizon}
            <select
              className={fieldClass}
              value={draft.horizon ?? ''}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  horizon:
                    (event.target.value as InvestorProfile['horizon']) ||
                    undefined,
                })
              }
            >
              <option value="">{copy.unspecified}</option>
              <option value="1-4w">{copy.horizonShort}</option>
              <option value="1-3m">{copy.horizonMedium}</option>
              <option value="6-12m">{copy.horizonLong}</option>
            </select>
          </label>
          <label>
            {copy.risk}
            <select
              className={fieldClass}
              value={draft.risk ?? ''}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  risk:
                    (event.target.value as InvestorProfile['risk']) ||
                    undefined,
                })
              }
            >
              <option value="">{copy.unspecified}</option>
              <option value="low">{copy.low}</option>
              <option value="balanced">{copy.balanced}</option>
              <option value="high">{copy.high}</option>
            </select>
          </label>
        </fieldset>
        {draft.holdings.map((holding, index) => (
          <fieldset
            disabled={disabled}
            key={index}
            className="grid grid-cols-2 gap-2 rounded-[14px] border border-border p-2"
          >
            <legend>
              {copy.position} {index + 1}
            </legend>
            <label>
              {copy.company}
              <select
                className={fieldClass}
                value={holding.companyId}
                onChange={(event) => {
                  const companyId = event.target.value;
                  setDraft({
                    ...draft,
                    holdings: draft.holdings.map((item, at) =>
                      at === index
                        ? {
                            ...item,
                            companyId,
                            productId:
                              getDefaultMarketProduct(companyId)?.id ?? '',
                          }
                        : item,
                    ),
                  });
                }}
              >
                {MARKET_COMPANIES.map((company) => (
                  <option key={company.id} value={company.id}>
                    {presentMarketCompany(company, locale).shortName}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {copy.product}
              <select
                className={fieldClass}
                value={holding.productId}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    holdings: draft.holdings.map((item, at) =>
                      at === index
                        ? { ...item, productId: event.target.value }
                        : item,
                    ),
                  })
                }
              >
                {getMarketProducts(holding.companyId).map((product) => (
                  <option
                    key={product.id}
                    value={product.id}
                    disabled={!isMarketProductSelectable(product)}
                    title={
                      'unavailableReason' in product
                        ? product.unavailableReason
                        : undefined
                    }
                  >
                    {presentMarketProduct(product, locale).shortLabel}
                    {!isMarketProductSelectable(product)
                      ? english
                        ? ' · unavailable'
                        : ' · chưa đủ báo giá'
                      : ''}
                  </option>
                ))}
              </select>
            </label>
            {(
              [
                ['quantityLuong', copy.quantity],
                ['costPerLuongVnd', copy.cost],
              ] as const
            ).map(([key, label]) => (
              <label key={key}>
                {label}
                <input
                  className={fieldClass}
                  required
                  type="number"
                  min="0.0001"
                  step="any"
                  value={holding[key] || ''}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      holdings: draft.holdings.map((item, at) =>
                        at === index
                          ? { ...item, [key]: Number(event.target.value) }
                          : item,
                      ),
                    })
                  }
                />
              </label>
            ))}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label={copy.removePositionFor(index + 1)}
              onClick={() =>
                setDraft({
                  ...draft,
                  holdings: draft.holdings.filter((_, at) => at !== index),
                })
              }
            >
              {copy.removePosition}
            </Button>
          </fieldset>
        ))}
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={disabled || draft.holdings.length >= 20}
            onClick={() =>
              setDraft({
                ...draft,
                holdings: [
                  ...draft.holdings,
                  {
                    companyId: 'sjc',
                    productId: 'bar-1l',
                    quantityLuong: 1,
                    costPerLuongVnd: 0,
                  },
                ],
              })
            }
          >
            {copy.addPosition}
          </Button>
          <Button type="submit" size="sm" disabled={disabled}>
            {copy.save}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={disabled}
            aria-label={
              english
                ? 'Delete saved investment profile'
                : 'Xóa hồ sơ đầu tư đã lưu'
            }
            onClick={() => {
              try {
                localStorage.removeItem(profileKey(account));
                setDraft({ holdings: [] });
                onChange(undefined);
                setNotice(copy.deleted);
              } catch {
                setNotice(copy.deleteFailed);
              }
            }}
          >
            {copy.delete}
          </Button>
        </div>
        <p role="alert" aria-live="assertive">
          {notice}
        </p>
      </form>
    </details>
  );
}
