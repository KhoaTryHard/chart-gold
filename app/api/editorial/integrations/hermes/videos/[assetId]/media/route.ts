import { integrationErrorResponse } from '@/lib/editorial/integration-auth';
import { serveVideoMedia } from '@/lib/editorial/video-assets';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
async function media(
  request: Request,
  context: { params: Promise<{ assetId: string }> },
) {
  try {
    const { assetId } = await context.params;
    return await serveVideoMedia(request, assetId);
  } catch (error) {
    return integrationErrorResponse(error);
  }
}
export const GET = media;
export const HEAD = media;
