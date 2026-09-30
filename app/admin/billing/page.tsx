import type { Metadata } from 'next';
import Link from 'next/link';

import { auth } from '@/auth';
import { AdminBillingPanel } from '@/components/billing/admin-billing-panel';
import { PageTransition } from '@/components/page-transition';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Quản trị billing',
  robots: { index: false, follow: false },
};

export default async function AdminBillingPage() {
  const session = await auth();
  if (!session?.user?.email)
    return <PageTransition><main id="main-content" className="mx-auto max-w-3xl p-6 sm:p-10">Vui lòng đăng nhập bằng Google để mở trang quản trị.</main></PageTransition>;
  if (!session.user.isAdmin)
    return <PageTransition><main id="main-content" className="mx-auto max-w-3xl p-6 sm:p-10">Tài khoản không có quyền quản trị billing.</main></PageTransition>;
  return (
    <PageTransition>
      <main id="main-content" className="mx-auto max-w-6xl space-y-8 p-6 sm:p-10">
      <div className="glass-panel p-6 sm:p-8">
        <Link href="/" className="text-sm font-semibold text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
          ← Về dashboard
        </Link>
        <h1 className="mt-4 font-heading text-3xl font-semibold">
          Quản trị B2C billing
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Đối soát SePay, cấp gói ngoại lệ và theo dõi đơn hàng. Mọi thao tác
          được ghi audit.
        </p>
      </div>
      <section className="glass-panel p-5 sm:p-7">
        <AdminBillingPanel />
      </section>
      </main>
    </PageTransition>
  );
}
