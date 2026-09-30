import { randomUUID } from 'node:crypto';
import { put } from '@vercel/blob';
import { editorialImagePrompt } from './image-prompt';

export { editorialImagePrompt } from './image-prompt';

export type EditorialImageMimeType = 'image/png' | 'image/jpeg' | 'image/webp';

export type EditorialImageDraft = {
  bytes: Buffer;
  mimeType: EditorialImageMimeType;
  prompt: string;
  provider: 'admin-upload';
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
};

export type EditorialImageAvailability = {
  provider: 'brand-library';
  model: string;
  configured: boolean;
  missing: readonly string[];
};

export class EditorialImageError extends Error {
  constructor(
    message: string,
    readonly attempts: Array<{ provider: string; message: string }>,
  ) {
    super(message);
    this.name = 'EditorialImageError';
  }
}

export function getEditorialImageAvailability(
  env: Record<string, string | undefined> = process.env,
): EditorialImageAvailability {
  const mode = env.EDITORIAL_IMAGE_MODE?.trim() || 'brand-upload';
  return {
    provider: 'brand-library',
    model: 'brand-covers-v1',
    configured: mode === 'brand-upload',
    missing:
      mode === 'brand-upload' ? [] : ['EDITORIAL_IMAGE_MODE=brand-upload'],
  };
}

function imageExtension(mimeType: EditorialImageMimeType) {
  return mimeType === 'image/jpeg'
    ? 'jpg'
    : mimeType === 'image/webp'
      ? 'webp'
      : 'png';
}

function ensureBlobConfigured() {
  const hasBlobToken = Boolean(process.env.BLOB_READ_WRITE_TOKEN?.trim());
  const hasVercelOidc = Boolean(
    process.env.BLOB_STORE_ID?.trim() && process.env.VERCEL_OIDC_TOKEN?.trim(),
  );
  if (!hasBlobToken && !hasVercelOidc) {
    throw new EditorialImageError(
      'Blob private cần BLOB_READ_WRITE_TOKEN hoặc BLOB_STORE_ID cùng VERCEL_OIDC_TOKEN.',
      [],
    );
  }
}

export async function generateEditorialImage(
  _input: Parameters<typeof editorialImagePrompt>[0],
  _signal?: AbortSignal,
): Promise<never> {
  throw new EditorialImageError(
    'Đã tắt tạo ảnh AI. Hãy chọn ảnh thương hiệu hoặc tải ảnh lên.',
    [],
  );
}

export async function storeEditorialImageUpload(input: {
  revisionId: string;
  bytes: Buffer;
  mimeType: EditorialImageMimeType;
}) {
  ensureBlobConfigured();
  const result = await put(
    `editorial/uploads/${input.revisionId}/${randomUUID()}.${imageExtension(input.mimeType)}`,
    input.bytes,
    {
      access: 'private',
      addRandomSuffix: false,
      contentType: input.mimeType,
      cacheControlMaxAge: 60 * 60 * 24 * 30,
    },
  );
  return {
    pathname: result.pathname,
    url: result.url,
    contentType: result.contentType,
  };
}
