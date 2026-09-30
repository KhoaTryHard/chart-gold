'use client';

import { useRef, useState } from 'react';
import { signIn } from 'next-auth/react';
import { Button } from '@/components/ui/button';

export function AdminEditorialLogin({ email }: { email?: string | null }) {
  const [signingIn, setSigningIn] = useState(false);
  const [error, setError] = useState('');
  const signInInFlight = useRef(false);

  async function handleSignIn() {
    if (signInInFlight.current) return;
    signInInFlight.current = true;
    setSigningIn(true);
    setError('');

    try {
      await signIn(
        'google',
        { redirectTo: '/admin/bai-viet' },
        email ? { prompt: 'select_account' } : undefined,
      );
    } catch {
      signInInFlight.current = false;
      setSigningIn(false);
      setError('Không thể bắt đầu đăng nhập Google. Vui lòng thử lại.');
    }
  }

  return (
    <section className="glass-panel flex flex-col items-start gap-4 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
      <div className="min-w-0 space-y-1 text-sm">
        {email ? (
          <>
            <p className="font-medium text-foreground">
              Tài khoản này chưa có quyền quản trị bài viết.
            </p>
            <p className="break-all text-muted-foreground">{email}</p>
          </>
        ) : (
          <p className="text-muted-foreground">
            Vui lòng đăng nhập bằng tài khoản quản trị để mở khu vực này.
          </p>
        )}
        {error ? (
          <p className="text-destructive" role="alert">
            {error}
          </p>
        ) : null}
      </div>
      <Button
        type="button"
        variant="outline"
        className="w-full shrink-0 gap-3 bg-card sm:w-auto"
        onClick={() => void handleSignIn()}
        disabled={signingIn}
        aria-busy={signingIn}
      >
        {signingIn ? (
          'Đang chuyển tới Google…'
        ) : (
          <>
            <GoogleIcon />
            {email ? 'Đổi tài khoản Google' : 'Đăng nhập bằng Google'}
          </>
        )}
      </Button>
    </section>
  );
}

function GoogleIcon() {
  return (
    <svg
      aria-hidden="true"
      className="size-4"
      viewBox="0 0 24 24"
      focusable="false"
    >
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.75 3.28-8.09Z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06a6.27 6.27 0 0 1-5.89-4.34H2.42v2.84A11 11 0 0 0 12 23Z"
      />
      <path
        fill="#FBBC05"
        d="M6.11 14.29a6.6 6.6 0 0 1 0-4.58V6.87H2.42a11 11 0 0 0 0 10.26l3.69-2.84Z"
      />
      <path
        fill="#EA4335"
        d="M12 4.36c1.62 0 3.06.56 4.21 1.64l3.15-3.15A10.54 10.54 0 0 0 12 1a11 11 0 0 0-9.58 5.87l3.69 2.84A6.27 6.27 0 0 1 12 4.36Z"
      />
    </svg>
  );
}
