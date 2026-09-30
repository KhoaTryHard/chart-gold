import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { ensureBillingUser } from '@/lib/billing/server';

type UserRow = {
  id: string;
  googleSubject: string;
  email: string;
  name: string | null;
  image: string | null;
  role: 'user' | 'admin';
  createdAt: Date;
  updatedAt: Date;
  lastLoginAt: Date;
};

function fakeDb({
  selects,
  updates,
  insertResult,
  insertError,
}: {
  selects: UserRow[][];
  updates: UserRow[][];
  insertResult?: UserRow[];
  insertError?: unknown;
}) {
  const updatePayloads: Record<string, unknown>[] = [];
  const db = {
    select() {
      const rows = selects.shift() ?? [];
      return {
        from() {
          return {
            where() {
              return { limit: async () => rows };
            },
          };
        },
      };
    },
    update() {
      return {
        set(payload: Record<string, unknown>) {
          updatePayloads.push(payload);
          return {
            where() {
              return { returning: async () => updates.shift() ?? [] };
            },
          };
        },
      };
    },
    insert() {
      return {
        values() {
          return {
            returning: async () => {
              if (insertError) throw insertError;
              return insertResult ?? [];
            },
          };
        },
      };
    },
  };
  return { db, updatePayloads };
}

const legacySubject = '550e8400-e29b-41d4-a716-446655440000';
const userId = '550e8400-e29b-41d4-a716-446655440001';
const now = new Date('2026-09-25T06:00:00.000Z');
const legacyUser: UserRow = {
  id: userId,
  googleSubject: legacySubject,
  email: 'member@example.test',
  name: 'Old Name',
  image: null,
  role: 'user',
  createdAt: now,
  updatedAt: now,
  lastLoginAt: now,
};

afterEach(() => vi.unstubAllEnvs());

describe('billing identity reconciliation', () => {
  it('upgrades an old Auth.js UUID row without changing its user id', async () => {
    const upgraded = { ...legacyUser, googleSubject: 'google-stable-123' };
    const { db, updatePayloads } = fakeDb({
      selects: [[], [legacyUser]],
      updates: [[upgraded]],
    });

    const result = await ensureBillingUser(
      {
        googleSubject: 'google-stable-123',
        email: legacyUser.email,
        name: 'Member',
      },
      db as never,
      now,
    );

    expect(result).toMatchObject({ id: userId, googleSubject: 'google-stable-123' });
    expect(updatePayloads[0]).toMatchObject({ googleSubject: 'google-stable-123' });
  });

  it('uses an existing stable subject on a legacy session and preserves history', async () => {
    const stableUser = { ...legacyUser, googleSubject: 'google-stable-123' };
    const { db, updatePayloads } = fakeDb({
      selects: [[], [stableUser]],
      updates: [[stableUser]],
    });

    const result = await ensureBillingUser(
      { email: stableUser.email, name: stableUser.name },
      db as never,
      now,
    );

    expect(result.id).toBe(userId);
    expect(updatePayloads[0]).toMatchObject({ googleSubject: 'google-stable-123' });
  });

  it('re-reads the winner when two devices race on first login', async () => {
    const winner = { ...legacyUser, googleSubject: 'google-stable-123' };
    const { db, updatePayloads } = fakeDb({
      selects: [[], [], [winner]],
      updates: [[winner]],
      insertError: { code: '23505' },
    });

    const result = await ensureBillingUser(
      {
        googleSubject: 'google-stable-123',
        email: winner.email,
      },
      db as never,
      now,
    );

    expect(result.id).toBe(userId);
    expect(updatePayloads).toHaveLength(1);
  });

  it('rejects a stable subject already owned by another email', async () => {
    const owner = { ...legacyUser, email: 'other@example.test', googleSubject: 'google-stable-123' };
    const { db } = fakeDb({ selects: [[owner], []], updates: [] });

    await expect(
      ensureBillingUser(
        { googleSubject: 'google-stable-123', email: 'member@example.test' },
        db as never,
        now,
      ),
    ).rejects.toMatchObject({
      code: 'AI_IDENTITY_CONFLICT',
      status: 409,
    });
  });
});
