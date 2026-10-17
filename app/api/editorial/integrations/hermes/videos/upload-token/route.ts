import {
  verifyIntegrationRequest,
  integrationErrorResponse,
} from '@/lib/editorial/integration-auth';
import { createVideoUploadToken } from '@/lib/editorial/video-assets';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
export async function POST(request: Request) {
  try {
    const body = await verifyIntegrationRequest(request);
    return Response.json(
      await createVideoUploadToken(
        JSON.parse(body.toString()),
        new URL(request.url).searchParams.get('uploadProtocol'),
      ),
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return integrationErrorResponse(error);
  }
}
