import {
  verifyIntegrationRequest,
  integrationErrorResponse,
} from '@/lib/editorial/integration-auth';
import { hermesPackageMedia } from '@/lib/editorial/hermes-integration';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    await verifyIntegrationRequest(request);
    const { id } = await context.params;
    if (!/^[a-f0-9-]{36}$/.test(id))
      return Response.json({ error: 'Sai mã gói.' }, { status: 400 });
    return await hermesPackageMedia(id);
  } catch (error) {
    return integrationErrorResponse(error);
  }
}
