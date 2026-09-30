import type { Metadata } from 'next';
import { auth } from '@/auth';
import { AdminEditorialPanel } from '@/components/editorial/admin-editorial-panel';
import { PageTransition } from '@/components/page-transition';
import { isAdminEmail } from '@/lib/auth-authorization';
import { AdminEditorialLogin } from '@/components/editorial/admin-editorial-login';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Quản trị Nhịp vàng',
  robots: { index: false, follow: false },
};

export default async function AdminArticlesPage() {
  const session = await auth();
  const email = session?.user?.email;
  const allowed = Boolean(
    email && (session?.user?.isAdmin || isAdminEmail(email)),
  );

  return (
    <PageTransition>
      <main id="main-content" className="mx-auto max-w-6xl space-y-8 p-6 sm:p-10">
        <div className="glass-panel p-6 sm:p-8">
          <p className="tool-eyebrow">
            <span aria-hidden="true" />
            Khu vực nội bộ
          </p>
          <h1 className="mt-3 font-heading text-3xl font-semibold">
            Quản trị Nhịp vàng
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Soạn, kiểm tra nguồn và duyệt bài trước khi xuất bản.
          </p>
        </div>
        {allowed ? (
          <section className="glass-panel p-5 sm:p-7">
            <AdminEditorialPanel />
          </section>
        ) : (
          <AdminEditorialLogin email={email} />
        )}
      </main>
    </PageTransition>
  );
}
