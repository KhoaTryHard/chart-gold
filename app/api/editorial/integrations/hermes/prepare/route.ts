import {
  verifyIntegrationRequest,
  integrationErrorResponse,
} from '@/lib/editorial/integration-auth';
import { prepareHermesPackage } from '@/lib/editorial/hermes-integration';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
export async function POST(request: Request) {
  try {
    const bytes = await verifyIntegrationRequest(request);
    const form = await new Request(request.url, {
      method: 'POST',
      headers: { 'content-type': request.headers.get('content-type') ?? '' },
      body: new Uint8Array(bytes),
    }).formData();
    const manifest = form.get('manifest'),
      image = form.get('image');
    if (typeof manifest !== 'string' || !(image instanceof File))
      return Response.json(
        { error: 'Cần manifest và image.' },
        { status: 400 },
      );
    const result = await prepareHermesPackage(
      JSON.parse(manifest),
      Buffer.from(await image.arrayBuffer()),
    );
    return Response.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return integrationErrorResponse(error);
  }
}
