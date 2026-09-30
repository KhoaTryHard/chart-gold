'use client';

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { SiteHeader } from '@/components/site-header';
import { useLocale } from '@/components/locale-provider';
import { AccountMenuProvider } from '@/components/account-menu-context';

type HeaderActionsContextValue = {
  setDashboardActions: (actions: DashboardHeaderActions | null) => void;
};

export type DashboardHeaderActions = {
  analysis: ReactNode;
  analysisHref?: string;
  refresh: ReactNode;
};

const HeaderActionsContext = createContext<HeaderActionsContextValue | null>(
  null,
);

export function AppShell({
  children,
  footer,
}: {
  children: ReactNode;
  footer?: ReactNode;
}) {
  const { locale } = useLocale();
  const [dashboardActions, setDashboardActions] =
    useState<DashboardHeaderActions | null>(null);
  const setDashboardActionsValue = useCallback(
    (actions: DashboardHeaderActions | null) => {
      setDashboardActions(actions);
    },
    [],
  );
  const headerActionsContext = useMemo(
    () => ({ setDashboardActions: setDashboardActionsValue }),
    [setDashboardActionsValue],
  );

  return (
    <HeaderActionsContext.Provider value={headerActionsContext}>
      <AccountMenuProvider>
        <div className="app-shell liquid-page min-h-screen text-foreground">
        <a className="skip-link" href="#main-content">
          {locale === 'en' ? 'Skip navigation' : 'Bỏ qua điều hướng'}
        </a>
        <SiteHeader dashboardActions={dashboardActions} />
        <div className="app-content-shell">{children}</div>
        {footer}
        </div>
      </AccountMenuProvider>
    </HeaderActionsContext.Provider>
  );
}

export function useHeaderActions() {
  const context = useContext(HeaderActionsContext);
  if (!context)
    throw new Error('useHeaderActions must be used within AppShell.');
  return context;
}
