import 'next-auth';
import 'next-auth/jwt';
import type { DefaultSession } from 'next-auth';

declare module 'next-auth' {
  interface Session {
    user: {
      isAdmin: boolean;
      canUseAi: boolean;
      role?: 'user' | 'admin';
      id?: string;
      /** Stable provider subject, when the session came from Google OAuth. */
      googleSubject?: string;
    } & DefaultSession['user'];
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    isAdmin?: boolean;
    userId?: string;
    googleSubject?: string;
    canUseAi?: boolean;
    role?: 'user' | 'admin';
  }
}
