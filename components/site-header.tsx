'use client';

import Link, { useLinkStatus } from 'next/link';
import { usePathname } from 'next/navigation';
import { signIn, signOut, useSession } from 'next-auth/react';
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
} from 'react';
import {
  BookOpen,
  Wrench,
  ChartNoAxesCombined,
  Heart,
  Newspaper,
  RefreshCw,
  Sparkles,
  Languages,
  MoreHorizontal,
  WalletCards,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { BrandMark } from '@/components/brand-mark';
import { Lightbulb } from '@/components/ui/lightbulb';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useLocale } from '@/components/locale-provider';
import { localeLabels, type Locale } from '@/lib/i18n';
import { useTheme } from '@/components/theme-provider';
import type { DashboardHeaderActions } from '@/components/app-shell';
import { AccountMenu } from '@/components/analysis/account-menu';
import { useAccountMenuState } from '@/components/account-menu-context';

const pages = [
  {
    href: '/',
    label: { vi: 'Bảng giá', en: 'Prices' },
    icon: ChartNoAxesCombined,
  },
  {
    href: '/so-vang',
    label: { vi: 'Sổ vàng', en: 'Gold ledger' },
    icon: WalletCards,
  },
  {
    href: '/cong-cu-vang',
    label: { vi: 'Công cụ', en: 'Tools' },
    icon: Wrench,
  },
  {
    href: '/nhip-vang',
    label: { vi: 'Tin vàng', en: 'Gold news' },
    icon: Newspaper,
  },
  {
    href: '/huong-dan',
    label: { vi: 'Hướng dẫn', en: 'Guide' },
    icon: BookOpen,
  },
  { href: '/donate', label: { vi: 'Ủng hộ', en: 'Donate' }, icon: Heart },
] as const;

type NavIndicator = {
  x: number;
  width: number;
  ready: boolean;
};

function isPageActive(href: string, pathname: string) {
  if (href.startsWith('/phan-tich')) return pathname === '/phan-tich';
  if (href === '/') return pathname === '/';
  if (href === '/cong-cu-vang')
    return pathname === href || pathname.startsWith('/so-sanh/');
  return pathname === href || pathname.startsWith(`${href}/`);
}

function editorialNavHref(pathname: string) {
  return pathname === '/' ? '#nhip-vang' : '/#nhip-vang';
}

function handleEditorialNavClick(
  event: MouseEvent<HTMLAnchorElement>,
  pathname: string,
) {
  if (pathname !== '/') return;
  const target = document.getElementById('nhip-vang');
  if (!target) return;
  event.preventDefault();
  window.history.pushState({}, '', '#nhip-vang');
  target.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function useNavIndicator(
  pathname: string,
  navRef: { current: HTMLElement | null },
  linkRefs: { current: Record<string, HTMLAnchorElement | null> },
) {
  const [indicator, setIndicator] = useState<NavIndicator>({
    x: 0,
    width: 0,
    ready: false,
  });

  useEffect(() => {
    let frame = 0;
    const nav = navRef.current;
    const activeHref = pages.find((page) =>
      isPageActive(page.href, pathname),
    )?.href ?? (pathname === '/phan-tich' ? '/phan-tich' : undefined);
    const activeLink = activeHref ? linkRefs.current[activeHref] : null;
    if (!nav || !activeLink) {
      setIndicator((current) =>
        current.ready ? { ...current, ready: false } : current,
      );
      return;
    }

    const update = () => {
      if (!activeLink.offsetParent) return;
      const navRect = nav.getBoundingClientRect();
      const linkRect = activeLink.getBoundingClientRect();
      const next = {
        x: Math.round(linkRect.left - navRect.left),
        width: Math.round(linkRect.width),
        ready: true,
      };
      setIndicator((current) =>
        current.x === next.x &&
        current.width === next.width &&
        current.ready === next.ready
          ? current
          : next,
      );
    };
    const schedule = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(update);
    };
    const observer =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(schedule);

    observer?.observe(nav);
    observer?.observe(activeLink);
    window.addEventListener('resize', schedule);
    schedule();

    return () => {
      window.cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener('resize', schedule);
    };
  }, [pathname, navRef, linkRefs]);

  return indicator;
}

function indicatorStyle(indicator: NavIndicator) {
  return {
    '--nav-indicator-x': `${indicator.x}px`,
    '--nav-indicator-width': `${indicator.width}px`,
    '--nav-indicator-opacity': indicator.ready ? '1' : '0',
  } as CSSProperties;
}

export function SiteHeader({
  dashboardActions,
}: {
  dashboardActions?: DashboardHeaderActions | null;
}) {
  const { locale } = useLocale();
  const pathname = usePathname();
  const { status, data: session, update } = useSession();
  const { state: sharedAccount } = useAccountMenuState();
  const desktopNavRef = useRef<HTMLElement>(null);
  const mobileNavRef = useRef<HTMLElement>(null);
  const desktopLinkRefs = useRef<Record<string, HTMLAnchorElement | null>>({});
  const mobileLinkRefs = useRef<Record<string, HTMLAnchorElement | null>>({});
  const desktopIndicator = useNavIndicator(
    pathname,
    desktopNavRef,
    desktopLinkRefs,
  );
  const mobileIndicator = useNavIndicator(
    pathname,
    mobileNavRef,
    mobileLinkRefs,
  );
  const isActive = (href: string) => isPageActive(href, pathname);
  const currentRedirect = () => {
    if (typeof window === 'undefined') return pathname;
    return `${pathname}${window.location.search}${window.location.hash}`;
  };
  const defaultLogin = () => {
    void signIn('google', { redirectTo: currentRedirect() });
  };
  const defaultSignOut = () => {
    void signOut({ redirectTo: '/' });
  };
  const mobileAnalysisHref = dashboardActions?.analysisHref ?? '/phan-tich';
  const mobilePages = [
    pages[0],
    pages[1],
    pages[2],
    { href: mobileAnalysisHref, label: { vi: 'Hỏi AI', en: 'Ask AI' }, icon: Sparkles },
  ];
  const text = locale === 'en'
    ? {
        home: 'Kim Tuyến — Home',
        caption: 'Vietnam gold prices',
        nav: 'Main navigation',
        mobileNav: 'Mobile navigation',
        more: 'More',
      }
    : {
        home: 'Kim Tuyến — Trang chủ',
        caption: 'Giá vàng Việt Nam',
        nav: 'Điều hướng chính',
        mobileNav: 'Điều hướng trên điện thoại',
        more: 'Thêm',
      };

  return (
    <>
      <header
        className="site-header"
        style={{ viewTransitionName: 'site-header' }}
      >
        <div className="glass-header">
          <Link
            href="/"
            className="site-brand"
            aria-label={`${text.home} · ${text.caption}`}
          >
            <span className="site-brand__mark">
              <BrandMark />
            </span>
            <span>
              <span className="site-brand__name">Kim Tuyến</span>
              <span className="site-brand__caption">{text.caption}</span>
            </span>
          </Link>
          <nav
            ref={desktopNavRef}
            className="glass-nav glass-nav--desktop"
            style={indicatorStyle(desktopIndicator)}
            aria-label={text.nav}
          >
            <span className="glass-nav__indicator" aria-hidden="true" />
            {pages.slice(0, 4).map(({ href, label, icon: Icon }) => (
              <Link
                key={href}
                href={href === '/nhip-vang' ? editorialNavHref(pathname) : href}
                onClick={
                  href === '/nhip-vang'
                    ? (event) => handleEditorialNavClick(event, pathname)
                    : undefined
                }
                ref={(node) => {
                  desktopLinkRefs.current[href] = node;
                }}
                aria-current={isActive(href) ? 'page' : undefined}
                className="glass-nav__link"
              >
                <NavLinkContent Icon={Icon} label={label[locale]} />
              </Link>
            ))}
            <div className="glass-nav__dashboard-actions glass-nav__dashboard-actions--analysis">
              {dashboardActions?.analysis ?? (
                <DefaultAnalysisAction active={isActive('/phan-tich')} locale={locale} />
              )}
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger
                className="glass-nav__link"
                aria-label={text.more}
                aria-current={
                  pathname === '/huong-dan' || pathname === '/donate'
                    ? 'page'
                    : undefined
                }
              >
                <NavLinkContent Icon={MoreHorizontal} label={text.more} />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="glass-language-menu w-56">
                <DropdownMenuItem className="glass-menu__item" onClick={() => { window.location.href = '/huong-dan'; }}>
                  {locale === 'en' ? 'Step-by-step guide' : 'Hướng dẫn từng bước'}
                </DropdownMenuItem>
                <DropdownMenuItem className="glass-menu__item" onClick={() => { window.location.href = '/donate'; }}>
                  {locale === 'en' ? 'Support the project' : 'Ủng hộ dự án'}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <div className="glass-nav__dashboard-actions glass-nav__dashboard-actions--refresh">
              {dashboardActions?.refresh ?? <DefaultRefreshAction locale={locale} />}
            </div>
          </nav>
          <div className="glass-header__utilities">
            <LanguageToggle />
            <ThemeToggle />
            <AccountMenu
              context={sharedAccount?.context ?? 'general'}
              status={status}
              sessionAccount={session?.user}
              access={sharedAccount?.access}
              accessError={sharedAccount?.accessError}
              signingIn={sharedAccount?.signingIn}
              busy={sharedAccount?.busy}
              locale={locale}
              onLogin={sharedAccount?.onLogin ?? defaultLogin}
              onRefresh={sharedAccount?.onRefresh ?? (() => { void update(); })}
              onSignOut={sharedAccount?.onSignOut ?? defaultSignOut}
            />
          </div>
        </div>
      </header>
      <nav
        ref={mobileNavRef}
        className="glass-bottom-nav"
        style={indicatorStyle(mobileIndicator)}
        aria-label={text.mobileNav}
      >
        <span className="glass-bottom-nav__indicator" aria-hidden="true" />
        {mobilePages.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href === '/nhip-vang' ? editorialNavHref(pathname) : href}
            onClick={
              href === '/nhip-vang'
                ? (event) => handleEditorialNavClick(event, pathname)
                : undefined
            }
            ref={(node) => {
              mobileLinkRefs.current[href.startsWith('/phan-tich') ? '/phan-tich' : href] = node;
            }}
            aria-current={isActive(href) ? 'page' : undefined}
            className="glass-bottom-nav__link"
          >
            <NavLinkContent Icon={Icon} label={label[locale]} mobile />
          </Link>
        ))}
        <MobileMoreMenu locale={locale} />
      </nav>
    </>
  );
}

function MobileMoreMenu({ locale }: { locale: Locale }) {
  const { setLocale } = useLocale();
  const { resolvedTheme, setPreference } = useTheme();
  const pathname = usePathname();
  const english = locale === 'en';
  const nextTheme = resolvedTheme === 'dark' ? 'light' : 'dark';
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="glass-bottom-nav__link"
        aria-label={english ? 'Open more options' : 'Mở thêm lựa chọn'}
        aria-current={
          pathname === '/nhip-vang' ||
          pathname.startsWith('/nhip-vang/') ||
          pathname === '/huong-dan' ||
          pathname === '/donate'
            ? 'page'
            : undefined
        }
      >
        <NavLinkContent Icon={MoreHorizontal} label={english ? 'More' : 'Thêm'} mobile />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side="top" className="glass-language-menu w-56">
        <DropdownMenuItem aria-current={pathname.startsWith('/nhip-vang') ? 'page' : undefined} className="glass-menu__item" onClick={() => { window.location.href = '/nhip-vang'; }}>
          {english ? 'Gold news · Gold Pulse' : 'Tin vàng · Nhịp vàng'}
        </DropdownMenuItem>
        <DropdownMenuItem aria-current={pathname === '/huong-dan' ? 'page' : undefined} className="glass-menu__item" onClick={() => { window.location.href = '/huong-dan'; }}>
          {english ? 'Guide' : 'Hướng dẫn'}
        </DropdownMenuItem>
        <DropdownMenuItem aria-current={pathname === '/donate' ? 'page' : undefined} className="glass-menu__item" onClick={() => { window.location.href = '/donate'; }}>
          {english ? 'Support the project' : 'Ủng hộ dự án'}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup
          value={locale}
          onValueChange={(value) => {
            if (value === 'vi' || value === 'en') void setLocale(value);
          }}
        >
          <DropdownMenuRadioItem value="vi" className="glass-menu__item">Tiếng Việt</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="en" className="glass-menu__item">English</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuItem
          className="glass-menu__item"
          onClick={() => setPreference(nextTheme)}
        >
          <Lightbulb aria-hidden="true" />
          {english ? `Switch to ${nextTheme} mode` : `Chuyển sang giao diện ${nextTheme === 'dark' ? 'tối' : 'sáng'}`}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function DefaultAnalysisAction({
  active = false,
  locale,
}: {
  active?: boolean;
  locale: Locale;
}) {
  const label = locale === 'en' ? 'Ask AI' : 'Hỏi AI';
  return (
    <Link
      href="/phan-tich"
      className={`glass-action ${active ? 'glass-action--active' : ''}`}
      aria-label={locale === 'en' ? 'Ask AI about gold' : 'Hỏi AI về giá vàng'}
      aria-current={active ? 'page' : undefined}
    >
      <Sparkles size={16} aria-hidden="true" />
      <span>{label}</span>
    </Link>
  );
}

function DefaultRefreshAction({ locale }: { locale: Locale }) {
  const label = locale === 'en' ? 'Refresh page' : 'Làm mới trang';
  return (
    <Button
      variant="outline"
      size="icon"
      aria-label={label}
      title={label}
      onClick={() => window.location.reload()}
    >
      <RefreshCw size={16} aria-hidden="true" />
    </Button>
  );
}

function ThemeToggle() {
  const { locale } = useLocale();
  const { resolvedTheme, setPreference } = useTheme();
  const nextTheme = resolvedTheme === 'dark' ? 'light' : 'dark';
  const nextThemeLabel = locale === 'en'
    ? nextTheme === 'dark'
      ? 'dark mode'
      : 'light mode'
    : nextTheme === 'dark'
      ? 'tối'
      : 'sáng';

  return (
    <Lightbulb
      className="glass-theme-trigger"
      aria-label={locale === 'en' ? `Switch to ${nextThemeLabel}` : `Chuyển sang giao diện ${nextThemeLabel}`}
      title={locale === 'en' ? `Switch to ${nextThemeLabel}` : `Chuyển sang giao diện ${nextThemeLabel}`}
      aria-pressed={resolvedTheme === 'dark'}
      data-theme-toggle="lightbulb"
      onClick={() => setPreference(nextTheme)}
      suppressHydrationWarning
    />
  );
}

function LanguageToggle() {
  const { locale, setLocale, isChangingLocale, localeError } = useLocale();
  const [open, setOpen] = useState(false);
  const label = locale === 'en' ? 'Language (EN)' : 'Ngôn ngữ (VI)';

  return (
    <div className="glass-language-control">
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger
          className="glass-language-trigger"
          aria-label={label}
          title={label}
          disabled={isChangingLocale}
        >
          <Languages size={17} aria-hidden="true" />
          <span>{locale.toUpperCase()}</span>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="glass-language-menu w-44">
          <DropdownMenuRadioGroup
            value={locale}
            onValueChange={(value) => {
              setOpen(false);
              if (value === 'vi' || value === 'en') void setLocale(value);
            }}
          >
            {(['vi', 'en'] as const).map((option) => (
              <DropdownMenuRadioItem
                key={option}
                value={option}
                className="glass-menu__item"
              >
                <span className="w-6 font-semibold tabular-nums">
                  {option.toUpperCase()}
                </span>
                {localeLabels[option]}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      {localeError ? (
        <output className="sr-only">
          {localeError}
        </output>
      ) : null}
    </div>
  );
}

function NavLinkContent({
  Icon,
  label,
  mobile = false,
}: {
  Icon: LucideIcon;
  label: string;
  mobile?: boolean;
}) {
  const { pending } = useLinkStatus();
  return (
    <span className="glass-nav__link-content" data-pending={pending}>
      <Icon size={mobile ? 18 : 16} strokeWidth={1.8} aria-hidden="true" />
      <span>{label}</span>
      <span className="glass-nav__pending" aria-hidden="true" />
    </span>
  );
}
