'use client';

import { createContext, useContext, useState, type ReactNode } from 'react';
import type { AnalysisAccess } from '@/lib/analysis/access';

export type SharedAccountMenuState = {
  context: 'ai' | 'general';
  access?: AnalysisAccess | null;
  accessError?: string;
  signingIn?: boolean;
  busy?: boolean;
  onLogin?: () => void;
  onRefresh?: () => void;
  onSignOut?: () => void;
};

type AccountMenuContextValue = {
  state: SharedAccountMenuState | null;
  setState: (state: SharedAccountMenuState | null) => void;
};

const AccountMenuContext = createContext<AccountMenuContextValue | null>(null);

export function AccountMenuProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SharedAccountMenuState | null>(null);
  return (
    <AccountMenuContext.Provider value={{ state, setState }}>
      {children}
    </AccountMenuContext.Provider>
  );
}

export function useAccountMenuState() {
  const context = useContext(AccountMenuContext);
  if (!context) throw new Error('useAccountMenuState must be used within AccountMenuProvider.');
  return context;
}

