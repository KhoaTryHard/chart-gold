import {
  verifyIntegrationRequest,
  integrationErrorResponse,
  IntegrationError,
} from '@/lib/editorial/integration-auth';
import { completeVideoUpload } from '@/lib/editorial/video-assets';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
export async function POST(
  request: Request,
  context: { params: Promise<{ assetId: string }> },
) {
  try {
    const body = await verifyIntegrationRequest(request);
    if (body.length && JSON.stringify(JSON.parse(body.toString())) !== '{}')
      throw new IntegrationError('Chỉ chấp nhận body rỗng.');
    const { assetId } = await context.params;
    return Response.json(await completeVideoUpload(assetId), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return integrationErrorResponse(error);
  }
}
