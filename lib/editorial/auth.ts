import 'server-only';

import { auth } from '@/auth';
import { isAdminEmail } from '@/lib/auth-authorization';
import { getDatabase } from '@/db';
import { users } from '@/db/schema';
import { eq } from 'drizzle-orm';

export class EditorialAuthError extends Error {
  constructor(public readonly status: 401 | 403, message: string) {
    super(message);
  }
}

export async function requireEditorialAdmin() {
  const session = await auth();
  const email = session?.user?.email?.trim().toLowerCase();
  if (!session || !email) throw new EditorialAuthError(401, 'Vui lòng đăng nhập bằng Google để mở quản trị bài viết.');
  if (!session?.user?.isAdmin && !isAdminEmail(email)) throw new EditorialAuthError(403, 'Tài khoản không có quyền quản trị bài viết.');
  let id: string | null = null;
  try {
    const [user] = await getDatabase().select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
    id = user?.id ?? null;
  } catch {
    // The admin API will surface database errors when it needs to persist a revision.
  }
  return { id, email, name: session.user.name ?? 'Kim Tuyến' };
}
