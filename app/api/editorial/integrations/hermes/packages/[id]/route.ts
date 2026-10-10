import {
  verifyIntegrationRequest,
  integrationErrorResponse,
} from '@/lib/editorial/integration-auth';
import { getHermesPackage } from '@/lib/editorial/hermes-integration';
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
    return Response.json(await getHermesPackage(id), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return integrationErrorResponse(error);
  }
}
