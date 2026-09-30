import NextAuth from 'next-auth';
import Google from 'next-auth/providers/google';
import { subscriptionsEnabled } from '@/lib/billing/config';
import { isAdminEmail } from '@/lib/auth-authorization';

export { isAdminEmail } from '@/lib/auth-authorization';

export const { handlers, auth, signIn, signOut } = NextAuth({
  basePath: '/api/auth',
  // Keep callback and server auth() on the same secure cookie behind proxies.
  useSecureCookies: process.env.VERCEL === '1' ? true : undefined,
  providers: [
    Google({
      clientId: process.env.AUTH_GOOGLE_ID ?? '',
      clientSecret: process.env.AUTH_GOOGLE_SECRET ?? '',
    }),
  ],
  secret: process.env.AUTH_SECRET,
  session: {
    strategy: 'jwt',
    maxAge: 8 * 60 * 60,
  },
  callbacks: {
    async signIn({ user: _user, profile }) {
      if (
        !profile ||
        !('email_verified' in profile) ||
        profile.email_verified !== true
      ) {
        return false;
      }
      return true;
    },
    async jwt({ token, account }) {
      // Auth.js creates a new random `user.id` for JWT-only OAuth sessions.
      // Google `providerAccountId` is the stable subject we need for billing
      // and entitlement records across logins and devices.
      if (account?.provider === 'google' && account.providerAccountId) {
        token.googleSubject = account.providerAccountId.trim();
      }
      token.isAdmin = isAdminEmail(token.email);
      token.userId = token.sub;
      token.role = token.isAdmin === true ? 'admin' : 'user';
      token.canUseAi = subscriptionsEnabled() || token.isAdmin === true;
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.isAdmin = token.isAdmin === true;
        session.user.id = token.userId ?? token.sub ?? '';
        session.user.googleSubject = token.googleSubject;
        session.user.canUseAi =
          subscriptionsEnabled() || token.isAdmin === true;
        session.user.role =
          token.role ?? (token.isAdmin === true ? 'admin' : 'user');
      }
      return session;
    },
  },
  events: {
    async signIn({ user, account }) {
      if (!subscriptionsEnabled() || !user.email) return;
      try {
        const { ensureBillingUser } = await import('@/lib/billing/server');
        await ensureBillingUser({
          googleSubject:
            account?.provider === 'google'
              ? account.providerAccountId
              : undefined,
          email: user.email,
          name: user.name,
          image: user.image,
          isAdmin: isAdminEmail(user.email),
        });
      } catch (error) {
        // Login must remain usable; billing routes surface a configuration error.
        console.error('billing identity sync failed during sign-in', {
          code:
            error && typeof error === 'object' && 'code' in error
              ? String((error as { code?: unknown }).code)
              : 'UNKNOWN',
        });
      }
    },
  },
});
