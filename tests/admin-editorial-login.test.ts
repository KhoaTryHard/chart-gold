// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { AdminEditorialLogin } from '@/components/editorial/admin-editorial-login';

const { mockSignIn } = vi.hoisted(() => ({ mockSignIn: vi.fn() }));
vi.mock('next-auth/react', () => ({ signIn: mockSignIn }));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root | undefined;
let container: HTMLDivElement | undefined;

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  container?.remove();
  container = undefined;
  mockSignIn.mockReset();
});

async function renderLogin(email?: string) {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () =>
    root!.render(createElement(AdminEditorialLogin, { email })),
  );
  return container;
}

describe('editorial admin Google sign-in', () => {
  it('offers the Google sign-in action to guests and returns them to the editor', async () => {
    mockSignIn.mockResolvedValue(undefined);
    const node = await renderLogin();
    const button = node.querySelector('button')!;

    expect(button.textContent).toContain('Đăng nhập bằng Google');
    expect(button.className).toContain('w-full');

    await act(async () => button.click());

    expect(mockSignIn).toHaveBeenCalledWith(
      'google',
      { redirectTo: '/admin/bai-viet' },
      undefined,
    );
  });

  it('identifies an unauthorized account and asks Google to show the account chooser', async () => {
    mockSignIn.mockResolvedValue(undefined);
    const node = await renderLogin('member@example.test');

    expect(node.textContent).toContain(
      'Tài khoản này chưa có quyền quản trị bài viết.',
    );
    expect(node.textContent).toContain('member@example.test');

    await act(async () => node.querySelector('button')!.click());

    expect(mockSignIn).toHaveBeenCalledWith(
      'google',
      { redirectTo: '/admin/bai-viet' },
      { prompt: 'select_account' },
    );
  });

  it('locks repeated clicks while sign-in starts and restores the button if it fails', async () => {
    let rejectSignIn: (error: Error) => void = () => {};
    mockSignIn.mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          rejectSignIn = reject;
        }),
    );
    const node = await renderLogin();
    const button = node.querySelector('button')!;

    await act(async () => {
      button.click();
      button.click();
    });

    expect(mockSignIn).toHaveBeenCalledOnce();
    expect(button.disabled).toBe(true);
    expect(button.textContent).toContain('Đang chuyển tới Google…');

    await act(async () => rejectSignIn(new Error('network error')));

    expect(button.disabled).toBe(false);
    expect(button.textContent).toContain('Đăng nhập bằng Google');
    expect(node.querySelector('[role="alert"]')?.textContent).toContain(
      'Không thể bắt đầu đăng nhập Google. Vui lòng thử lại.',
    );
  });
});
