import { expect, test, type Locator, type Page } from '@playwright/test';

const responsiveViewports = [
  { width: 320, height: 700 },
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1440, height: 960 },
] as const;

type MaterialSnapshot = {
  supportsBackdropFilter: boolean;
  prefersReducedTransparency: boolean;
  backdropFilter: string;
  webkitBackdropFilter: string;
  backdropFilterProperty: string;
  webkitBackdropFilterProperty: string;
  backgroundColor: string;
};

async function openHome(page: Page) {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.glass-header')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-locale', 'vi');
}

async function expectNoHorizontalOverflow(page: Page) {
  const metrics = await page.evaluate(() => ({
    viewportWidth: window.innerWidth,
    documentScrollWidth: document.documentElement.scrollWidth,
  }));

  // A one-pixel allowance prevents fractional layout rounding from producing a
  // false positive while still catching a real horizontal scrollbar.
  expect(metrics.documentScrollWidth).toBeLessThanOrEqual(
    metrics.viewportWidth + 1,
  );
}

async function readMaterial(locator: Locator): Promise<MaterialSnapshot> {
  return locator.evaluate((node) => {
    const style = getComputedStyle(node);
    const webkitStyle = style as CSSStyleDeclaration & {
      webkitBackdropFilter?: string;
    };

    return {
      supportsBackdropFilter:
        CSS.supports('backdrop-filter', 'blur(1px)') ||
        CSS.supports('-webkit-backdrop-filter', 'blur(1px)'),
      prefersReducedTransparency: matchMedia('(prefers-reduced-transparency: reduce)').matches,
      backdropFilter: style.backdropFilter,
      webkitBackdropFilter: webkitStyle.webkitBackdropFilter ?? '',
      backdropFilterProperty: style.getPropertyValue('backdrop-filter'),
      webkitBackdropFilterProperty: style.getPropertyValue(
        '-webkit-backdrop-filter',
      ),
      backgroundColor: style.backgroundColor,
    };
  });
}

function backdropFilterIsEnabled(snapshot: MaterialSnapshot) {
  return [
    snapshot.backdropFilter,
    snapshot.webkitBackdropFilter,
    snapshot.backdropFilterProperty,
    snapshot.webkitBackdropFilterProperty,
  ].some((value) => value !== '' && value !== 'none');
}

function alphaFromComputedColor(color: string) {
  if (color === 'transparent') return 0;

  const slashAlpha = color.match(/\/\s*([\d.]+%?)\s*\)?$/)?.[1];
  if (slashAlpha) {
    const alpha = Number.parseFloat(slashAlpha);
    return slashAlpha.endsWith('%') ? alpha / 100 : alpha;
  }

  const rgbaParts = color.match(/^rgba\((.+)\)$/i)?.[1].split(',');
  if (rgbaParts?.length === 4) return Number.parseFloat(rgbaParts[3]);

  return 1;
}

async function expectTranslucentMaterial(locator: Locator, label: string) {
  await expect(locator, `${label} should be visible`).toBeVisible();
  const snapshot = await readMaterial(locator);

  if (snapshot.prefersReducedTransparency) {
    expect(
      alphaFromComputedColor(snapshot.backgroundColor),
      `${label} should use an opaque fallback when reduced transparency is preferred`,
    ).toBeGreaterThanOrEqual(0.99);
    return;
  }

  if (!snapshot.supportsBackdropFilter) return;

  expect(
    backdropFilterIsEnabled(snapshot),
    `${label} should retain a blur material where the browser supports it: ${JSON.stringify(snapshot)}`,
  ).toBe(true);
  expect(
    alphaFromComputedColor(snapshot.backgroundColor),
    `${label} should use a translucent material background`,
  ).toBeLessThan(0.99);
}

async function expectOpaqueMaterial(locator: Locator, label: string) {
  await expect(locator, `${label} should be visible`).toBeVisible();
  const snapshot = await readMaterial(locator);
  expect(
    alphaFromComputedColor(snapshot.backgroundColor),
    `${label} should have a solid background for reading: ${JSON.stringify(snapshot)}`,
  ).toBeGreaterThanOrEqual(0.99);
  expect(
    backdropFilterIsEnabled(snapshot),
    `${label} should not blur the text and data above it`,
  ).toBe(false);
}

async function installFloatingSurfaceProbes(page: Page) {
  await page.evaluate(() => {
    document.getElementById('liquid-glass-e2e-probes')?.remove();

    const probes = document.createElement('div');
    probes.id = 'liquid-glass-e2e-probes';
    probes.setAttribute('aria-hidden', 'true');

    const dialog = document.createElement('div');
    dialog.className = 'glass-dialog';
    dialog.dataset.liquidGlassProbe = 'dialog';
    dialog.textContent = 'Dialog material probe';
    dialog.style.cssText = [
      'position: fixed',
      'top: 50%',
      'left: 50%',
      'z-index: 60',
      'width: min(300px, calc(100vw - 32px))',
      'padding: 16px',
      'pointer-events: none',
      'transform: translate(-50%, -50%)',
    ].join(';');

    const sheet = document.createElement('div');
    sheet.className = 'glass-sheet';
    sheet.dataset.liquidGlassProbe = 'sheet';
    sheet.dataset.side = 'right';
    sheet.textContent = 'Sheet material probe';
    sheet.style.cssText = [
      'position: fixed',
      'top: 0',
      'right: 0',
      'bottom: 0',
      'z-index: 61',
      'width: min(320px, calc(100vw - 24px))',
      'box-sizing: border-box',
      'padding: 16px',
      'pointer-events: none',
    ].join(';');

    probes.append(dialog, sheet);
    document.body.append(probes);
  });
}

async function expectWithinViewport(locator: Locator, label: string) {
  const bounds = await locator.evaluate((node) => {
    const rect = node.getBoundingClientRect();
    return {
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      left: rect.left,
    };
  });

  expect(
    bounds.top,
    `${label} should stay below the visual top edge`,
  ).toBeGreaterThanOrEqual(-1);
  expect(
    bounds.left,
    `${label} should stay inside the left edge`,
  ).toBeGreaterThanOrEqual(-1);
  expect(
    bounds.right,
    `${label} should stay inside the right edge`,
  ).toBeLessThanOrEqual(bounds.viewportWidth + 1);
  expect(
    bounds.bottom,
    `${label} should stay above the visual bottom edge`,
  ).toBeLessThanOrEqual(bounds.viewportHeight + 1);
}

for (const viewport of responsiveViewports) {
  test(`home fits without horizontal overflow at ${viewport.width}px`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await openHome(page);
    await expectNoHorizontalOverflow(page);
  });
}

test('activates the light and dark Liquid Glass themes', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await openHome(page);

  const documentRoot = page.locator('html');
  await expect(documentRoot).not.toHaveClass(/\bdark\b/);

  await page
    .getByRole('button', {
      name: 'Chuyển sang giao diện tối',
      exact: true,
    })
    .click();
  await expect(documentRoot).toHaveClass(/\bdark\b/);
  await expect(
    page.getByRole('button', {
      name: 'Chuyển sang giao diện sáng',
      exact: true,
    }),
  ).toHaveAttribute('aria-pressed', 'true');

  await page
    .getByRole('button', {
      name: 'Chuyển sang giao diện sáng',
      exact: true,
    })
    .click();
  await expect(documentRoot).not.toHaveClass(/\bdark\b/);
});

test('keeps navigation glass light and makes reading surfaces solid in both themes', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openHome(page);

  const glassSurfaces = [
    { label: 'header', locator: page.locator('.glass-header') },
    {
      label: 'bottom navigation',
      locator: page.locator('.glass-bottom-nav'),
    },
  ];
  const solidSurfaces = [
    { label: 'content panel', locator: page.locator('.glass-panel').first() },
    { label: 'metric card', locator: page.locator('.metric-card').first() },
  ];

  for (const surface of glassSurfaces) {
    await expectTranslucentMaterial(surface.locator, surface.label);
  }
  for (const surface of solidSurfaces) {
    await expectOpaqueMaterial(surface.locator, surface.label);
  }

  await page
    .getByRole('button', {
      name: 'Chuyển sang giao diện tối',
      exact: true,
    })
    .click();
  await expect(page.locator('html')).toHaveClass(/\bdark\b/);

  for (const surface of glassSurfaces) {
    await expectTranslucentMaterial(
      surface.locator,
      `${surface.label} in dark mode`,
    );
  }
  for (const surface of solidSurfaces) {
    await expectOpaqueMaterial(
      surface.locator,
      `${surface.label} in dark mode`,
    );
  }
});

test('keeps injected dialog and right sheet materials within mobile safe bounds', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openHome(page);
  await installFloatingSurfaceProbes(page);

  const dialog = page.locator('[data-liquid-glass-probe="dialog"]');
  const sheet = page.locator('[data-liquid-glass-probe="sheet"]');
  await expectTranslucentMaterial(dialog, 'dialog');
  await expectTranslucentMaterial(sheet, 'right sheet');
  await expectWithinViewport(dialog, 'dialog');
  await expectWithinViewport(sheet, 'right sheet');

  await page.setViewportSize({ width: 844, height: 390 });
  await expectWithinViewport(dialog, 'dialog in landscape');
  await expectWithinViewport(sheet, 'right sheet in landscape');
});

test('keeps the mobile header and bottom navigation within the safe layout', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openHome(page);

  const bottomNav = page.locator('.glass-bottom-nav');
  await expect(bottomNav).toBeInViewport();
  await expect(
    bottomNav.getByRole('link', { name: 'Công cụ', exact: true }),
  ).toBeVisible();

  await page.evaluate(() =>
    window.scrollTo(0, document.documentElement.scrollHeight),
  );
  await expect(bottomNav).toBeInViewport();

  const layout = await page.evaluate(() => {
    const headerRect = document
      .querySelector('.glass-header')
      ?.getBoundingClientRect();
    const navRect = document
      .querySelector('.glass-bottom-nav')
      ?.getBoundingClientRect();

    if (!headerRect || !navRect) throw new Error('Missing Liquid Glass layout');

    return {
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      header: {
        top: headerRect.top,
        left: headerRect.left,
        right: headerRect.right,
      },
      bottomNav: {
        top: navRect.top,
        left: navRect.left,
        right: navRect.right,
        bottom: navRect.bottom,
      },
    };
  });

  expect(layout.header.top).toBeGreaterThanOrEqual(-1);
  expect(layout.header.left).toBeGreaterThanOrEqual(-1);
  expect(layout.header.right).toBeLessThanOrEqual(layout.viewportWidth + 1);
  expect(layout.bottomNav.top).toBeGreaterThanOrEqual(-1);
  expect(layout.bottomNav.left).toBeGreaterThanOrEqual(-1);
  expect(layout.bottomNav.right).toBeLessThanOrEqual(
    layout.viewportWidth + 1,
  );
  expect(layout.bottomNav.bottom).toBeLessThanOrEqual(
    layout.viewportHeight + 1,
  );

  await bottomNav
    .getByRole('link', { name: 'Công cụ', exact: true })
    .click();
  await expect(page).toHaveURL(/\/cong-cu-vang(?:[?#]|$)/);

  await page.setViewportSize({ width: 844, height: 390 });
  await openHome(page);
  await expectNoHorizontalOverflow(page);
});

test('switches to English without losing the current layout or preference', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openHome(page);

  await page.getByRole('button', { name: 'Ngôn ngữ (VI)', exact: true }).click();
  const initialSave = page.waitForResponse((response) =>
    response.url().includes('/api/locale') && response.request().method() === 'POST',
  );
  await page
    .getByRole('menuitemradio', { name: 'EN English', exact: true })
    .click();
  await initialSave;

  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page).toHaveTitle('Vietnam gold prices — Kim Tuyến');
  await expect(page.getByRole('link', { name: 'Tools', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Gold Pulse', exact: true })).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.getByRole('link', { name: 'Prices', exact: true })).toBeVisible();

  await page.goto('/cong-cu-vang?tool=lai-lo', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Gold profit, loss, and break-even', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Resale venue', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Buyback price scenarios', exact: true })).toBeHidden();
  await page.goto('/cong-cu-vang', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('main').getByRole('heading', { name: 'Gold tools', exact: true })).toBeVisible();
  await expect(page.getByText('Select up to 3 products', { exact: false })).toBeVisible();
  const quantity = page.locator('#compare-quantity');
  await quantity.fill('2');
  await expect(quantity).toHaveValue('2');
  await page.getByRole('button', { name: 'Language (EN)', exact: true }).click();
  const saveToolsVietnamese = page.waitForResponse((response) =>
    response.url().includes('/api/locale') && response.request().method() === 'POST',
  );
  await page.getByRole('menuitemradio', { name: 'VI Tiếng Việt', exact: true }).click();
  await saveToolsVietnamese;
  await expect(page.getByRole('button', { name: 'Ngôn ngữ (VI)', exact: true })).toBeEnabled();
  await expect(page.locator('#compare-quantity')).toHaveValue('2');
  await expect(page).toHaveTitle('So sánh giá vàng, tính lãi lỗ và hòa vốn — Kim Tuyến');
  await expect(page.locator('main').getByRole('heading', { name: 'Công cụ vàng', exact: true })).toBeVisible();

  await page.goto('/phan-tich', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.ai-workspace')).toHaveAttribute('data-hydrated', 'true');
  const analysisQuantity = page.getByRole('textbox', { name: 'Số lượng (lượng)' });
  await analysisQuantity.fill('1,5');
  await expect(analysisQuantity).toHaveValue('1,5');
  await page.getByRole('button', { name: 'Ngôn ngữ (VI)', exact: true }).click();
  const saveEnglish = page.waitForResponse((response) =>
    response.url().includes('/api/locale') && response.request().method() === 'POST',
  );
  await page.getByRole('menuitemradio', { name: 'EN English', exact: true }).click();
  await saveEnglish;
  await expect(page.getByRole('textbox', { name: 'Quantity (lượng)' })).toHaveValue('1,5');
  await expect(page.getByRole('status').filter({ hasText: 'Each value keeps the number format used when entered.' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Analysis question' })).toHaveValue('How much profit or loss would I have if I sold my gold today?');
  let submittedAnalysis: { locale?: string; scenarioInputs?: { quantityLuong?: number } } | undefined;
  await page.route('**/api/analysis/prepare', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.continue();
      return;
    }
    submittedAnalysis = route.request().postDataJSON() as typeof submittedAnalysis;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ready: false,
        authenticated: false,
        access: { authenticated: false, code: 'AUTH_REQUIRED' },
      }),
    });
  });
  await page.getByRole('button', { name: 'Analyze', exact: true }).click();
  await expect.poll(() => submittedAnalysis?.scenarioInputs?.quantityLuong).toBe(1.5);
  expect(submittedAnalysis?.locale).toBe('en');
  await expect(page.locator('main').getByRole('alert')).toContainText('Sign in below to send your question.');

  await page.goto('/huong-dan', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'How to use Kim Tuyến', exact: true })).toBeVisible();
  await page.goto('/privacy', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Privacy policy', exact: true })).toBeVisible();
  await page.route('**/api/donations/summary', (route) =>
    route.fulfill({
      json: {
        enabled: true,
        summary: {
          month: '2026-09',
          donationCount: 0,
          amountVnd: 0,
          operatingCostVnd: null,
          updatedAt: '2026-09-25T00:00:00.000Z',
        },
      },
    }),
  );
  await page.route('**/api/donations/leaderboard*', (route) =>
    route.fulfill({ json: { enabled: true, period: 'month', rows: [] } }),
  );
  await page.goto('/donate', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Keep a transparent view of gold', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Community supporters', exact: true })).toBeVisible();
  await expect(page.locator('[data-donation-hydrated="true"]')).toBeVisible();
  await page.locator('#donation-amount').fill('12345');
  await expect(page.locator('#donation-amount')).toHaveValue('12345');
  await page.getByRole('button', { name: 'Language (EN)', exact: true }).click();
  const saveDonationVietnamese = page.waitForResponse((response) =>
    response.url().includes('/api/locale') && response.request().method() === 'POST',
  );
  await page.getByRole('menuitemradio', { name: 'VI Tiếng Việt', exact: true }).click();
  await saveDonationVietnamese;
  await expect(page.locator('#donation-amount')).toHaveValue('12345');
  await expect(page.locator('main').getByRole('heading', { name: 'Cùng giữ góc nhìn vàng minh bạch', exact: true })).toBeVisible();
});

test('honors reduced-motion preferences', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 390, height: 844 });
  await openHome(page);

  await expect
    .poll(() =>
      page.evaluate(
        () => matchMedia('(prefers-reduced-motion: reduce)').matches,
      ),
    )
    .toBe(true);
  await expect(page.locator('html')).toHaveCSS('scroll-behavior', 'auto');

  const duration = await page
    .locator('.glass-bottom-nav__indicator')
    .evaluate((node) => getComputedStyle(node).transitionDuration);
  const longestDurationMs = Math.max(
    ...duration.split(',').map((value) => {
      const trimmed = value.trim();
      return trimmed.endsWith('ms')
        ? Number.parseFloat(trimmed)
        : Number.parseFloat(trimmed) * 1_000;
    }),
  );
  expect(longestDurationMs).toBeLessThanOrEqual(1);
});

test('uses opaque fallbacks when Chromium emulates reduced transparency', async ({
  page,
  browserName,
}) => {
  test.skip(
    browserName !== 'chromium',
    'Only Chromium exposes reduced-transparency emulation through CDP.',
  );

  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-transparency', value: 'reduce' }],
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await openHome(page);
  await installFloatingSurfaceProbes(page);

  await expect
    .poll(() =>
      page.evaluate(
        () => matchMedia('(prefers-reduced-transparency: reduce)').matches,
      ),
    )
    .toBe(true);

  const surfaces = [
    { label: 'header', locator: page.locator('.glass-header') },
    {
      label: 'bottom navigation',
      locator: page.locator('.glass-bottom-nav'),
    },
    { label: 'content panel', locator: page.locator('.glass-panel').first() },
    { label: 'metric card', locator: page.locator('.metric-card').first() },
    {
      label: 'dialog',
      locator: page.locator('[data-liquid-glass-probe="dialog"]'),
    },
    {
      label: 'right sheet',
      locator: page.locator('[data-liquid-glass-probe="sheet"]'),
    },
  ];

  for (const surface of surfaces) {
    await expect(
      surface.locator,
      `${surface.label} should be visible`,
    ).toBeVisible();
    const snapshot = await readMaterial(surface.locator);
    expect(
      backdropFilterIsEnabled(snapshot),
      `${surface.label} should disable blur for reduced transparency`,
    ).toBe(false);
    expect(
      alphaFromComputedColor(snapshot.backgroundColor),
      `${surface.label} should use a solid fallback background`,
    ).toBe(1);
  }
});
