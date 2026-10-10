import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from '@playwright/test';

const baseURL = (process.env.DONATE_SMOKE_URL || 'https://www.vanghomnay.online').replace(/\/$/, '');
const runId = `${new Date().toISOString().replace(/[:.]/g, '-')}-${Math.random().toString(36).slice(2, 8)}`;
const evidenceDir = join(process.cwd(), 'test-results', 'donate-production-smoke', runId);
const requestTimeoutMs = 15_000;
const evidence = {
  startedAt: new Date().toISOString(),
  baseURL,
  checks: [],
  screenshots: [],
};

function check(name, passed, details = {}) {
  evidence.checks.push({ name, passed: Boolean(passed), ...details });
  if (!passed) throw new Error(`Smoke check failed: ${name}`);
}

function safeError(error) {
  return error instanceof Error ? error.message : String(error);
}

async function readJson(path) {
  const response = await fetch(`${baseURL}${path}`, {
    headers: { accept: 'application/json' },
    redirect: 'manual',
    signal: AbortSignal.timeout(requestTimeoutMs),
  });
  let body = null;
  try {
    body = await response.json();
  } catch {
    // The status check below provides the useful failure signal.
  }
  return { response, body };
}

async function run() {
  await mkdir(evidenceDir, { recursive: true });

  const donateResponse = await fetch(`${baseURL}/donate`, {
    redirect: 'manual',
    signal: AbortSignal.timeout(requestTimeoutMs),
  });
  check('donate page returns 200', donateResponse.status === 200, {
    status: donateResponse.status,
  });
  const headers = Object.fromEntries(
    ['strict-transport-security', 'x-frame-options', 'x-content-type-options', 'referrer-policy', 'content-security-policy-report-only'].map(
      (name) => [name, donateResponse.headers.get(name) ? 'present' : 'missing'],
    ),
  );
  for (const [name, value] of Object.entries(headers))
    check(`security header ${name}`, value === 'present', { value });

  const summary = await readJson('/api/donations/summary');
  check('summary endpoint returns 200', summary.response.status === 200, {
    status: summary.response.status,
    enabled: summary.body?.enabled ?? null,
    donationCount: summary.body?.summary?.donationCount ?? null,
    amountVnd: summary.body?.summary?.amountVnd ?? null,
  });
  check('summary endpoint does not expose secrets', !JSON.stringify(summary.body).match(/secret|token|rawBody|api[_-]?key/i));

  for (const period of ['month', 'all']) {
    const snapshot = await readJson(`/api/donations/public?period=${period}`);
    check(`public snapshot ${period} returns 200`, snapshot.response.status === 200, {
      status: snapshot.response.status,
      rowCount: Array.isArray(snapshot.body?.rows) ? snapshot.body.rows.length : null,
    });
    check(`public snapshot ${period} has the requested shape`, snapshot.body?.period === period &&
      typeof snapshot.body?.enabled === 'boolean' && Array.isArray(snapshot.body?.rows) && 'summary' in snapshot.body);
    check(`public snapshot ${period} is not cached`, snapshot.response.headers.get('cache-control')?.includes('no-store'));
    check(`public snapshot ${period} does not expose private fields`,
      !JSON.stringify(snapshot.body).match(/"(?:accessToken|accountNumber|userId|orderCode|email|token|secret|rawBody)"\s*:/i));
    const leaderboard = await readJson(`/api/donations/leaderboard?period=${period}`);
    check(`leaderboard ${period} returns 200`, leaderboard.response.status === 200, {
      status: leaderboard.response.status,
      rowCount: Array.isArray(leaderboard.body?.rows) ? leaderboard.body.rows.length : null,
      cacheControl: leaderboard.response.headers.get('cache-control'),
    });
    check(`leaderboard ${period} is not cached`, leaderboard.response.headers.get('cache-control')?.includes('no-store'), {
      cacheControl: leaderboard.response.headers.get('cache-control'),
    });
  }

  const webhook = await readJson('/api/webhooks/sepay');
  check('webhook health returns 200', webhook.response.status === 200, {
    status: webhook.response.status,
    configured: webhook.body?.configured ?? null,
    method: webhook.body?.method ?? null,
  });
  check('webhook health is configured', webhook.body?.configured === true);
  check('webhook health advertises POST', webhook.body?.method === 'POST');

  const browser = await chromium.launch({ headless: true });
  try {
    for (const viewport of [
      { name: 'desktop', width: 1280, height: 900 },
      { name: 'mobile', width: 390, height: 844 },
    ]) {
      const context = await browser.newContext({ viewport, locale: 'vi-VN' });
      const page = await context.newPage();
      const consoleErrors = [];
      const pageErrors = [];
      const publicRequests = [];
      const legacyPublicRequests = [];
      page.on('request', (request) => {
        const pathname = new URL(request.url()).pathname;
        if (pathname === '/api/donations/public') publicRequests.push(Date.now());
        if (pathname === '/api/donations/summary' || pathname === '/api/donations/leaderboard')
          legacyPublicRequests.push(pathname);
      });
      page.on('console', (message) => {
        if (message.type() === 'error') consoleErrors.push(message.text());
      });
      page.on('pageerror', (error) => pageErrors.push(error.message));
      const firstPublicResponse = page.waitForResponse(
        (response) => new URL(response.url()).pathname === '/api/donations/public',
        { timeout: requestTimeoutMs },
      );
      await page.goto(`${baseURL}/donate`, {
        waitUntil: 'domcontentloaded',
        timeout: requestTimeoutMs,
      });
      await page.locator('[data-donation-hydrated="true"]').waitFor({
        state: 'visible',
        timeout: requestTimeoutMs,
      });
      check(`${viewport.name} loads the public snapshot`, (await firstPublicResponse).status() === 200);
      const pageHeading = page.locator('#tool-page-title');
      await pageHeading.waitFor({ state: 'visible', timeout: 5_000 });
      const initialTitle = await pageHeading.innerText();
      const isEnglish = initialTitle.includes('Keep a transparent view of gold');
      check(`${viewport.name} donate heading is visible`, /Cùng giữ góc nhìn vàng minh bạch|Keep a transparent view of gold/.test(initialTitle));
      check(`${viewport.name} donate panel is visible`, await page.getByRole('heading', { name: /Ủng hộ tự nguyện|Voluntary support/ }).isVisible());
      const copy = await page.locator('body').innerText();
      check(`${viewport.name} donation instructions are visible`, /Không mở khóa lượt hay tính năng|Does not unlock uses or features/.test(copy));
      check(`${viewport.name} SePay disclosure is visible`, /Khoản ủng hộ được đối soát qua SePay|Contributions are reconciled through SePay/.test(copy));
      const layout = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        viewportWidth: window.innerWidth,
      }));
      check(`${viewport.name} has no horizontal overflow`, layout.scrollWidth <= layout.viewportWidth + 1, layout);

      if (viewport.name === 'desktop') {
        await page.waitForResponse((response) => new URL(response.url()).pathname === '/api/donations/public', {
          timeout: 30_000,
        });
        check('desktop combines idle public polling into one request per 25 seconds',
          publicRequests.length === 2 && publicRequests[1] - publicRequests[0] >= 24_000 &&
          publicRequests[1] - publicRequests[0] <= 30_000, {
            requestCount: publicRequests.length,
            intervalMs: publicRequests[1] - publicRequests[0],
          });
      }
      check(`${viewport.name} uses the combined public endpoint`, publicRequests.length >= 1 && legacyPublicRequests.length === 0);

      const languageButton = page.getByRole('button', { name: /Ngôn ngữ|Language/ });
      if (await languageButton.count()) {
        await languageButton.click();
        const targetOption = page
          .locator('[role="menuitemradio"]')
          .filter({ hasText: isEnglish ? 'Tiếng Việt' : 'English' })
          .first();
        await targetOption.waitFor({ state: 'visible', timeout: 10_000 });
        check(`${viewport.name} exposes alternate locale`, (await targetOption.count()) > 0 && await targetOption.isVisible());
        await targetOption.click();
        const switchedTitle = isEnglish ? 'Cùng giữ góc nhìn vàng minh bạch' : 'Keep a transparent view of gold';
        await page.getByRole('heading', { name: switchedTitle }).waitFor({ state: 'visible' });
        check(`${viewport.name} switches locale`, await page.getByRole('heading', { name: switchedTitle }).isVisible());
      } else {
        check(`${viewport.name} serves Vietnamese while the language switch is disabled`,
          !isEnglish && await page.locator('html').getAttribute('lang') === 'vi');
      }

      const themeToggle = page.getByRole('button', {
        name: /(?:Switch to (?:dark|light) mode|Chuyển sang giao diện (?:tối|sáng))/,
      });
      if (await themeToggle.count()) {
        const beforeTheme = await page.evaluate(() => document.documentElement.classList.contains('dark'));
        await themeToggle.click();
        const afterTheme = await page.evaluate(() => document.documentElement.classList.contains('dark'));
        check(`${viewport.name} toggles dark mode`, afterTheme !== beforeTheme, { beforeTheme, afterTheme });
      } else {
        check(`${viewport.name} exposes dark mode toggle`, false);
      }

      const screenshotPath = join(evidenceDir, `${viewport.name}.png`);
      await page.screenshot({ path: screenshotPath, fullPage: true });
      evidence.screenshots.push(screenshotPath);
      check(`${viewport.name} has no console errors`, consoleErrors.length === 0, { count: consoleErrors.length });
      check(`${viewport.name} has no page errors`, pageErrors.length === 0, { count: pageErrors.length });
      await context.close();
    }
  } finally {
    await browser.close();
  }
}

try {
  await run();
  evidence.finishedAt = new Date().toISOString();
  evidence.passed = true;
} catch (error) {
  evidence.finishedAt = new Date().toISOString();
  evidence.passed = false;
  evidence.error = safeError(error);
  process.exitCode = 1;
} finally {
  await mkdir(evidenceDir, { recursive: true });
  await writeFile(join(evidenceDir, 'evidence.json'), `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({
    passed: evidence.passed,
    evidenceDir,
    failedChecks: evidence.checks.filter((item) => !item.passed).map((item) => item.name),
  }));
}
