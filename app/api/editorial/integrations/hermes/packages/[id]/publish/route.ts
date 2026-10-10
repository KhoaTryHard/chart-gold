import {
  verifyIntegrationRequest,
  integrationErrorResponse,
} from '@/lib/editorial/integration-auth';
import { publishHermesPackage } from '@/lib/editorial/hermes-integration';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const bytes = await verifyIntegrationRequest(request);
    const { id } = await context.params;
    if (!/^[a-f0-9-]{36}$/.test(id))
      return Response.json({ error: 'Sai mã gói.' }, { status: 400 });
    return Response.json(
      await publishHermesPackage(id, JSON.parse(bytes.toString('utf-8'))),
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return integrationErrorResponse(error);
  }
}
