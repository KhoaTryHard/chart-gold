'use client';

import { BrandMark } from '@/components/brand-mark';
import Image from 'next/image';
import { useLocale } from '@/components/locale-provider';

export function EditorialCover({
  label,
  title,
  compact = false,
  imageUrl,
  imageAlt,
  imageDisclosure,
}: {
  label?: string | null;
  title: string;
  compact?: boolean;
  imageUrl?: string | null;
  imageAlt?: string | null;
  imageDisclosure?: string | null;
}) {
  const { locale } = useLocale();
  return (
    <figure className="editorial-cover-figure">
      <div
        className={`editorial-cover ${compact ? 'editorial-cover--compact' : ''} ${imageUrl ? 'editorial-cover--image' : ''}`}
      >
        {imageUrl ? (
          <Image
            className="editorial-cover__image"
            src={imageUrl}
            alt={imageAlt ?? (locale === 'en' ? `Illustration: ${title}` : `Ảnh minh họa: ${title}`)}
            fill
            sizes={
              compact
                ? '(max-width: 1023px) 100vw, 40vw'
                : '(max-width: 1023px) 100vw, 65vw'
            }
          />
        ) : (
          <>
            <BrandMark size={240} className="editorial-cover__mark" />
            <div className="editorial-cover__content">
              <BrandMark size={32} />
              <span>{label || (locale === 'en' ? 'Gold Pulse' : 'Nhịp vàng')}</span>
              {!compact ? <strong>{title}</strong> : null}
            </div>
            <span className="sr-only">{locale === 'en' ? 'Illustration' : 'Hình minh họa'}: {title}</span>
          </>
        )}
      </div>
      {imageDisclosure ? (
        <figcaption className="editorial-cover__disclosure">
          {imageDisclosure}
        </figcaption>
      ) : null}
    </figure>
  );
}
