import 'server-only';

import { Client, Receiver } from '@upstash/qstash';
import { siteUrl } from '@/lib/seo';
import { getEditorialImageAvailability } from './images';
import { getEditorialProviderAvailability } from './provider';

export type EditorialWorkerMessage =
  | { kind: 'collect'; localDate?: string }
  | { kind: 'generate'; jobId: string }
  | { kind: 'translate'; jobId: string }
  | {
      kind: 'publish';
      localDate?: string;
      slot: 'morning' | 'noon' | 'evening';
    }
  | { kind: 'reconcile' }
  | { kind: 'image'; jobId: string; revisionId?: string };

const scheduleDefinitions: Array<{
  id: string;
  cron: string;
  body: EditorialWorkerMessage;
}> = [
  {
    id: 'kim-tuyen-editorial-collect-v1',
    cron: 'CRON_TZ=Asia/Ho_Chi_Minh 30 6 * * *',
    body: { kind: 'collect' },
  },
  {
    id: 'kim-tuyen-editorial-reconcile-v1',
    cron: 'CRON_TZ=Asia/Ho_Chi_Minh */10 * * * *',
    body: { kind: 'reconcile' },
  },
  {
    id: 'kim-tuyen-editorial-publish-morning-v1',
    cron: 'CRON_TZ=Asia/Ho_Chi_Minh 30 8 * * *',
    body: { kind: 'publish', slot: 'morning' },
  },
  {
    id: 'kim-tuyen-editorial-publish-noon-v1',
    cron: 'CRON_TZ=Asia/Ho_Chi_Minh 0 12 * * *',
    body: { kind: 'publish', slot: 'noon' },
  },
  {
    id: 'kim-tuyen-editorial-publish-evening-v1',
    cron: 'CRON_TZ=Asia/Ho_Chi_Minh 0 17 * * *',
    body: { kind: 'publish', slot: 'evening' },
  },
];

function configuredToken() {
  return process.env.QSTASH_TOKEN?.trim();
}

function configuredKeys() {
  return {
    current: process.env.QSTASH_CURRENT_SIGNING_KEY?.trim(),
    next: process.env.QSTASH_NEXT_SIGNING_KEY?.trim(),
  };
}

function workerUrl() {
  const configured = process.env.SITE_URL?.trim() || siteUrl;
  const url = new URL('/api/editorial/worker', configured);
  if (url.protocol !== 'https:') {
    throw new Error('Lịch QStash cần SITE_URL HTTPS công khai.');
  }
  return url.toString();
}

export function editorialAutomationStatus() {
  const keys = configuredKeys();
  const qstashConfigured = Boolean(
    configuredToken() && keys.current && keys.next,
  );
  const providerConfigured = Boolean(
    getEditorialProviderAvailability()[0]?.configured,
  );
  const imageConfigured = getEditorialImageAvailability().configured;
  return {
    configured: qstashConfigured && providerConfigured,
    qstashConfigured,
    providerConfigured,
    imageConfigured,
    enabled: process.env.EDITORIAL_AUTOMATION_ENABLED === 'true',
    queueProvider: 'qstash' as const,
  };
}

function client() {
  const token = configuredToken();
  if (!token) throw new Error('QSTASH_TOKEN chưa được cấu hình.');
  return new Client({ token });
}

export async function verifyEditorialWorkerRequest(request: Request) {
  const signature = request.headers.get('upstash-signature');
  const keys = configuredKeys();
  if (!signature || !keys.current || !keys.next) return false;
  const body = await request.clone().text();
  const receiver = new Receiver({
    currentSigningKey: keys.current,
    nextSigningKey: keys.next,
  });
  return receiver.verify({
    signature,
    body,
    url: request.url,
    upstashRegion: request.headers.get('upstash-region') ?? undefined,
  });
}

export async function enqueueEditorialWorker(message: EditorialWorkerMessage) {
  const queue = client();
  return queue.publishJSON({
    url: workerUrl(),
    body: message,
    retries: 3,
    timeout: 90,
    headers: { 'x-kim-tuyen-editorial': '1' },
  });
}

export async function ensureEditorialAutomationSchedules() {
  const queue = client();
  const destination = workerUrl();
  const schedules = await Promise.all(
    scheduleDefinitions.map((definition) =>
      queue.schedules.create({
        scheduleId: definition.id,
        destination,
        cron: definition.cron,
        body: JSON.stringify(definition.body),
        headers: {
          'Content-Type': 'application/json',
          'x-kim-tuyen-editorial': '1',
        },
        retries: 3,
        timeout: 90,
        label: ['kim-tuyen', 'editorial'],
      }),
    ),
  );
  return schedules.map((schedule, index) => ({
    id: scheduleDefinitions[index]!.id,
    scheduleId: schedule.scheduleId,
  }));
}

export async function pauseEditorialAutomationSchedules() {
  const queue = client();
  const existing = await queue.schedules.list();
  const ours = existing.filter((schedule) =>
    scheduleDefinitions.some(
      (definition) => definition.id === schedule.scheduleId,
    ),
  );
  await Promise.all(
    ours.map((schedule) =>
      queue.schedules.pause({ schedule: schedule.scheduleId }),
    ),
  );
  return ours.map((schedule) => schedule.scheduleId);
}
