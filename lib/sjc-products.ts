export const SJC_PRODUCTS = [
  {
    id: 'bar-1l',
    group: 'Vàng miếng SJC',
    label: 'Vàng miếng SJC 1 lượng',
    shortLabel: 'Miếng 1 lượng',
    unitLabel: '1 lượng',
    upstreamCode: 'SJL1L10',
    seriesId: 'bar',
    weightInLuong: 1,
    officialMatch: 'Vàng SJC 1L - 10L',
  },
  {
    id: 'bar-5c',
    group: 'Vàng miếng SJC',
    label: 'Vàng miếng SJC 5 chỉ',
    shortLabel: 'Miếng 5 chỉ',
    unitLabel: '5 chỉ',
    upstreamCode: 'SJL1L10',
    seriesId: 'bar',
    weightInLuong: 0.5,
    officialMatch: 'Vàng SJC 5 chỉ',
  },
  {
    id: 'bar-2c',
    group: 'Vàng miếng SJC',
    label: 'Vàng miếng SJC 2 chỉ',
    shortLabel: 'Miếng 2 chỉ',
    unitLabel: '2 chỉ',
    upstreamCode: 'SJL1L10',
    seriesId: 'bar',
    weightInLuong: 0.2,
    officialMatch: 'Vàng SJC 2 chỉ, 1 chỉ',
  },
  {
    id: 'bar-1c',
    group: 'Vàng miếng SJC',
    label: 'Vàng miếng SJC 1 chỉ',
    shortLabel: 'Miếng 1 chỉ',
    unitLabel: '1 chỉ',
    upstreamCode: 'SJL1L10',
    seriesId: 'bar',
    weightInLuong: 0.1,
    officialMatch: 'Vàng SJC 2 chỉ, 1 chỉ',
  },
  {
    id: 'ring-5c',
    group: 'Vàng nhẫn SJC 99,99%',
    label: 'Vàng nhẫn trơn SJC 5 chỉ',
    shortLabel: 'Nhẫn trơn 5 chỉ',
    unitLabel: '5 chỉ',
    upstreamCode: 'SJ9999',
    seriesId: 'ring',
    weightInLuong: 0.5,
    officialMatch: 'Vàng nhẫn SJC 99,99 1 chỉ, 2 chỉ, 5 chỉ',
  },
  {
    id: 'ring-2c',
    group: 'Vàng nhẫn SJC 99,99%',
    label: 'Vàng nhẫn trơn SJC 2 chỉ',
    shortLabel: 'Nhẫn trơn 2 chỉ',
    unitLabel: '2 chỉ',
    upstreamCode: 'SJ9999',
    seriesId: 'ring',
    weightInLuong: 0.2,
    officialMatch: 'Vàng nhẫn SJC 99,99 1 chỉ, 2 chỉ, 5 chỉ',
  },
  {
    id: 'ring-1c',
    group: 'Vàng nhẫn SJC 99,99%',
    label: 'Vàng nhẫn trơn SJC 1 chỉ',
    shortLabel: 'Nhẫn trơn 1 chỉ',
    unitLabel: '1 chỉ',
    upstreamCode: 'SJ9999',
    seriesId: 'ring',
    weightInLuong: 0.1,
    officialMatch: 'Vàng nhẫn SJC 99,99 1 chỉ, 2 chỉ, 5 chỉ',
  },
  {
    id: 'ring-05c',
    group: 'Vàng nhẫn SJC 99,99%',
    label: 'Vàng nhẫn trơn SJC 5 phân',
    shortLabel: 'Nhẫn trơn 5 phân',
    unitLabel: '5 phân',
    upstreamCode: 'SJ9999',
    seriesId: 'ring',
    weightInLuong: 0.05,
    officialMatch: 'Vàng nhẫn SJC 99,99 0,5 chỉ',
  },
  {
    id: 'ring-03c',
    group: 'Vàng nhẫn SJC 99,99%',
    label: 'Vàng nhẫn trơn SJC 3 phân',
    shortLabel: 'Nhẫn trơn 3 phân',
    unitLabel: '3 phân',
    upstreamCode: 'SJ9999',
    seriesId: 'ring',
    weightInLuong: 0.03,
    officialMatch: 'Vàng nhẫn SJC 99,99 0,5 chỉ',
  },
] as const;

export type SjcProduct = (typeof SJC_PRODUCTS)[number];
export type SjcProductId = SjcProduct['id'];

export const DEFAULT_SJC_PRODUCT_ID: SjcProductId = 'bar-1l';

export function getSjcProduct(value: string | null | undefined): SjcProduct {
  return (
    SJC_PRODUCTS.find((product) => product.id === value) ?? SJC_PRODUCTS[0]
  );
}
