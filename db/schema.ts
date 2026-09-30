import {
  bigint,
  boolean,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

export const userRoleEnum = pgEnum('user_role', ['user', 'admin']);
export const planCodeEnum = pgEnum('plan_code', [
  'trial',
  'basic',
  'plus',
  'pro',
]);
export const subscriptionStatusEnum = pgEnum('subscription_status', [
  'active',
  'scheduled',
  'expired',
  'revoked',
]);
export const paymentOrderStatusEnum = pgEnum('payment_order_status', [
  'pending',
  'paid',
  'needs_review',
  'expired',
  'cancelled',
]);
export const donationOrderStatusEnum = pgEnum('donation_order_status', [
  'pending',
  'paid',
  'needs_review',
  'expired',
  'cancelled',
]);
export const usageBucketEnum = pgEnum('usage_bucket', [
  'trial',
  'subscription',
  'community',
]);
export const usageStatusEnum = pgEnum('usage_status', [
  'reserved',
  'completed',
  'refunded',
]);
export const capabilityEnum = pgEnum('ai_capability', [
  'standard',
  'research',
  'portfolio',
  'deep',
]);
export const sepayProcessingStatusEnum = pgEnum('sepay_processing_status', [
  'accepted',
  'needs_review',
  'rejected',
]);
export const marketHistoryPointStatusEnum = pgEnum(
  'market_history_point_status',
  ['ok', 'missing', 'error'],
);
export const marketHistorySyncRunStatusEnum = pgEnum(
  'market_history_sync_run_status',
  ['running', 'completed', 'partial', 'failed', 'skipped_locked'],
);
export const aiConversationTurnStatusEnum = pgEnum('ai_conversation_turn_status', [
  'pending',
  'completed',
  'failed',
  'aborted',
]);

export const requestRateLimitBuckets = pgTable(
  'request_rate_limit_buckets',
  {
    key: varchar('key', { length: 240 }).primaryKey(),
    windowStart: timestamp('window_start', { withTimezone: true })
      .defaultNow()
      .notNull(),
    count: integer('count').notNull().default(0),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [index('request_rate_limit_expires_idx').on(table.expiresAt)],
);

export const marketHistoryLeases = pgTable('market_history_leases', {
  key: varchar('key', { length: 200 }).primaryKey(),
  owner: uuid('owner').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  heartbeatAt: timestamp('heartbeat_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const marketHistoryFetchAttempts = pgTable(
  'market_history_fetch_attempts',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    provider: varchar('provider', { length: 120 }).notNull(),
    companyId: varchar('company_id', { length: 64 }).notNull(),
    productId: varchar('product_id', { length: 128 }).notNull(),
    region: varchar('region', { length: 128 }).notNull().default(''),
    date: date('date').notNull(),
    status: marketHistoryPointStatusEnum('status').notNull(),
    sourceUrl: text('source_url'),
    errorMessage: text('error_message'),
    rawPayload: jsonb('raw_payload').$type<Record<string, unknown>>(),
    retrievedAt: timestamp('retrieved_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index('market_history_attempt_lookup_idx').on(
      table.provider,
      table.companyId,
      table.productId,
      table.date,
      table.retrievedAt,
    ),
  ],
);

export const marketQuoteSnapshots = pgTable(
  'market_quote_snapshots',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    purpose: varchar('purpose', { length: 32 }).notNull().default('live'),
    source: varchar('source', { length: 120 }).notNull(),
    companyId: varchar('company_id', { length: 64 }).notNull(),
    productId: varchar('product_id', { length: 128 }).notNull(),
    region: varchar('region', { length: 128 }).notNull().default(''),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    lastSuccessAt: timestamp('last_success_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex('market_quote_snapshot_identity_unique').on(
      table.purpose,
      table.source,
      table.companyId,
      table.productId,
      table.region,
    ),
    index('market_quote_snapshot_lookup_idx').on(
      table.companyId,
      table.productId,
      table.purpose,
      table.fetchedAt,
    ),
  ],
);

export const users = pgTable(
  'users',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    googleSubject: varchar('google_subject', { length: 255 }).notNull(),
    email: varchar('email', { length: 320 }).notNull(),
    name: varchar('name', { length: 200 }),
    image: text('image'),
    role: userRoleEnum('role').notNull().default('user'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex('users_google_subject_unique').on(table.googleSubject),
    uniqueIndex('users_email_unique').on(table.email),
  ],
);

export const aiConversations = pgTable(
  'ai_conversations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    title: varchar('title', { length: 180 }).notNull(),
    version: integer('version').notNull().default(1),
    turnCount: integer('turn_count').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    index('ai_conversations_user_updated_idx').on(table.userId, table.updatedAt),
    index('ai_conversations_expiry_idx').on(table.expiresAt),
  ],
);

export const aiConversationTurns = pgTable(
  'ai_conversation_turns',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => aiConversations.id, { onDelete: 'cascade' }),
    clientRequestId: uuid('client_request_id'),
    sequence: integer('sequence').notNull(),
    question: text('question').notNull(),
    answer: text('answer'),
    locale: varchar('locale', { length: 8 }).notNull().default('vi'),
    companyId: varchar('company_id', { length: 64 }).notNull(),
    productId: varchar('product_id', { length: 128 }).notNull(),
    range: varchar('range', { length: 12 }).notNull(),
    goal: varchar('goal', { length: 24 }),
    analysisDepth: varchar('analysis_depth', { length: 24 }),
    scenarioInputs: jsonb('scenario_inputs').$type<Record<string, unknown> | null>(),
    ledgerVersion: integer('ledger_version'),
    facts: jsonb('facts').$type<Record<string, unknown> | null>(),
    decision: jsonb('decision').$type<Record<string, unknown> | null>(),
    forecast: jsonb('forecast').$type<Record<string, unknown> | null>(),
    sources: jsonb('sources').$type<Array<Record<string, unknown>> | null>(),
    citations: jsonb('citations').$type<Array<Record<string, unknown>> | null>(),
    coverage: text('coverage'),
    warning: text('warning'),
    status: aiConversationTurnStatusEnum('status').notNull().default('pending'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('ai_conversation_turn_sequence_unique').on(table.conversationId, table.sequence),
    uniqueIndex('ai_conversation_turn_request_unique').on(table.conversationId, table.clientRequestId),
    index('ai_conversation_turn_conversation_idx').on(table.conversationId, table.sequence),
  ],
);

export const ledgerSideEnum = pgEnum('ledger_side', ['buy', 'sell']);

export const portfolioLedgers = pgTable(
  'portfolio_ledgers',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [uniqueIndex('portfolio_ledgers_user_unique').on(table.userId)],
);

export const portfolioLedgerTransactions = pgTable(
  'portfolio_ledger_transactions',
  {
    id: varchar('id', { length: 100 }).notNull(),
    ledgerId: uuid('ledger_id')
      .notNull()
      .references(() => portfolioLedgers.id, { onDelete: 'cascade' }),
    sortOrder: integer('sort_order').notNull(),
    date: varchar('date', { length: 10 }).notNull(),
    side: ledgerSideEnum('side').notNull(),
    companyId: varchar('company_id', { length: 50 }).notNull(),
    productId: varchar('product_id', { length: 100 }).notNull(),
    quantityLuong: doublePrecision('quantity_luong').notNull(),
    unitPriceVnd: bigint('unit_price_vnd', { mode: 'number' }).notNull(),
    feesVnd: bigint('fees_vnd', { mode: 'number' }).notNull().default(0),
    purchaseVenue: varchar('purchase_venue', { length: 160 }),
    saleVenue: varchar('sale_venue', { length: 160 }),
    invoiceStatus: varchar('invoice_status', { length: 40 }),
    packagingStatus: varchar('packaging_status', { length: 40 }),
    serial: varchar('serial', { length: 120 }),
    note: varchar('note', { length: 500 }).notNull().default(''),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex('portfolio_ledger_transactions_pk').on(table.ledgerId, table.id),
    index('portfolio_ledger_transactions_order_idx').on(table.ledgerId, table.sortOrder),
  ],
);

export const portfolioLedgerMutations = pgTable(
  'portfolio_ledger_mutations',
  {
    operationId: varchar('operation_id', { length: 100 }).primaryKey(),
    ledgerId: uuid('ledger_id')
      .notNull()
      .references(() => portfolioLedgers.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [index('portfolio_ledger_mutations_ledger_idx').on(table.ledgerId, table.createdAt)],
);

export const articles = pgTable(
  'articles',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    slug: varchar('slug', { length: 180 }).notNull(),
    category: varchar('category', { length: 40 }).notNull(),
    status: varchar('status', { length: 20 }).notNull().default('draft'),
    authorName: varchar('author_name', { length: 160 })
      .notNull()
      .default('Kim Tuyến'),
    authorUrl: text('author_url'),
    pinnedUntil: timestamp('pinned_until', { withTimezone: true }),
    publishedRevisionId: uuid('published_revision_id'),
    // These fields describe the version currently visible to readers. Draft edits
    // must not silently change a published article's category or modified date.
    publishedCategory: varchar('published_category', { length: 40 }),
    publicModifiedAt: timestamp('public_modified_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    publishedAt: timestamp('published_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('articles_slug_unique').on(table.slug),
    index('articles_status_published_idx').on(table.status, table.publishedAt),
    index('articles_category_published_idx').on(
      table.category,
      table.publishedAt,
    ),
    index('articles_published_category_published_idx').on(
      table.publishedCategory,
      table.publishedAt,
    ),
  ],
);

export const editorialEvents = pgTable(
  'editorial_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    fingerprint: varchar('fingerprint', { length: 192 }).notNull(),
    title: varchar('title', { length: 320 }).notNull(),
    summary: text('summary'),
    category: varchar('category', { length: 40 }),
    status: varchar('status', { length: 32 }).notNull().default('candidate'),
    relevanceScore: integer('relevance_score').notNull().default(0),
    relevanceReason: text('relevance_reason'),
    marketImpactSummary: text('market_impact_summary'),
    detectedAt: timestamp('detected_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    selectedAt: timestamp('selected_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex('editorial_events_fingerprint_unique').on(table.fingerprint),
    index('editorial_events_status_relevance_idx').on(
      table.status,
      table.relevanceScore,
      table.detectedAt,
    ),
  ],
);

export const articleRevisions = pgTable(
  'article_revisions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    articleId: uuid('article_id')
      .notNull()
      .references(() => articles.id, { onDelete: 'cascade' }),
    title: varchar('title', { length: 180 }).notNull(),
    excerpt: varchar('excerpt', { length: 360 }).notNull(),
    contentMarkdown: text('content_markdown').notNull(),
    coverLabel: varchar('cover_label', { length: 160 }),
    coverAlt: varchar('cover_alt', { length: 240 }),
    publicationCategory: varchar('publication_category', { length: 40 }),
    sourceEventId: uuid('source_event_id').references(
      () => editorialEvents.id,
      { onDelete: 'set null' },
    ),
    seoTitle: varchar('seo_title', { length: 180 }),
    seoDescription: varchar('seo_description', { length: 360 }),
    coverImageUrl: text('cover_image_url'),
    coverImageAlt: varchar('cover_image_alt', { length: 240 }),
    coverImageStorageKey: varchar('cover_image_storage_key', { length: 500 }),
    coverImageDisclosure: varchar('cover_image_disclosure', { length: 160 }),
    coverImageProvider: varchar('cover_image_provider', { length: 80 }),
    coverImageModel: varchar('cover_image_model', { length: 120 }),
    coverImagePrompt: text('cover_image_prompt'),
    coverImageGeneratedAt: timestamp('cover_image_generated_at', {
      withTimezone: true,
    }),
    sources: jsonb('sources')
      .$type<
        Array<{
          title: string;
          url: string;
          publishedAt?: string;
          accessedAt: string;
        }>
      >()
      .notNull()
      .default([]),
    evidence: jsonb('evidence')
      .$type<
        Array<{
          label: string;
          value: string;
          sourceUrl?: string;
          observedAt?: string;
        }>
      >()
      .notNull()
      .default([]),
    status: varchar('status', { length: 20 }).notNull().default('draft'),
    approvalStatus: varchar('approval_status', { length: 32 })
      .notNull()
      .default('pending'),
    approvedByUserId: uuid('approved_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    reviewNote: text('review_note'),
    createdByUserId: uuid('created_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    reviewedByUserId: uuid('reviewed_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index('article_revisions_article_created_idx').on(
      table.articleId,
      table.createdAt,
    ),
    index('article_revisions_status_idx').on(table.status),
    index('article_revisions_approval_status_idx').on(
      table.approvalStatus,
      table.createdAt,
    ),
    index('article_revisions_source_event_idx').on(table.sourceEventId),
  ],
);

/** A localized rendering of one immutable editorial revision. */
export const articleTranslations = pgTable(
  'article_translations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    sourceRevisionId: uuid('source_revision_id')
      .notNull()
      .references(() => articleRevisions.id, { onDelete: 'cascade' }),
    locale: varchar('locale', { length: 8 }).notNull(),
    status: varchar('status', { length: 20 }).notNull().default('queued'),
    title: varchar('title', { length: 180 }),
    excerpt: varchar('excerpt', { length: 360 }),
    contentMarkdown: text('content_markdown'),
    seoTitle: varchar('seo_title', { length: 180 }),
    seoDescription: varchar('seo_description', { length: 360 }),
    coverLabel: varchar('cover_label', { length: 160 }),
    coverAlt: varchar('cover_alt', { length: 240 }),
    provider: varchar('provider', { length: 80 }),
    model: varchar('model', { length: 120 }),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    errorMessage: text('error_message'),
    translatedAt: timestamp('translated_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex('article_translations_revision_locale_unique').on(
      table.sourceRevisionId,
      table.locale,
    ),
    index('article_translations_status_updated_idx').on(
      table.status,
      table.updatedAt,
    ),
  ],
);

export const editorialSources = pgTable(
  'editorial_sources',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    title: varchar('title', { length: 180 }).notNull(),
    url: text('url').notNull(),
    domain: varchar('domain', { length: 180 }).notNull(),
    sourceType: varchar('source_type', { length: 30 })
      .notNull()
      .default('official'),
    allowed: boolean('allowed').notNull().default(true),
    lastCheckedAt: timestamp('last_checked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [uniqueIndex('editorial_sources_url_unique').on(table.url)],
);

export const editorialSourceItems = pgTable(
  'editorial_source_items',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    sourceId: uuid('source_id').references(() => editorialSources.id, {
      onDelete: 'set null',
    }),
    eventId: uuid('event_id').references(() => editorialEvents.id, {
      onDelete: 'set null',
    }),
    url: text('url').notNull(),
    normalizedUrl: text('normalized_url').notNull(),
    title: varchar('title', { length: 320 }),
    domain: varchar('domain', { length: 180 }).notNull(),
    sourceType: varchar('source_type', { length: 30 })
      .notNull()
      .default('official'),
    status: varchar('status', { length: 32 }).notNull().default('queued'),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }),
    contentExcerpt: text('content_excerpt'),
    contentHash: varchar('content_hash', { length: 64 }),
    rawPayload: jsonb('raw_payload').$type<Record<string, unknown>>(),
    errorMessage: text('error_message'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex('editorial_source_items_normalized_url_unique').on(
      table.normalizedUrl,
    ),
    index('editorial_source_items_event_fetched_idx').on(
      table.eventId,
      table.fetchedAt,
    ),
    index('editorial_source_items_status_fetched_idx').on(
      table.status,
      table.fetchedAt,
    ),
  ],
);

export const editorialPublicationSlots = pgTable(
  'editorial_publication_slots',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    localDate: date('local_date').notNull(),
    slot: varchar('slot', { length: 16 }).notNull(),
    scheduledAt: timestamp('scheduled_at', { withTimezone: true }).notNull(),
    status: varchar('status', { length: 32 }).notNull().default('open'),
    articleId: uuid('article_id').references(() => articles.id, {
      onDelete: 'set null',
    }),
    revisionId: uuid('revision_id').references(() => articleRevisions.id, {
      onDelete: 'set null',
    }),
    scheduledByUserId: uuid('scheduled_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    scheduledOn: timestamp('scheduled_on', { withTimezone: true }),
    approvedByUserId: uuid('approved_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    publishedByUserId: uuid('published_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    failureCount: integer('failure_count').notNull().default(0),
    failureMessage: text('failure_message'),
    lastFailedAt: timestamp('last_failed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex('editorial_publication_slots_date_slot_unique').on(
      table.localDate,
      table.slot,
    ),
    index('editorial_publication_slots_status_scheduled_idx').on(
      table.status,
      table.scheduledAt,
    ),
    index('editorial_publication_slots_revision_idx').on(table.revisionId),
  ],
);

export const editorialJobs = pgTable(
  'editorial_jobs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    topic: varchar('topic', { length: 240 }).notNull(),
    dedupeKey: varchar('dedupe_key', { length: 240 }).notNull(),
    status: varchar('status', { length: 20 }).notNull().default('queued'),
    stage: varchar('stage', { length: 40 }).notNull().default('generate'),
    provider: varchar('provider', { length: 40 }),
    model: varchar('model', { length: 120 }),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    costVnd: bigint('cost_vnd', { mode: 'number' }).notNull().default(0),
    articleId: uuid('article_id').references(() => articles.id, {
      onDelete: 'set null',
    }),
    revisionId: uuid('revision_id').references(() => articleRevisions.id, {
      onDelete: 'set null',
    }),
    sourceEventId: uuid('source_event_id').references(
      () => editorialEvents.id,
      { onDelete: 'set null' },
    ),
    sourceItemId: uuid('source_item_id').references(
      () => editorialSourceItems.id,
      { onDelete: 'set null' },
    ),
    qstashMessageId: varchar('qstash_message_id', { length: 240 }),
    attemptCount: integer('attempt_count').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(3),
    retryAt: timestamp('retry_at', { withTimezone: true }),
    startedAt: timestamp('started_at', { withTimezone: true }),
    payload: jsonb('payload').$type<Record<string, unknown>>(),
    result: jsonb('result').$type<Record<string, unknown>>(),
    errorMessage: text('error_message'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('editorial_jobs_dedupe_unique').on(table.dedupeKey),
    index('editorial_jobs_status_created_idx').on(
      table.status,
      table.createdAt,
    ),
    index('editorial_jobs_status_retry_idx').on(table.status, table.retryAt),
    index('editorial_jobs_event_stage_idx').on(
      table.sourceEventId,
      table.stage,
    ),
  ],
);

export const editorialJobAttempts = pgTable(
  'editorial_job_attempts',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    jobId: uuid('job_id')
      .notNull()
      .references(() => editorialJobs.id, { onDelete: 'cascade' }),
    attemptNumber: integer('attempt_number').notNull(),
    stage: varchar('stage', { length: 40 }).notNull(),
    provider: varchar('provider', { length: 80 }),
    model: varchar('model', { length: 120 }),
    status: varchar('status', { length: 32 }).notNull().default('running'),
    retryable: boolean('retryable').notNull().default(false),
    httpStatus: integer('http_status'),
    retryAfterMs: integer('retry_after_ms'),
    upstreamRequestId: varchar('upstream_request_id', { length: 240 }),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    durationMs: integer('duration_ms'),
    errorMessage: text('error_message'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
    startedAt: timestamp('started_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('editorial_job_attempts_job_number_unique').on(
      table.jobId,
      table.attemptNumber,
    ),
    index('editorial_job_attempts_job_started_idx').on(
      table.jobId,
      table.startedAt,
    ),
    index('editorial_job_attempts_status_started_idx').on(
      table.status,
      table.startedAt,
    ),
  ],
);

export const editorialCostLedger = pgTable(
  'editorial_cost_ledger',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    idempotencyKey: varchar('idempotency_key', { length: 240 }).notNull(),
    entryType: varchar('entry_type', { length: 40 })
      .notNull()
      .default('generation'),
    status: varchar('status', { length: 32 }).notNull().default('reserved'),
    currency: varchar('currency', { length: 3 }).notNull().default('VND'),
    reservedVnd: bigint('reserved_vnd', { mode: 'number' })
      .notNull()
      .default(0),
    actualVnd: bigint('actual_vnd', { mode: 'number' }),
    provider: varchar('provider', { length: 80 }),
    model: varchar('model', { length: 120 }),
    jobId: uuid('job_id').references(() => editorialJobs.id, {
      onDelete: 'set null',
    }),
    jobAttemptId: uuid('job_attempt_id').references(
      () => editorialJobAttempts.id,
      { onDelete: 'set null' },
    ),
    articleId: uuid('article_id').references(() => articles.id, {
      onDelete: 'set null',
    }),
    revisionId: uuid('revision_id').references(() => articleRevisions.id, {
      onDelete: 'set null',
    }),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    settledAt: timestamp('settled_at', { withTimezone: true }),
    releasedAt: timestamp('released_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('editorial_cost_ledger_idempotency_unique').on(
      table.idempotencyKey,
    ),
    index('editorial_cost_ledger_status_created_idx').on(
      table.status,
      table.createdAt,
    ),
    index('editorial_cost_ledger_job_idx').on(table.jobId),
  ],
);

export const paymentOrders = pgTable(
  'payment_orders',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    plan: planCodeEnum('plan').notNull(),
    amountVnd: bigint('amount_vnd', { mode: 'number' }).notNull(),
    orderCode: varchar('order_code', { length: 32 }).notNull(),
    status: paymentOrderStatusEnum('status').notNull().default('pending'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    sepayTransactionId: bigint('sepay_transaction_id', { mode: 'number' }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex('payment_orders_order_code_unique').on(table.orderCode),
    uniqueIndex('payment_orders_sepay_transaction_unique').on(
      table.sepayTransactionId,
    ),
    index('payment_orders_user_status_idx').on(table.userId, table.status),
  ],
);

export const subscriptionPeriods = pgTable(
  'subscription_periods',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    plan: planCodeEnum('plan').notNull(),
    status: subscriptionStatusEnum('status').notNull().default('active'),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    quotaLimit: integer('quota_limit').notNull(),
    amountVnd: bigint('amount_vnd', { mode: 'number' }).notNull(),
    paymentOrderId: uuid('payment_order_id').references(() => paymentOrders.id),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index('subscription_periods_user_dates_idx').on(
      table.userId,
      table.startsAt,
      table.endsAt,
    ),
    index('subscription_periods_status_idx').on(table.status),
  ],
);

export const donationOrders = pgTable(
  'donation_orders',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    accessTokenHash: varchar('access_token_hash', { length: 64 }),
    amountVnd: bigint('amount_vnd', { mode: 'number' }).notNull(),
    orderCode: varchar('order_code', { length: 32 }).notNull(),
    displayName: varchar('display_name', { length: 120 }),
    isAnonymous: boolean('is_anonymous').notNull().default(true),
    leaderboardOptIn: boolean('leaderboard_opt_in').notNull().default(false),
    status: donationOrderStatusEnum('status').notNull().default('pending'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    sepayTransactionId: bigint('sepay_transaction_id', { mode: 'number' }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex('donation_orders_order_code_unique').on(table.orderCode),
    uniqueIndex('donation_orders_sepay_transaction_unique').on(
      table.sepayTransactionId,
    ),
    index('donation_orders_status_created_idx').on(
      table.status,
      table.createdAt,
    ),
    index('donation_orders_user_status_idx').on(table.userId, table.status),
  ],
);

export const sepayTransactions = pgTable(
  'sepay_transactions',
  {
    sepayId: bigint('sepay_id', { mode: 'number' }).primaryKey(),
    paymentOrderId: uuid('payment_order_id').references(() => paymentOrders.id),
    donationOrderId: uuid('donation_order_id').references(
      () => donationOrders.id,
    ),
    gateway: varchar('gateway', { length: 100 }).notNull(),
    accountNumber: varchar('account_number', { length: 100 }).notNull(),
    transferType: varchar('transfer_type', { length: 20 }).notNull(),
    amountVnd: bigint('amount_vnd', { mode: 'number' }).notNull(),
    orderCode: varchar('order_code', { length: 32 }),
    referenceCode: varchar('reference_code', { length: 255 }),
    transactionDate: timestamp('transaction_date', { withTimezone: true }),
    rawBodyHash: varchar('raw_body_hash', { length: 64 }).notNull(),
    status: sepayProcessingStatusEnum('status').notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index('sepay_transactions_order_code_idx').on(table.orderCode),
    index('sepay_transactions_status_idx').on(table.status),
  ],
);

export const aiUsageEvents = pgTable(
  'ai_usage_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    clientRequestId: uuid('client_request_id').notNull(),
    bucket: usageBucketEnum('bucket').notNull(),
    periodId: uuid('period_id').references(() => subscriptionPeriods.id),
    capability: capabilityEnum('capability').notNull(),
    status: usageStatusEnum('status').notNull().default('reserved'),
    reservedAt: timestamp('reserved_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    provider: varchar('provider', { length: 40 }),
    model: varchar('model', { length: 120 }),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    totalTokens: integer('total_tokens'),
    durationMs: integer('duration_ms'),
    costVnd: bigint('cost_vnd', { mode: 'number' }).notNull().default(0),
  },
  (table) => [
    uniqueIndex('ai_usage_user_request_unique').on(
      table.userId,
      table.clientRequestId,
    ),
    index('ai_usage_user_bucket_status_idx').on(
      table.userId,
      table.bucket,
      table.status,
    ),
    index('ai_usage_user_bucket_reserved_status_idx').on(
      table.userId,
      table.bucket,
      table.reservedAt,
      table.status,
    ),
    index('ai_usage_period_status_idx').on(table.periodId, table.status),
  ],
);

export const analysisRuns = pgTable(
  'analysis_runs',
  {
    requestId: uuid('request_id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    goal: varchar('goal', { length: 20 }),
    promptVersion: varchar('prompt_version', { length: 40 }).notNull(),
    provider: varchar('provider', { length: 40 }),
    model: varchar('model', { length: 120 }),
    outcome: varchar('outcome', { length: 30 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index('analysis_runs_user_created_idx').on(table.userId, table.createdAt),
  ],
);

export const analysisFeedback = pgTable(
  'analysis_feedback',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    requestId: uuid('request_id')
      .notNull()
      .references(() => analysisRuns.requestId, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    rating: integer('rating').notNull(),
    reason: varchar('reason', { length: 40 }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex('analysis_feedback_user_request_unique').on(
      table.userId,
      table.requestId,
    ),
    index('analysis_feedback_created_idx').on(table.createdAt),
  ],
);

export const billingAuditEvents = pgTable(
  'billing_audit_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    actorUserId: uuid('actor_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    eventType: varchar('event_type', { length: 60 }).notNull(),
    entityType: varchar('entity_type', { length: 60 }).notNull(),
    entityId: varchar('entity_id', { length: 100 }),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index('billing_audit_user_created_idx').on(table.userId, table.createdAt),
    index('billing_audit_entity_idx').on(table.entityType, table.entityId),
  ],
);

export const marketHistoryPoints = pgTable(
  'market_history_points',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    provider: varchar('provider', { length: 120 }).notNull(),
    companyId: varchar('company_id', { length: 64 }).notNull(),
    productId: varchar('product_id', { length: 128 }).notNull(),
    region: varchar('region', { length: 128 }).notNull().default(''),
    date: date('date').notNull(),
    buyVndPerLuong: bigint('buy_vnd_per_luong', { mode: 'number' }),
    sellVndPerLuong: bigint('sell_vnd_per_luong', { mode: 'number' }),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    retrievedAt: timestamp('retrieved_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    sourceUrl: text('source_url'),
    status: marketHistoryPointStatusEnum('status').notNull(),
    errorMessage: text('error_message'),
    rawPayload: jsonb('raw_payload').$type<Record<string, unknown>>(),
  },
  (table) => [
    uniqueIndex('market_history_points_identity_unique').on(
      table.provider,
      table.companyId,
      table.productId,
      table.region,
      table.date,
    ),
    index('market_history_points_lookup_idx').on(
      table.companyId,
      table.productId,
      table.date,
    ),
    index('market_history_points_status_date_idx').on(table.status, table.date),
  ],
);

export const marketHistorySyncRuns = pgTable(
  'market_history_sync_runs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    syncKey: varchar('sync_key', { length: 200 }).notNull(),
    provider: varchar('provider', { length: 120 }).notNull(),
    companyId: varchar('company_id', { length: 64 }).notNull(),
    productId: varchar('product_id', { length: 128 }).notNull(),
    requestedStart: date('requested_start').notNull(),
    requestedEnd: date('requested_end').notNull(),
    status: marketHistorySyncRunStatusEnum('status').notNull(),
    expectedDays: integer('expected_days').notNull().default(0),
    okDays: integer('ok_days').notNull().default(0),
    missingDays: integer('missing_days').notNull().default(0),
    errorDays: integer('error_days').notNull().default(0),
    message: text('message'),
    startedAt: timestamp('started_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (table) => [
    index('market_history_sync_runs_lookup_idx').on(
      table.syncKey,
      table.startedAt,
    ),
    index('market_history_sync_runs_status_idx').on(table.status),
  ],
);
