import { expect, test } from '@playwright/test';
import { encode } from 'next-auth/jwt';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import sharp from 'sharp';
import type {
  ReviewDetail,
  ReviewInbox,
  ReviewSlot,
} from '@/lib/editorial/review-types';

function fixture(index: number): ReviewDetail {
  return {
    articleId: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    revisionId: `10000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    slug: 'test-' + index,
    title: 'Tin vàng kiểm thử ' + index,
    excerpt: 'Đoạn dẫn được kiểm chứng từ nguồn chính thức.',
    category: 'news',
    articleStatus: 'draft',
    approvalStatus: 'pending',
    revisionStatus: 'draft',
    createdAt: '2026-10-01T00:00:00.000Z',
    approvedAt: null,
    reviewNote: null,
    sourceCount: 1,
    evidenceCount: 1,
    coverImageUrl: '/brand/covers/news.webp',
    version: 'a'.repeat(64),
    readiness: { ready: true, blockers: [], warnings: [] },
    contentMarkdown: `## Toàn văn bài ${index}\n\nDữ kiện để Admin đọc trước khi duyệt.`,
    sources: [
      {
        title: 'Nguồn giữ nguyên metadata',
        url: 'https://sjc.com.vn/',
        publishedAt: '2026-09-30T00:00:00.000Z',
        accessedAt: '2026-10-01T00:00:00.000Z',
      },
    ],
    evidence: [
      {
        label: 'Giá SJC',
        value: '100 triệu đồng',
        observedAt: '2026-10-01T00:00:00.000Z',
      },
    ],
    seoTitle: 'Tiêu đề SEO giữ nguyên',
    seoDescription: 'Mô tả giữ nguyên.',
    coverAlt: 'Ảnh thương hiệu',
    coverImageAlt: 'Ảnh thương hiệu',
    coverImageDisclosure: 'Brand',
  };
}
async function signIn(page: import('@playwright/test').Page) {
  const email = process.env.E2E_ADMIN_EMAIL ?? 'e2e-admin@example.test';
  const token = await encode({
    secret: process.env.E2E_AUTH_SECRET ?? 'e2e-auth-secret',
    salt: 'authjs.session-token',
    token: { sub: email, email, name: 'Editorial Test' },
  });
  await page.context().addCookies([
    {
      name: 'authjs.session-token',
      value: token,
      url: 'http://127.0.0.1:3000',
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);
}
type State = {
  items: ReviewDetail[];
  requests: Record<string, unknown>[];
  slots: ReviewSlot[];
  delaySave?: Promise<void>;
  delayNextList?: Promise<void>;
  failRefresh?: boolean;
  failItem?: string;
  serverNow: string;
};
async function setup(
  page: import('@playwright/test').Page,
  count = 5,
): Promise<State> {
  await signIn(page);
  const state: State = {
    items: Array.from({ length: count }, (_, i) => fixture(i + 1)),
    requests: [],
    slots: [],
    serverNow: '2026-10-02T00:00:00.000Z',
  };
  state.slots = (['morning', 'noon', 'evening'] as const).map((slot, i) => ({
    id: 'slot-' + i,
    localDate: '2026-10-02',
    slot,
    scheduledAt: `2026-10-02T${['01:30', '05:00', '10:00'][i]}:00.000Z`,
    status: 'scheduled',
    articleId: 'occupied',
    revisionId: 'occupied',
    title: 'Bài đã xếp lịch',
    failureMessage: null,
    revisionVersion: 'a'.repeat(64),
  }));
  await page.route('**/api/admin/articles**', async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    if (method === 'GET') {
      if (url.pathname !== '/api/admin/articles') {
        const item = state.items.find(
          (item) => item.articleId === url.pathname.split('/')[4],
        );
        await route.fulfill({ json: { item } });
        return;
      }
      if (state.failRefresh) {
        await route.fulfill({
          status: 503,
          json: { error: 'Refresh bị lỗi thử nghiệm' },
        });
        return;
      }
      const group = url.searchParams.get('group') ?? 'pending';
      const filtered = state.items.filter((item) =>
        group === 'approved'
          ? item.approvalStatus === 'approved'
          : group === 'attention'
            ? item.approvalStatus === 'changes_requested'
            : item.approvalStatus === 'pending',
      );
      const inbox: ReviewInbox = {
        items: filtered.map(
          ({
            contentMarkdown: _body,
            sources: _sources,
            evidence: _evidence,
            ...item
          }) => item,
        ),
        counts: {
          pending: state.items.filter(
            (item) => item.approvalStatus === 'pending',
          ).length,
          approved: state.items.filter(
            (item) => item.approvalStatus === 'approved',
          ).length,
          scheduled: 3,
          attention: 0,
        },
        slots: state.slots.map((slot) => ({
          ...slot,
          localDate: url.searchParams.get('date') ?? '2026-10-02',
        })),
        localDate: state.serverNow.slice(0, 10),
        serverNow: state.serverNow,
        hasActiveJobs: false,
        page: 1,
        total: filtered.length,
        pageSize: 20,
      };
      const delay = state.delayNextList;
      state.delayNextList = undefined;
      if (delay) await delay;
      await route.fulfill({ json: inbox }).catch(() => undefined);
      return;
    }
    const body = route.request().postDataJSON() as Record<string, unknown>;
    state.requests.push(body);
    if (method === 'PATCH') {
      if (state.delaySave) await state.delaySave;
      const item = state.items.find(
        (item) => item.articleId === url.pathname.split('/')[4],
      )!;
      Object.assign(item, body, {
        revisionId: '20000000-0000-4000-8000-000000000001',
        version: 'b'.repeat(64),
        approvalStatus: 'pending',
      });
      await route.fulfill({ json: { item } });
      return;
    }
    if (body.action === 'approve') {
      const targets = body.targets as {
        articleId: string;
        revisionId: string;
        version: string;
      }[];
      const results = targets.map((target) => {
        const item = state.items.find(
          (item) => item.articleId === target.articleId,
        )!;
        if (item.articleId === state.failItem)
          return {
            ...target,
            ok: false,
            error: 'Bài đã có phiên bản mới.',
            status: 409,
          };
        Object.assign(item, {
          approvalStatus: 'approved',
          revisionStatus: 'reviewed',
        });
        return { ...target, ok: true, item };
      });
      await route.fulfill({ json: { results } });
      return;
    }
    await route.fulfill({ json: { message: 'Đã nhận yêu cầu.' } });
  });
  await page.goto('/admin/bai-viet');
  await expect(
    page.getByRole('button', { name: 'Xem bài', exact: true }).first(),
  ).toBeVisible();
  return state;
}

for (const width of [1440, 390]) {
  test(`opens full body and cover with one action at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await setup(page);
    await page
      .getByRole('button', { name: 'Xem bài', exact: true })
      .first()
      .click();
    const preview =
      width < 1280
        ? page.getByRole('dialog')
        : page.getByRole('complementary', { name: 'Bản xem trước' });
    await expect(
      preview.getByRole('heading', { name: 'Toàn văn bài 1' }),
    ).toBeVisible();
    await expect(
      preview.getByRole('img', { name: 'Ảnh thương hiệu' }),
    ).toBeVisible();
    await expect(
      preview.getByRole('button', { name: 'Duyệt', exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    if (width < 1280)
      expect(Math.round((await preview.boundingBox())!.width)).toBe(width);
    await page.screenshot({
      path: `outputs/editorial-implementation/admin-${width}.png`,
      fullPage: width >= 1280,
    });
  });
}
test('approves five articles even when all three slots are occupied', async ({
  page,
}) => {
  const state = await setup(page);
  for (let i = 1; i <= 5; i++)
    await page
      .getByRole('checkbox', {
        name: 'Chọn Tin vàng kiểm thử ' + i,
        exact: true,
      })
      .check();
  await page.getByRole('button', { name: 'Duyệt 5 bài', exact: true }).click();
  await expect
    .poll(
      () =>
        state.items.filter((item) => item.approvalStatus === 'approved').length,
    )
    .toBe(5);
  expect((state.requests[0].targets as unknown[]).length).toBe(5);
  expect(state.requests[0]).not.toHaveProperty('slot');
});
test('keeps the failed item selected after a partially successful bulk approval', async ({
  page,
}) => {
  const state = await setup(page, 2);
  state.failItem = state.items[1].articleId;
  await page
    .getByRole('checkbox', { name: 'Chọn Tin vàng kiểm thử 1', exact: true })
    .check();
  await page
    .getByRole('checkbox', { name: 'Chọn Tin vàng kiểm thử 2', exact: true })
    .check();
  await page.getByRole('button', { name: 'Duyệt 2 bài', exact: true }).click();
  await expect(
    page.getByText('Bài đã có phiên bản mới.', { exact: false }).first(),
  ).toBeVisible();
  await expect(
    page.getByRole('checkbox', {
      name: 'Chọn Tin vàng kiểm thử 2',
      exact: true,
    }),
  ).toBeChecked();
});
test('a typo-only quick edit sends only the changed field and exact revision identity', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const state = await setup(page);
  await page
    .getByRole('button', { name: 'Xem bài', exact: true })
    .first()
    .click();
  await page.getByRole('button', { name: 'Sửa nhanh', exact: true }).click();
  await page
    .getByRole('complementary', { name: 'Bản xem trước' })
    .getByLabel('Tiêu đề', { exact: true })
    .fill('Tiêu đề chỉ sửa lỗi chữ');
  await page
    .getByRole('button', { name: 'Lưu phiên bản mới', exact: true })
    .click();
  await expect.poll(() => state.requests.length).toBe(1);
  expect(Object.keys(state.requests[0]).sort()).toEqual([
    'articleId',
    'revisionId',
    'title',
    'version',
  ]);
  expect(state.items[0].sources[0].title).toBe('Nguồn giữ nguyên metadata');
  expect(state.items[0].evidence).toHaveLength(1);
  expect(state.items[0].seoTitle).toBe('Tiêu đề SEO giữ nguyên');
});
test('a slow save protects its fields without locking another article', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const state = await setup(page);
  let release!: () => void;
  state.delaySave = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page
    .getByRole('button', { name: 'Xem bài', exact: true })
    .first()
    .click();
  await page.getByRole('button', { name: 'Sửa nhanh', exact: true }).click();
  await page
    .getByRole('complementary', { name: 'Bản xem trước' })
    .getByLabel('Tiêu đề', { exact: true })
    .fill('Lưu chậm nhưng không mất dữ liệu');
  await page
    .getByRole('button', { name: 'Lưu phiên bản mới', exact: true })
    .click();
  await expect(
    page
      .getByRole('complementary', { name: 'Bản xem trước' })
      .getByLabel('Tiêu đề', { exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole('checkbox', {
      name: 'Chọn Tin vàng kiểm thử 2',
      exact: true,
    }),
  ).toBeEnabled();
  release();
  await expect(
    page
      .getByRole('complementary', { name: 'Bản xem trước' })
      .getByLabel('Tiêu đề', { exact: true }),
  ).toHaveCount(0);
});
test('refresh failure after approval preserves success and unlocks other articles', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const state = await setup(page);
  await page
    .getByRole('button', { name: 'Xem bài', exact: true })
    .first()
    .click();
  await expect(
    page.getByRole('heading', { name: 'Toàn văn bài 1' }),
  ).toBeVisible();
  state.failRefresh = true;
  await page.getByRole('button', { name: 'Duyệt', exact: true }).click();
  await expect.poll(() => state.items[0].approvalStatus).toBe('approved');
  await expect(
    page.getByRole('alert').filter({ hasText: 'Refresh bị lỗi' }),
  ).toContainText('Refresh bị lỗi');
  await expect(
    page.getByRole('checkbox', {
      name: 'Chọn Tin vàng kiểm thử 2',
      exact: true,
    }),
  ).toBeEnabled();
});
test('midnight refresh replaces the old date with the server Vietnam date', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const state = await setup(page, 1);
  state.items[0].approvalStatus = 'approved';
  state.items[0].revisionStatus = 'reviewed';
  state.slots.forEach((slot) => {
    slot.status = 'open';
    slot.articleId = null;
    slot.revisionId = null;
  });
  await page.getByRole('button', { name: /^Đã duyệt/ }).click();
  await page.getByRole('button', { name: 'Xem bài', exact: true }).click();
  await expect(page.getByLabel('Ngày đăng', { exact: true })).toHaveValue(
    '2026-10-02',
  );
  state.serverNow = '2026-10-03T00:01:00.000Z';
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByLabel('Ngày đăng', { exact: true })).toHaveValue(
    '2026-10-03',
  );
});
test('an old delayed list response cannot overwrite a completed approval', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const state = await setup(page, 2);
  await page
    .getByRole('button', { name: 'Xem bài', exact: true })
    .first()
    .click();
  await expect(
    page.getByRole('button', { name: 'Duyệt', exact: true }),
  ).toBeVisible();
  let release!: () => void;
  state.delayNextList = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.getByRole('button', { name: 'Làm mới', exact: true }).click();
  await page.getByRole('button', { name: 'Duyệt', exact: true }).click();
  await expect.poll(() => state.items[0].approvalStatus).toBe('approved');
  release();
  await expect(
    page.getByRole('checkbox', {
      name: 'Chọn Tin vàng kiểm thử 1',
      exact: true,
    }),
  ).toHaveCount(0);
});
test('the real authenticated HTTP routes preserve metadata and approve without slots', async ({
  page,
}) => {
  await signIn(page);
  await page.goto('/admin/bai-viet');
  const template = fixture(77);
  const origin = new URL(page.url()).origin;
  const createdResponse = await page.request.post('/api/admin/articles', {
    headers: { origin },
    data: {
      action: 'create',
      title: template.title,
      excerpt: template.excerpt,
      contentMarkdown: template.contentMarkdown,
      category: 'news',
      sources: template.sources,
      evidence: template.evidence,
    },
  });
  expect(createdResponse.status()).toBe(201);
  const created = (await createdResponse.json()).item as ReviewDetail;
  const editedResponse = await page.request.patch(
    '/api/admin/articles/' + created.articleId,
    {
      headers: { origin },
      data: {
        revisionId: created.revisionId,
        version: created.version,
        title: 'HTTP sửa một lỗi chữ',
      },
    },
  );
  expect(editedResponse.status()).toBe(201);
  const edited = (await editedResponse.json()).item as ReviewDetail;
  expect(edited.evidence).toEqual(created.evidence);
  expect(edited.sources).toEqual(created.sources);
  const approved = await page.request.post('/api/admin/articles', {
    headers: { origin },
    data: {
      action: 'approve',
      targets: [
        {
          articleId: edited.articleId,
          revisionId: edited.revisionId,
          version: edited.version,
        },
      ],
    },
  });
  expect(approved.status()).toBe(200);
  expect((await approved.json()).results[0].ok).toBe(true);
  const outdated = await page.request.patch(
    '/api/admin/articles/' + created.articleId,
    {
      headers: { origin },
      data: {
        revisionId: created.revisionId,
        version: created.version,
        title: 'Không được ghi đè bản mới',
      },
    },
  );
  expect(outdated.status()).toBe(409);
  const summary = await page.request.get('/api/admin/articles?group=approved');
  expect(summary.status()).toBe(200);
  expect((await summary.json()).items[0]).not.toHaveProperty('contentMarkdown');
});

test('the signed bridge validates a real multipart body and fails closed without an isolated Blob token', async ({
  baseURL,
}) => {
  const hash = (bytes: string | Uint8Array) =>
    createHash('sha256').update(bytes).digest('hex');
  const key = 'e2e-hermes-bridge-signature-secret-32';
  const sign = (method: string, path: string, body: Uint8Array) => {
    const ts = String(Math.floor(Date.now() / 1000));
    return {
      'x-editorial-client': 'kim-tuyen-newsroom',
      'x-editorial-timestamp': ts,
      'x-editorial-signature': createHmac('sha256', key)
        .update([method, path, ts, hash(body)].join('\n'))
        .digest('hex'),
    };
  };
  const contentMarkdown =
    '## Bài kiểm chứng\n\nNội dung thực hiện kiểm thử tích hợp riêng.';
  const caption = 'Bản caption Facebook kiểm thử riêng.';
  const ident = randomUUID();
  const manifest = {
    rootId: ident,
    draftId: ident,
    externalRevision: 1,
    website: {
      title: 'Bridge E2E một lần duyệt',
      excerpt: 'Đoạn dẫn cho bài kiểm thử bridge hai kênh.',
      contentMarkdown,
      category: 'news',
      sources: [
        {
          title: 'Kitco',
          url: 'https://www.kitco.com/',
          accessedAt: new Date().toISOString(),
        },
      ],
      evidence: [],
      seoTitle: 'Bridge E2E',
      seoDescription: 'Bản kiểm thử riêng, không production.',
      coverAlt: 'Ảnh vàng',
    },
    facebook: {
      pageId: '1262243656966414',
      caption,
      sourceComment: 'Nguồn: https://www.kitco.com/',
    },
    verification: {
      verdict: 'PASS',
      websiteDigest: hash(contentMarkdown),
      captionDigest: hash(caption),
    },
  };
  const image = await sharp({
    create: { width: 1200, height: 675, channels: 3, background: '#c19c44' },
  })
    .png()
    .toBuffer();
  const form = new FormData();
  form.set('manifest', JSON.stringify(manifest));
  form.set(
    'image',
    new Blob([new Uint8Array(image)], { type: 'image/png' }),
    'approved.png',
  );
  const path = '/api/editorial/integrations/hermes/prepare';
  const prepared = new Request(baseURL + path, { method: 'POST', body: form });
  const bytes = new Uint8Array(await prepared.arrayBuffer());
  const response = await fetch(baseURL + path, {
    method: 'POST',
    headers: {
      ...Object.fromEntries(prepared.headers),
      ...sign('POST', path, bytes),
    },
    body: bytes,
  });
  // Blob is an external service: absent isolated Blob credentials fail safely
  // before public article creation. Real storage/readback is checked in staging.
  if (response.status === 503) {
    const result = await response.json();
    expect(result.error).toContain('Dịch vụ chưa sẵn sàng');
    return;
  }
  expect(response.status).toBe(200);
  const pack = await response.json();
  expect(hash(pack.canonicalPackage)).toBe(pack.reviewDigest);
  expect(pack.websitePublic).toBe(false);
  const publishPath =
    '/api/editorial/integrations/hermes/packages/' +
    pack.packageId +
    '/publish';
  const body = Buffer.from(
    JSON.stringify({
      reviewDigest: pack.reviewDigest,
      actorId: '1758923792',
      chatId: '-1003759063639',
      reviewMessageId: '100',
      callbackId: ident,
      approvedAt: new Date().toISOString(),
    }),
  );
  const published = await fetch(baseURL + publishPath, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...sign('POST', publishPath, body),
    },
    body,
  });
  expect(published.status).toBe(200);
  const receipt = await published.json();
  expect(receipt.websitePublic).toBe(true);
});
