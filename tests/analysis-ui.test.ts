// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { AnswerMarkdown } from '@/components/analysis/answer-markdown';
import { SearchSuggestions } from '@/components/analysis/search-suggestions';
import { InvestorProfileForm } from '@/components/analysis/investor-profile-form';
import { LedgerBackup } from '@/components/portfolio/ledger-backup';
import {
  readInvestorProfile,
  saveInvestorProfile,
  profileKey,
} from '@/lib/analysis/investor-profile';
import {
  loadChatSnapshot,
  saveChatSnapshot,
  type StoredChatMessage,
} from '@/lib/ai-chat-storage';
import { AccountMenu } from '@/components/analysis/account-menu';

const localeState = vi.hoisted(() => ({ current: 'vi' as 'vi' | 'en' }));
vi.mock('@/components/locale-provider', () => ({
  useLocale: () => ({ locale: localeState.current }),
}));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root | undefined;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  localeState.current = 'vi';
  document.body.innerHTML = '';
  localStorage.clear();
});
describe('chat rendering and local profile', () => {
  it('uses a compact account menu for a signed-in user and keeps login copy out of analysis controls', () => {
    const html = renderToStaticMarkup(
      createElement(AccountMenu, {
        status: 'authenticated',
        sessionAccount: {
          email: 'khoadangntpcl@gmail.com',
          name: 'Khoa Dang',
          image: null,
        },
        access: {
          account: { email: 'khoadangntpcl@gmail.com', name: 'Khoa Dang' },
          authenticated: true,
          isAdmin: false,
          canAnalyze: true,
          code: null,
          message: 'Còn 2 lượt AI trong kỳ này.',
          capabilities: ['standard'],
          remaining: 2,
          unlimited: false,
          salesEnabled: false,
        },
        onLogin: vi.fn(),
        onRefresh: vi.fn(),
        onSignOut: vi.fn(),
      }),
    );
    expect(html).toContain('Còn 2 lượt');
    expect(html).toContain('Mở menu tài khoản');
    expect(html).toContain('khoadangntpcl@gmail.com');
    expect(html).not.toContain('Đăng nhập khi gửi');
  });

  it('shows only the login action for a guest account', () => {
    const html = renderToStaticMarkup(
      createElement(AccountMenu, {
        status: 'unauthenticated',
        access: null,
        onLogin: vi.fn(),
        onRefresh: vi.fn(),
        onSignOut: vi.fn(),
      }),
    );
    expect(html).toContain('Đăng nhập Google');
    expect(html).not.toContain('Còn lượt');
  });

  it('shows the monthly community allowance for an ordinary signed-in user', () => {
    const html = renderToStaticMarkup(
      createElement(AccountMenu, {
        status: 'authenticated',
        sessionAccount: { email: 'member@example.test', name: 'Member' },
        access: {
          account: { email: 'member@example.test', name: 'Member' },
          authenticated: true,
          isAdmin: false,
          canAnalyze: true,
          code: null,
          message: 'Còn 2/3 lượt AI cộng đồng trong tháng này.',
          capabilities: ['standard', 'portfolio', 'research', 'deep'],
          remaining: 4,
          unlimited: false,
          salesEnabled: false,
          community: {
            limit: 3,
            used: 1,
            remaining: 2,
            resetAt: '2026-09-30T17:00:00.000Z',
            capabilities: ['standard', 'portfolio', 'research', 'deep'],
          },
          subscription: null,
          accessSource: 'community',
        },
        onLogin: vi.fn(),
        onRefresh: vi.fn(),
        onSignOut: vi.fn(),
      }),
    );
    expect(html).toContain('Còn 2/3 lượt trong tháng này');
  });

  it('renders Markdown tables and citations and never executes raw HTML or unsafe links', () => {
    const html = renderToStaticMarkup(
      createElement(AnswerMarkdown, {
        content:
          '**Kết luận**\n\n| Loại | Giá |\n|---|---:|\n|SJC|140|\n\n<script>alert(1)</script>\n\n[x](javascript:alert(1))\n\n[Nguồn](https://example.com)',
      }),
    );
    expect(html).toContain('<strong>Kết luận</strong>');
    expect(html).toContain('<table');
    expect(html).toContain('overflow-x-auto');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('href="javascript:');
    expect(html).toContain('noopener noreferrer');
  });
  it('isolates sanitized Google suggestions in shadow DOM', async () => {
    const node = document.createElement('div');
    document.body.append(node);
    root = createRoot(node);
    await act(async () =>
      root!.render(
        createElement(SearchSuggestions, {
          html: '<div><script>alert(1)</script><a href="https://google.com/search?q=gold" onclick="alert(1)">Vàng</a></div>',
        }),
      ),
    );
    const shadow = node.firstElementChild!.shadowRoot!;
    expect(shadow.innerHTML).not.toContain('<script');
    expect(shadow.innerHTML).not.toContain('onclick');
    expect(shadow.querySelector('a')?.rel).toBe('noopener noreferrer');
  });
  it('stores profiles by normalized account and rejects malformed profile data', () => {
    saveInvestorProfile('A@EXAMPLE.COM', { capitalVnd: 5e8, holdings: [] });
    expect(readInvestorProfile('a@example.com')?.capitalVnd).toBe(5e8);
    expect(readInvestorProfile('b@example.com')).toBeUndefined();
    localStorage.setItem(profileKey('b@example.com'), '{broken');
    expect(readInvestorProfile('b@example.com')).toBeUndefined();
  });
  it('edits a draft only until explicitly saved and can delete the saved profile', async () => {
    const account = 'a@example.com';
    saveInvestorProfile(account, { capitalVnd: 5e8, holdings: [] });
    const node = document.createElement('div');
    document.body.append(node);
    root = createRoot(node);
    let current = readInvestorProfile(account);
    await act(async () =>
      root!.render(
        createElement(InvestorProfileForm, {
          account,
          disabled: false,
          onChange: (profile) => {
            current = profile;
          },
        }),
      ),
    );
    expect(node.querySelector('input')?.value).toBe('500000000');
    const remove = [...node.querySelectorAll('button')].find(
      (button) => button.textContent === 'Xóa hồ sơ',
    )!;
    await act(async () => remove.click());
    expect(current).toBeUndefined();
    expect(readInvestorProfile(account)).toBeUndefined();
  });
  it('localizes the profile form and its accessible position controls in English', async () => {
    localeState.current = 'en';
    const node = document.createElement('div');
    document.body.append(node);
    root = createRoot(node);
    await act(async () =>
      root!.render(
        createElement(InvestorProfileForm, {
          account: 'english@example.com',
          disabled: false,
          onChange: vi.fn(),
        }),
      ),
    );

    expect(node.textContent).toContain('Investment profile · optional');
    expect(node.textContent).toContain('Planned capital (VND)');
    expect(node.textContent).toContain('Holding period');
    expect(node.textContent).toContain('1–4 weeks');

    const addPosition = [...node.querySelectorAll('button')].find(
      (button) => button.textContent === 'Add position',
    )!;
    await act(async () => addPosition.click());
    expect(node.textContent).toContain('Brand');
    expect(node.textContent).toContain('Product');
    expect(node.textContent).toContain('Quantity (37.5 g units)');
    expect(
      node.querySelector('[aria-label="Remove position 1"]'),
    ).not.toBeNull();

    const save = [...node.querySelectorAll('button')].find(
      (button) => button.textContent === 'Save profile',
    )!;
    // Remove the position first so the form's required numeric inputs do not
    // block a save with empty values.
    const removePosition = node.querySelector<HTMLButtonElement>(
      '[aria-label="Remove position 1"]',
    )!;
    await act(async () => removePosition.click());
    await act(async () => save.click());
    expect(node.querySelector('[role="alert"]')?.textContent).toBe(
      'Profile saved and applied.',
    );
  });
  it('renders on-device backup controls for a saved ledger', async () => {
    const account = 'ledger@example.com';
    const node = document.createElement('div');
    document.body.append(node);
    root = createRoot(node);
    await act(async () =>
      root!.render(
        createElement(LedgerBackup, {
          account,
          ledger: {
            version: 1,
            transactions: [
              {
                id: 'buy-1',
                date: '2026-09-01',
                side: 'buy',
                companyId: 'sjc',
                productId: 'bar-1l',
                quantityLuong: 1,
                unitPriceVnd: 145_000_000,
                feesVnd: 0,
                note: '',
              },
            ],
          },
          onChange: vi.fn(),
        }),
      ),
    );
    expect(node.textContent).toContain('Sao lưu và khôi phục');
    expect(node.textContent).toContain('Tải bản sao sổ');
    expect(node.textContent).toContain('Khôi phục bản sao lưu');
    expect(node.textContent).not.toContain('Tải mẫu');
  });
  it('renders backup controls in English when the locale is selected', async () => {
    const node = document.createElement('div');
    document.body.append(node);
    root = createRoot(node);
    await act(async () =>
      root!.render(
        createElement(LedgerBackup, {
          account: 'english-ledger@example.com',
          ledger: { version: 1, transactions: [] },
          locale: 'en',
          onChange: vi.fn(),
        }),
      ),
    );
    expect(node.textContent).toContain('Backup and restore');
    expect(node.textContent).toContain('Restore a backup copy');
  });
  it('does not persist search suggestions and separates histories across accounts', () => {
    const message: StoredChatMessage = {
      id: '1',
      role: 'assistant',
      content: 'Thông tin',
      sources: [],
      createdAt: new Date().toISOString(),
      productId: 'bar-1l',
      range: '7N',
      model: 'gemini',
      suggestions: '<div>Search</div>',
      grounded: true,
    };
    saveChatSnapshot([message], 'a@example.com');
    expect(
      loadChatSnapshot('a@example.com')?.messages[0].suggestions,
    ).toBeUndefined();
    expect(loadChatSnapshot('b@example.com')).toBeNull();
    expect(loadChatSnapshot('a@example.com')?.messages[0].grounded).toBe(true);
  });
});
