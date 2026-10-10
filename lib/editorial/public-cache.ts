import 'server-only';

import { revalidatePath, revalidateTag } from 'next/cache';

export const editorialPublicCacheTag = 'editorial-public';
export const editorialPublicCacheSeconds = 300;

/** Call only after the public-content database change has committed. */
export function revalidateEditorialPublicContent(slug?: string) {
  // A withdrawal must never serve stale content while revalidating. The shared
  // tag also expires translated variants, list pages and related-article cards.
  revalidateTag(editorialPublicCacheTag, { expire: 0 });
  revalidatePath('/');
  revalidatePath('/nhip-vang');
  revalidatePath('/sitemap.xml');
  revalidatePath('/news-sitemap.xml');
  if (slug) revalidatePath(`/nhip-vang/${slug}`);
}
