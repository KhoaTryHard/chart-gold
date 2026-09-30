import 'server-only';

import { cookies } from 'next/headers';
import { localeCookieName, localeFromValue } from '@/lib/i18n';

export async function getRequestLocale() {
  const cookieStore = await cookies();
  return localeFromValue(cookieStore.get(localeCookieName)?.value);
}
