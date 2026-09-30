import { z } from 'zod';
import { verifyEditorialWorkerRequest } from '@/lib/editorial/qstash';
import {
  collectDailyEditorialWork,
  reconcileEditorialWork,
  runEditorialGenerationJob,
  runEditorialImageJob,
  runEditorialTranslationJob,
} from '@/lib/editorial/workflow';
import { publishDueSlot } from '@/lib/editorial/admin';
import { vietnamLocalDate } from '@/lib/editorial/time';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 90;

const workerMessage = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('collect'), localDate: z.iso.date().optional() }),
  z.object({ kind: z.literal('generate'), jobId: z.uuid() }),
  z.object({ kind: z.literal('translate'), jobId: z.uuid() }),
  z.object({
    kind: z.literal('image'),
    jobId: z.uuid(),
    revisionId: z.uuid().optional(),
  }),
  z.object({
    kind: z.literal('publish'),
    localDate: z.iso.date().optional(),
    slot: z.enum(['morning', 'noon', 'evening']),
  }),
  z.object({ kind: z.literal('reconcile') }),
]);

export async function POST(request: Request) {
  const verified = await verifyEditorialWorkerRequest(request).catch(
    () => false,
  );
  if (!verified) {
    return Response.json(
      { error: 'Tác vụ biên tập không có chữ ký hợp lệ.' },
      { status: 401 },
    );
  }
  let body: unknown;
  try {
    body = JSON.parse(await request.text());
  } catch {
    return Response.json({ status: 'rejected', reason: 'invalid-json' });
  }
  const parsed = workerMessage.safeParse(body);
  if (!parsed.success) {
    return Response.json({ status: 'rejected', reason: 'invalid-payload' });
  }
  try {
    const message = parsed.data;
    if (message.kind === 'collect') {
      return Response.json(await collectDailyEditorialWork(message.localDate));
    }
    if (message.kind === 'generate') {
      return Response.json(await runEditorialGenerationJob(message.jobId));
    }
    if (message.kind === 'translate') {
      return Response.json(await runEditorialTranslationJob(message.jobId));
    }
    if (message.kind === 'image') {
      return Response.json(await runEditorialImageJob(message.jobId));
    }
    if (message.kind === 'publish') {
      return Response.json(
        await publishDueSlot(
          message.localDate || vietnamLocalDate(),
          message.slot,
        ),
      );
    }
    return Response.json(await reconcileEditorialWork());
  } catch (error) {
    return Response.json(
      {
        status: 'retryable-error',
        error:
          error instanceof Error
            ? error.message.slice(0, 500)
            : 'Worker failed',
      },
      { status: 503, headers: { 'Retry-After': '60' } },
    );
  }
}
