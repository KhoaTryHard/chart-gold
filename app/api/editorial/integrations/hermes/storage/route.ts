import {
  integrationErrorResponse,
  verifyIntegrationRequest,
} from '@/lib/editorial/integration-auth';
import { storageMaintenance } from '@/lib/editorial/storage-maintenance';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
export async function POST(request: Request) {
  try {
    const body = await verifyIntegrationRequest(request);
    return Response.json(
      await storageMaintenance(JSON.parse(body.toString())),
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return integrationErrorResponse(error);
  }
}
