/** Only public editorial/market routes may enter the Google event payload. */
const publicRoutes = new Map([
  ['/', 'Bảng giá vàng'],
  ['/nhip-vang', 'Tin vàng'],
  ['/huong-dan', 'Hướng dẫn'],
  ['/cong-cu-vang', 'Công cụ vàng'],
  ['/so-sanh/nhan-9999', 'So sánh vàng nhẫn 9999'],
  ['/so-sanh/vang-mieng-sjc', 'So sánh vàng miếng SJC'],
  ['/so-sanh/nhan-9999-va-vang-mieng-sjc', 'So sánh vàng nhẫn và vàng miếng'],
]);

export function validMeasurementId(value: string | undefined): string | null {
  return value && /^G-[A-Z0-9]{6,20}$/.test(value) ? value : null;
}

export function publicPageView(pathname: string, origin: string) {
  if (origin !== 'https://www.vanghomnay.online' && origin !== 'https://vanghomnay.online') return null;
  const title = publicRoutes.get(pathname)
    ?? (/^\/nhip-vang\/[a-z0-9]+(?:-[a-z0-9]+)*$/.test(pathname) ? 'Bài viết Nhịp vàng' : null);
  if (!title) return null;
  return {
    page_location: `https://www.vanghomnay.online${pathname}`,
    page_title: `${title} | Kim Tuyến`,
  };
}

export type GoogleTag = (...args: unknown[]) => void;
export type PageViewState = { lastLocation?: string; lastPublicLocation?: string };

export function recordPublicPageView(
  gtag: GoogleTag,
  state: PageViewState,
  pathname: string,
  origin: string,
  measurementId: string,
) {
  const page = publicPageView(pathname, origin);
  if (!page) {
    state.lastLocation = undefined;
    return false;
  }
  if (state.lastLocation === page.page_location) return false;
  gtag('event', 'page_view', {
    ...page,
    page_referrer: state.lastPublicLocation ?? '',
    send_to: measurementId,
  });
  state.lastLocation = page.page_location;
  state.lastPublicLocation = page.page_location;
  return true;
}
