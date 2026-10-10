import { expect, request as playwrightRequest, test, type APIRequestContext } from '@playwright/test';
import { encode } from 'next-auth/jwt';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';

type Article = { articleId: string; revisionId: string; version: string; slug: string; title: string };

test('real Next ISR invalidates warmed public pages and keeps newer drafts private', async ({ request, baseURL }) => {
  test.setTimeout(90_000);
  const connectionString = process.env.E2E_DATABASE_URL;
  test.skip(!connectionString, 'Requires the isolated local editorial test database.');
  const database = new URL(connectionString!);
  const origin = new URL(baseURL!).origin;
  if (!['127.0.0.1', 'localhost'].includes(database.hostname) || !/test/i.test(database.pathname) || !['127.0.0.1', 'localhost'].includes(new URL(origin).hostname)) {
    throw new Error('Cache mutation checks are restricted to a local test server and database.');
  }
  const email = process.env.E2E_ADMIN_EMAIL ?? 'e2e-admin@example.test';
  const token = await encode({
    secret: process.env.E2E_AUTH_SECRET ?? 'e2e-auth-secret',
    salt: 'authjs.session-token',
    token: { sub: email, email, name: 'Cache Test' },
  });
  const admin = await playwrightRequest.newContext({
    baseURL,
    extraHTTPHeaders: { origin, cookie: `authjs.session-token=${token}` },
  });
  const pool = new Pool({ connectionString, max: 1 });
  const fixtures: Article[] = [];
  const id = randomUUID().slice(0, 8);

  async function create(label: string) {
    const response = await admin.post('/api/admin/articles', { data: {
      action: 'create', category: 'news', title: `Cache ${id} ${label}`,
      excerpt: `Public cache fixture ${id} ${label} has reviewed source evidence.`,
      contentMarkdown: `## Published body ${id} ${label}\n\nIsolated local cache verification with reviewed evidence.`,
      sources: [], evidence: [{ label: 'Fixture', value: 'Local test only' }],
    } });
    expect(response.status(), await response.text()).toBe(201);
    const item = (await response.json()).item as Article;
    fixtures.push(item);
    return item;
  }
  async function hideTranslation(article: Article) {
    const response = await admin.post('/api/admin/articles', { data: { action: 'hide_translation', revisionId: article.revisionId } });
    expect(response.status(), await response.text()).toBe(200);
  }
  async function html(path: string, client: APIRequestContext = request) {
    const response = await client.get(path);
    expect(response.status()).toBe(200);
    return { response, body: await response.text() };
  }
  async function unpublish(article: Article) {
    const detail = await admin.get(`/api/admin/articles/${article.articleId}`);
    expect(detail.status(), await detail.text()).toBe(200);
    const current = (await detail.json()).item as Article;
    const response = await admin.post('/api/admin/articles', { data: {
      action: 'unpublish', articleId: article.articleId, revisionId: current.revisionId, version: current.version,
    } });
    expect(response.status(), await response.text()).toBe(200);
  }

  try {
    const first = await create('first');
    const related = await create('related');
    const draft = await create('private-draft');
    // Fixture publication is direct SQL; production publication hooks are covered
    // by the database suite. Cache expiry below uses real authenticated handlers.
    for (const article of [first, related]) {
      await pool.query("update article_revisions set status='published', approval_status='approved' where id=$1", [article.revisionId]);
      await pool.query("update articles set status='published', published_revision_id=$2, published_category='news', published_at=now(), public_modified_at=now(), pinned_until=now()+interval '1 day' where id=$1", [article.articleId, article.revisionId]);
      await pool.query("insert into article_translations(source_revision_id, locale, status, title, excerpt, content_markdown) values($1, 'en', 'ready', 'English fixture', 'English fixture excerpt', 'English fixture body')", [article.revisionId]);
    }
    await hideTranslation(first);

    const firstPath = `/nhip-vang/${first.slug}`;
    const relatedPath = `/nhip-vang/${related.slug}`;
    const detail = await html(firstPath);
    expect(detail.body).toContain(first.title);
    expect(detail.body).toContain(`data-revision-id="${first.revisionId}"`);
    expect((await html(firstPath)).response.headers()['x-nextjs-cache']).toBe('HIT');
    await html('/');
    const home = await html('/');
    expect(home.response.headers()['x-nextjs-cache']).toBe('HIT');
    expect(home.body).toContain(first.title);
    expect((await html('/nhip-vang')).body).toContain(first.title);
    expect((await html('/nhip-vang?category=news&page=1')).body).toContain(first.title);
    expect((await html(relatedPath)).body).toContain(first.title);
    expect((await html('/nhip-vang')).body).not.toContain(draft.title);
    const hidden = await request.get(`/nhip-vang/${draft.slug}`);
    expect(await hidden.text()).not.toContain(draft.title);

    const replacementTitle = `Private replacement ${id}`;
    const edited = await admin.patch(`/api/admin/articles/${first.articleId}`, { data: {
      revisionId: first.revisionId, version: first.version,
      title: replacementTitle, seoTitle: replacementTitle,
      contentMarkdown: `## Secret replacement ${id}\n\nNew draft must not replace approved public content.`,
    } });
    expect(edited.status(), await edited.text()).toBe(201);
    const replacement = (await edited.json()).item as Article;
    // Expire caches so this proves the database read stays on publishedRevisionId.
    await hideTranslation(first);
    const afterDraft = await html(firstPath);
    expect(afterDraft.body).toContain(first.title);
    expect(afterDraft.body).not.toContain(`Private replacement ${id}`);
    expect(afterDraft.body).not.toContain(`Secret replacement ${id}`);
    expect(afterDraft.body).toContain(`data-revision-id="${first.revisionId}"`);

    // Switch the published revision, then use the real post-commit invalidation
    // hook. Publication transactions and their hook calls have database tests.
    const oldTitle = first.title;
    await pool.query("update article_revisions set status='superseded' where id=$1", [first.revisionId]);
    await pool.query("update article_revisions set status='published', approval_status='approved' where id=$1", [replacement.revisionId]);
    await pool.query("update articles set published_revision_id=$2, public_modified_at=now() where id=$1", [first.articleId, replacement.revisionId]);
    await hideTranslation(related);
    first.revisionId = replacement.revisionId;
    first.version = replacement.version;
    first.title = replacementTitle;
    const republished = await html(firstPath);
    expect(republished.body).toContain(`data-revision-id="${replacement.revisionId}"`);
    expect(republished.body).toContain(`<meta property="og:title" content="${replacementTitle}"`);
    expect(republished.body).toContain(`Secret replacement ${id}`);
    expect(republished.body).not.toContain(oldTitle);
    const schemas = [...republished.body.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)]
      .map(match => JSON.parse(match[1]) as { headline?: string });
    expect(schemas.some(schema => schema.headline === replacementTitle)).toBe(true);
    for (const path of ['/', '/nhip-vang', relatedPath]) {
      const current = (await html(path)).body;
      expect(current).toContain(replacementTitle);
      expect(current).not.toContain(oldTitle);
    }

    // Prime every consumer, then exercise the real transaction + hard expiry.
    await html('/');
    await html('/nhip-vang');
    await html('/nhip-vang?category=news&page=1');
    await html(relatedPath);
    await unpublish(first);
    for (const path of ['/', '/nhip-vang', '/nhip-vang?category=news&page=1', relatedPath]) {
      expect((await html(path)).body, `withdrawn card in ${path}`).not.toContain(first.title);
    }
    const removed = await request.get(firstPath);
    expect(await removed.text()).not.toContain(first.title);
    expect(await removed.text()).not.toContain(`Published body ${id} first`);
    expect((await pool.query('select status, published_revision_id from articles where id=$1', [first.articleId])).rows[0]).toEqual({ status: 'archived', published_revision_id: null });

    // A slug already cached as missing becomes visible after a public commit and
    // the same shared hard-expiry hook, without a new build or a TTL wait.
    await pool.query("update article_revisions set status='published' where id=$1", [draft.revisionId]);
    await pool.query("update articles set status='published', published_revision_id=$2, published_at=now(), published_category='news' where id=$1", [draft.articleId, draft.revisionId]);
    await hideTranslation(related);
    expect((await html(`/nhip-vang/${draft.slug}`)).body).toContain(draft.title);

    const oldLocale = await request.get('/', { headers: { cookie: 'kim-tuyen-locale=en' } });
    expect(await oldLocale.text()).toContain('<html lang="vi"');
    expect((await request.get('/api/admin/articles')).status()).toBe(401);
  } finally {
    // Only IDs created by this test are removed; never truncate shared fixtures.
    for (const article of fixtures) {
      await unpublish(article).catch(() => undefined);
      await pool.query('delete from articles where id=$1', [article.articleId]);
    }
    await admin.dispose();
    await pool.end();
  }
});
