'use client';

import {
  CircleAlert,
  RefreshCw,
  LogIn,
  LogOut,
  ShieldCheck,
} from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { AnalysisAccess } from '@/lib/analysis/access';

type AccountMenuProps = {
  context?: 'ai' | 'general';
  status: 'loading' | 'authenticated' | 'unauthenticated';
  sessionAccount?: {
    email?: string | null;
    name?: string | null;
    image?: string | null;
    isAdmin?: boolean;
  };
  access?: AnalysisAccess | null;
  accessError?: string;
  signingIn?: boolean;
  locale?: 'vi' | 'en';
  onLogin: () => void;
  onRefresh?: () => void;
  onSignOut?: () => void;
  busy?: boolean;
};

function initials(
  name: string | null | undefined,
  email: string | null | undefined,
) {
  const value = name?.trim() || email?.split('@')[0] || '?';
  return value
    .split(/[\s._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
}

function shortName(
  name: string | null | undefined,
  email: string | null | undefined,
) {
  const value = name?.trim();
  if (value) return value.split(/\s+/).slice(-2).join(' ');
  return email?.split('@')[0] ?? 'Tài khoản';
}

export function AccountMenu({
  context = 'ai',
  status,
  sessionAccount,
  access,
  accessError,
  signingIn = false,
  locale = 'vi',
  onLogin,
  onRefresh = () => undefined,
  onSignOut = () => undefined,
  busy = false,
}: AccountMenuProps) {
  const english = locale === 'en';
  if (status === 'loading')
    return (
      <div
        className="ai-account ai-account--loading"
        aria-label={english ? 'Checking account' : 'Đang kiểm tra tài khoản'}
      >
        <span className="ai-account__skeleton" />
        <span className="ai-account__skeleton ai-account__skeleton--wide" />
      </div>
    );

  const email = access?.account?.email ?? sessionAccount?.email ?? null;
  const name = access?.account?.name ?? sessionAccount?.name ?? null;
  const sameAccount =
    !access?.account ||
    !sessionAccount?.email ||
    access.account.email === sessionAccount.email.trim().toLowerCase();
  const accountImage = sameAccount ? sessionAccount?.image : null;
  const hasAccount = Boolean(email);
  if (!hasAccount)
    return (
      <button
        type="button"
        className="ai-account ai-account--guest"
        onClick={onLogin}
        disabled={signingIn || busy}
        aria-busy={signingIn}
      >
        <LogIn className="size-4" aria-hidden="true" />
        <span>
          {signingIn
            ? (english ? 'Opening Google…' : 'Đang chuyển tới Google…')
            : (english ? 'Sign in with Google' : 'Đăng nhập Google')}
        </span>
      </button>
    );

  const admin = access?.isAdmin === true || sessionAccount?.isAdmin === true;
  const community = access?.community;
  const quota = context === 'general'
    ? (english ? 'Signed in' : 'Đã đăng nhập')
    : accessError
    ? (english ? 'Unable to check access' : 'Không kiểm tra được quyền AI')
    : access?.unlimited
    ? (english ? 'Unlimited' : 'Không giới hạn')
    : community
      ? english
        ? `${community.remaining}/${community.limit} uses left this month`
        : `Còn ${community.remaining}/${community.limit} lượt trong tháng này`
      : access?.remaining === null || access?.remaining === undefined
        ? (english ? 'Checking access' : 'Đang kiểm tra quyền')
        : english ? `${access.remaining} uses left` : `Còn ${access.remaining} lượt`;
  const staleSession =
    status === 'authenticated' && access?.code === 'AUTH_REQUIRED';
  const syncError =
    accessError || (staleSession ? (english ? 'Server session has not synced.' : 'Phiên server chưa đồng bộ.') : '');
  const needsReauth =
    staleSession ||
    (Boolean(accessError) && (!access || access.authenticated === false));

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="ai-account ai-account--signed-in"
        disabled={busy}
        aria-label={english ? `Open account menu for ${email}` : `Mở menu tài khoản ${email}`}
      >
        <Avatar size="sm" className="ai-account__avatar">
          {accountImage ? <AvatarImage src={accountImage} alt="" /> : null}
          <AvatarFallback>{initials(name, email)}</AvatarFallback>
        </Avatar>
        <span className="ai-account__identity">
          <span className="ai-account__name">{shortName(name, email)}</span>
          <span className="ai-account__quota">
            {context === 'general' && admin
              ? (english ? 'Administrator' : 'Quản trị')
              : `${admin ? (english ? 'Admin · ' : 'Quản trị · ') : ''}${quota}`}
          </span>
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="ai-account-menu w-72 p-1.5">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="ai-account-menu__label">
            <span className="block truncate">{email}</span>
            <span className="mt-1 block font-normal text-muted-foreground">
              {admin
                ? english ? 'Administrator account' : 'Tài khoản quản trị'
                : access?.message || (english ? 'Signed-in account' : 'Tài khoản đã đăng nhập')}
            </span>
            {access?.subscription ? (
              <span className="mt-1 block font-normal text-muted-foreground">
                {english ? 'Plan' : 'Gói'} {access.subscription.planName}: {english ? 'remaining' : 'còn'}{' '}
                {access.subscription.remaining ?? (english ? 'unlimited' : 'không giới hạn')} {english ? 'uses' : 'lượt'}
              </span>
            ) : null}
          </DropdownMenuLabel>
          {syncError ? (
            <output className="ai-account-menu__status">
              <CircleAlert className="size-3.5 shrink-0" />
              <span>{syncError}</span>
            </output>
          ) : null}
          <DropdownMenuSeparator />
          {context === 'ai' && needsReauth ? (
            <DropdownMenuItem className="glass-menu__item" onClick={onLogin}>
              <LogIn aria-hidden="true" />
              {english ? 'Sign in again' : 'Đăng nhập lại'}
            </DropdownMenuItem>
          ) : null}
          {context === 'ai' ? <DropdownMenuItem className="glass-menu__item" onClick={onRefresh}>
            <RefreshCw aria-hidden="true" />
            {english ? 'Refresh status' : 'Làm mới trạng thái'}
          </DropdownMenuItem> : null}
          {admin ? (
            <DropdownMenuItem className="glass-menu__item">
              <ShieldCheck aria-hidden="true" />
              {english ? 'Admin access · full AI' : 'Quyền quản trị · AI đầy đủ'}
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem
            className="glass-menu__item"
            variant="destructive"
            disabled={busy}
            onClick={onSignOut}
          >
            <LogOut aria-hidden="true" />
            {english ? 'Sign out / switch account' : 'Đăng xuất / đổi tài khoản'}
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
