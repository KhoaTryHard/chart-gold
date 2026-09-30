import { and, eq } from 'drizzle-orm';

export async function recordAnalysisRun(input: {
  requestId: string;
  userId: string;
  goal?: string;
  promptVersion: string;
  provider?: string;
  model?: string;
  outcome: string;
}) {
  const [{ getDatabase }, { analysisRuns }] = await Promise.all([
    import('@/db'),
    import('@/db/schema'),
  ]);
  await getDatabase()
    .insert(analysisRuns)
    .values(input)
    .onConflictDoUpdate({
      target: analysisRuns.requestId,
      set: {
        provider: input.provider,
        model: input.model,
        outcome: input.outcome,
        promptVersion: input.promptVersion,
      },
    });
}

export async function recordAnalysisFeedback(input: {
  requestId: string;
  userId: string;
  rating: number;
  reason?: string;
}) {
  const [{ getDatabase }, { analysisFeedback, analysisRuns }] = await Promise.all([
    import('@/db'),
    import('@/db/schema'),
  ]);
  const database = getDatabase();
  const run = await database
    .select({ requestId: analysisRuns.requestId })
    .from(analysisRuns)
    .where(
      and(
        eq(analysisRuns.requestId, input.requestId),
        eq(analysisRuns.userId, input.userId),
      ),
    )
    .limit(1);
  if (!run.length) return false;
  await database
    .insert(analysisFeedback)
    .values(input)
    .onConflictDoUpdate({
      target: [analysisFeedback.userId, analysisFeedback.requestId],
      set: { rating: input.rating, reason: input.reason },
    });
  return true;
}
