import 'server-only';

import { cookies } from 'next/headers';
import { defaultLocale, englishEnabled, interfaceLocaleFromValue, localeCookieName } from '@/lib/i18n';

export async function getRequestLocale() {
  // The Vietnamese-only interface does not vary by request cookies.
  if (!englishEnabled) return defaultLocale;
  const cookieStore = await cookies();
  return interfaceLocaleFromValue(cookieStore.get(localeCookieName)?.value);
}
