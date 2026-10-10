import {
  verifyIntegrationRequest,
  integrationErrorResponse,
} from '@/lib/editorial/integration-auth';
import { issueVideoMediaUrl } from '@/lib/editorial/video-assets';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
export async function POST(
  request: Request,
  context: { params: Promise<{ assetId: string }> },
) {
  try {
    const body = await verifyIntegrationRequest(request);
    const { assetId } = await context.params;
    return Response.json(
      await issueVideoMediaUrl(assetId, JSON.parse(body.toString())),
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return integrationErrorResponse(error);
  }
}
