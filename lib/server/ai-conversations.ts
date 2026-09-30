import { and, asc, desc, eq, gt, lt, sql } from 'drizzle-orm';
import { getDatabase, type AppDatabase } from '@/db';
import { aiConversationTurns, aiConversations } from '@/db/schema';

const CONVERSATION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export type ConversationMessage = {
  role: 'user' | 'assistant';
  content: string;
};

export type ConversationSummary = {
  id: string;
  title: string;
  version: number;
  turnCount: number;
  updatedAt: string;
  expiresAt: string;
};

export type ConversationTurn = {
  id: string;
  sequence: number;
  question: string;
  answer: string | null;
  locale: string;
  companyId: string;
  productId: string;
  range: string;
  goal: string | null;
  analysisDepth: string | null;
  scenarioInputs: Record<string, unknown> | null;
  ledgerVersion: number | null;
  facts: Record<string, unknown> | null;
  decision: Record<string, unknown> | null;
  forecast: Record<string, unknown> | null;
  sources: Array<Record<string, unknown>> | null;
  citations: Array<Record<string, unknown>> | null;
  coverage: string | null;
  warning: string | null;
  status: 'pending' | 'completed' | 'failed' | 'aborted';
  createdAt: string;
  completedAt: string | null;
};

export type ConversationDetail = ConversationSummary & { turns: ConversationTurn[] };

export class ConversationError extends Error {
  constructor(
    public readonly code: 'CONVERSATION_NOT_FOUND' | 'CONVERSATION_EXPIRED' | 'CONVERSATION_VERSION_CONFLICT' | 'CONVERSATION_UNAVAILABLE',
    message: string,
    public readonly status = code === 'CONVERSATION_VERSION_CONFLICT' ? 409 : 404,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'ConversationError';
  }
}

function database(db?: AppDatabase) {
  return db ?? getDatabase();
}

function summary(row: typeof aiConversations.$inferSelect): ConversationSummary {
  return {
    id: row.id,
    title: row.title,
    version: row.version,
    turnCount: row.turnCount,
    updatedAt: row.updatedAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
  };
}

function turn(row: typeof aiConversationTurns.$inferSelect): ConversationTurn {
  return {
    id: row.id,
    sequence: row.sequence,
    question: row.question,
    answer: row.answer,
    locale: row.locale,
    companyId: row.companyId,
    productId: row.productId,
    range: row.range,
    goal: row.goal,
    analysisDepth: row.analysisDepth,
    scenarioInputs: row.scenarioInputs,
    ledgerVersion: row.ledgerVersion,
    facts: row.facts,
    decision: row.decision,
    forecast: row.forecast,
    sources: row.sources,
    citations: row.citations,
    coverage: row.coverage,
    warning: row.warning,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
  };
}

async function removeExpired(userId: string, db: AppDatabase, now = new Date()) {
  await db
    .delete(aiConversations)
    .where(and(eq(aiConversations.userId, userId), lt(aiConversations.expiresAt, now)));
}

export async function listConversations(userId: string, db?: AppDatabase) {
  const databaseInstance = database(db);
  const now = new Date();
  await removeExpired(userId, databaseInstance, now);
  const rows = await databaseInstance
    .select()
    .from(aiConversations)
    .where(and(eq(aiConversations.userId, userId), gt(aiConversations.expiresAt, now)))
    .orderBy(desc(aiConversations.updatedAt))
    .limit(100);
  return rows.map(summary);
}

export async function getConversation(userId: string, id: string, db?: AppDatabase): Promise<ConversationDetail> {
  const databaseInstance = database(db);
  const now = new Date();
  const [row] = await databaseInstance
    .select()
    .from(aiConversations)
    .where(and(eq(aiConversations.id, id), eq(aiConversations.userId, userId)))
    .limit(1);
  if (!row) throw new ConversationError('CONVERSATION_NOT_FOUND', 'Conversation not found.');
  if (row.expiresAt <= now) {
    await databaseInstance.delete(aiConversations).where(eq(aiConversations.id, id));
    throw new ConversationError('CONVERSATION_EXPIRED', 'This conversation has expired.');
  }
  const rows = await databaseInstance
    .select()
    .from(aiConversationTurns)
    .where(eq(aiConversationTurns.conversationId, id))
    .orderBy(asc(aiConversationTurns.sequence));
  return { ...summary(row), turns: rows.map(turn) };
}

export function buildConversationMessages(turns: readonly ConversationTurn[], maxChars = 12_000): ConversationMessage[] {
  const selected: ConversationMessage[] = [];
  let total = 0;
  for (const item of [...turns].reverse()) {
    if (item.status !== 'completed' || !item.answer) continue;
    const pair = [
      { role: 'user' as const, content: item.question },
      { role: 'assistant' as const, content: item.answer },
    ];
    const size = pair[0].content.length + pair[1].content.length;
    if (total + size > maxChars) break;
    selected.unshift(...pair);
    total += size;
    if (selected.length >= 8) break;
  }
  return selected;
}

type BeginTurnInput = {
  userId: string;
  conversationId?: string;
  conversationVersion?: number;
  clientRequestId: string;
  question: string;
  locale: string;
  companyId: string;
  productId: string;
  range: string;
  goal?: string;
  analysisDepth?: string;
  scenarioInputs?: Record<string, unknown>;
  ledgerVersion?: number;
};

export async function beginConversationTurn(input: BeginTurnInput, db?: AppDatabase) {
  const databaseInstance = database(db);
  return databaseInstance.transaction(async (tx) => {
    await tx.execute(sqlLock(input.userId, input.conversationId));
    let conversation: typeof aiConversations.$inferSelect | undefined;
    if (input.conversationId) {
      [conversation] = await tx
        .select()
        .from(aiConversations)
        .where(and(eq(aiConversations.id, input.conversationId), eq(aiConversations.userId, input.userId)))
        .limit(1);
      if (!conversation) throw new ConversationError('CONVERSATION_NOT_FOUND', 'Conversation not found.');
      if (conversation.expiresAt <= new Date())
        throw new ConversationError('CONVERSATION_EXPIRED', 'This conversation has expired.');
      if (input.conversationVersion !== undefined && input.conversationVersion !== conversation.version)
        throw new ConversationError('CONVERSATION_VERSION_CONFLICT', 'Conversation changed on another device.', 409, { version: conversation.version });
      const [existing] = await tx
        .select()
        .from(aiConversationTurns)
        .where(and(eq(aiConversationTurns.conversationId, conversation.id), eq(aiConversationTurns.clientRequestId, input.clientRequestId)))
        .limit(1);
      if (existing) {
        const existingTurns = await tx.select().from(aiConversationTurns).where(eq(aiConversationTurns.conversationId, conversation.id)).orderBy(asc(aiConversationTurns.sequence));
        return { conversation: summary(conversation), turn: turn(existing), messages: buildConversationMessages(existingTurns.map(turn)) };
      }
    } else {
      [conversation] = await tx.insert(aiConversations).values({
        userId: input.userId,
        title: input.question.slice(0, 180),
        expiresAt: new Date(Date.now() + CONVERSATION_TTL_MS),
      }).returning();
    }
    if (!conversation) throw new ConversationError('CONVERSATION_UNAVAILABLE', 'Unable to create conversation.', 503);
    const existingTurns = await tx.select().from(aiConversationTurns).where(eq(aiConversationTurns.conversationId, conversation.id)).orderBy(asc(aiConversationTurns.sequence));
    const nextVersion = conversation.version + 1;
    const [created] = await tx.insert(aiConversationTurns).values({
      conversationId: conversation.id,
      clientRequestId: input.clientRequestId,
      sequence: conversation.turnCount + 1,
      question: input.question,
      locale: input.locale,
      companyId: input.companyId,
      productId: input.productId,
      range: input.range,
      goal: input.goal ?? null,
      analysisDepth: input.analysisDepth ?? null,
      scenarioInputs: input.scenarioInputs ?? null,
      ledgerVersion: input.ledgerVersion ?? null,
    }).returning();
    await tx.update(aiConversations).set({ version: nextVersion, turnCount: conversation.turnCount + 1, updatedAt: new Date(), expiresAt: new Date(Date.now() + CONVERSATION_TTL_MS) }).where(eq(aiConversations.id, conversation.id));
    if (!created) throw new ConversationError('CONVERSATION_UNAVAILABLE', 'Unable to create conversation turn.', 503);
    return { conversation: { ...summary(conversation), version: nextVersion, turnCount: conversation.turnCount + 1, updatedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + CONVERSATION_TTL_MS).toISOString() }, turn: turn(created), messages: buildConversationMessages(existingTurns.map(turn)) };
  });
}

function sqlLock(userId: string, conversationId?: string) {
  // Advisory locks serialize two tabs while keeping the row operations transactional.
  return conversationId
    ? sql`select pg_advisory_xact_lock(hashtextextended(${`${userId}:${conversationId}`}, 0))`
    : sql`select pg_advisory_xact_lock(hashtextextended(${userId}, 0))`;
}

type CompletionInput = {
  turnId: string;
  answer: string;
  facts?: Record<string, unknown> | null;
  decision?: Record<string, unknown> | null;
  forecast?: Record<string, unknown> | null;
  sources?: Array<Record<string, unknown>> | null;
  citations?: Array<Record<string, unknown>> | null;
  coverage?: string | null;
  warning?: string | null;
};

export async function completeConversationTurn(input: CompletionInput, db?: AppDatabase) {
  const databaseInstance = database(db);
  const [updated] = await databaseInstance.update(aiConversationTurns).set({
    answer: input.answer,
    facts: input.facts ?? null,
    decision: input.decision ?? null,
    forecast: input.forecast ?? null,
    sources: input.sources ?? null,
    citations: input.citations ?? null,
    coverage: input.coverage ?? null,
    warning: input.warning ?? null,
    status: 'completed',
    completedAt: new Date(),
  }).where(eq(aiConversationTurns.id, input.turnId)).returning();
  return updated ? turn(updated) : null;
}

export async function failConversationTurn(turnId: string, status: 'failed' | 'aborted' = 'failed', db?: AppDatabase) {
  const databaseInstance = database(db);
  await databaseInstance.update(aiConversationTurns).set({ status }).where(and(eq(aiConversationTurns.id, turnId), eq(aiConversationTurns.status, 'pending')));
}

export async function deleteConversation(userId: string, id: string, db?: AppDatabase) {
  const result = await database(db).delete(aiConversations).where(and(eq(aiConversations.id, id), eq(aiConversations.userId, userId))).returning({ id: aiConversations.id });
  if (!result.length) throw new ConversationError('CONVERSATION_NOT_FOUND', 'Conversation not found.');
}

export async function deleteAllConversations(userId: string, db?: AppDatabase) {
  await database(db).delete(aiConversations).where(eq(aiConversations.userId, userId));
}

export async function purgeExpiredConversations(db?: AppDatabase) {
  const result = await database(db).delete(aiConversations).where(lt(aiConversations.expiresAt, new Date())).returning({ id: aiConversations.id });
  return result.length;
}
