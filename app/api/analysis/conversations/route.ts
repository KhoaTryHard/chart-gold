import { auth } from '@/auth';
import { ensureSessionUser, BillingError } from '@/lib/billing/server';
import { deleteAllConversations, listConversations } from '@/lib/server/ai-conversations';
import { isTrustedOrigin } from '@/lib/server/origin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const headers = {
  'Cache-Control': 'private, no-store',
  Vary: 'Cookie',
  'X-Content-Type-Options': 'nosniff',
};

function respond(body: unknown, status = 200) {
  return Response.json(body, { status, headers });
}

async function currentUser() {
  const session = await auth();
  if (!session?.user?.email) return null;
  return ensureSessionUser(session);
}

export async function GET() {
  try {
    const user = await currentUser();
    if (!user) return respond({ code: 'AUTH_REQUIRED', error: 'Đăng nhập Google để xem lịch sử.' }, 401);
    return respond({ conversations: await listConversations(user.id) });
  } catch (error) {
    if (error instanceof BillingError) return respond({ code: error.code, error: error.message }, error.status);
    return respond({ code: 'CONVERSATION_UNAVAILABLE', error: 'Không thể tải lịch sử hội thoại.' }, 503);
  }
}

export async function DELETE(request: Request) {
  try {
    if (!isTrustedOrigin(request)) return respond({ code: 'INVALID_ORIGIN', error: 'Yêu cầu không hợp lệ.' }, 403);
    const user = await currentUser();
    if (!user) return respond({ code: 'AUTH_REQUIRED', error: 'Đăng nhập Google để xóa lịch sử.' }, 401);
    await deleteAllConversations(user.id);
    return respond({ deleted: true });
  } catch (error) {
    if (error instanceof BillingError) return respond({ code: error.code, error: error.message }, error.status);
    return respond({ code: 'CONVERSATION_UNAVAILABLE', error: 'Không thể xóa lịch sử hội thoại.' }, 503);
  }
}

