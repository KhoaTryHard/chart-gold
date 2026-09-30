import { auth } from '@/auth';
import { ensureSessionUser, BillingError } from '@/lib/billing/server';
import {
  ConversationError,
  deleteConversation,
  getConversation,
} from '@/lib/server/ai-conversations';
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

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await currentUser();
    if (!user) return respond({ code: 'AUTH_REQUIRED', error: 'Đăng nhập Google để xem hội thoại.' }, 401);
    const { id } = await params;
    return respond({ conversation: await getConversation(user.id, id) });
  } catch (error) {
    if (error instanceof ConversationError) return respond({ code: error.code, error: error.message, ...error.details }, error.status);
    if (error instanceof BillingError) return respond({ code: error.code, error: error.message }, error.status);
    return respond({ code: 'CONVERSATION_UNAVAILABLE', error: 'Không thể tải hội thoại.' }, 503);
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    if (!isTrustedOrigin(request)) return respond({ code: 'INVALID_ORIGIN', error: 'Yêu cầu không hợp lệ.' }, 403);
    const user = await currentUser();
    if (!user) return respond({ code: 'AUTH_REQUIRED', error: 'Đăng nhập Google để xóa hội thoại.' }, 401);
    const { id } = await params;
    await deleteConversation(user.id, id);
    return respond({ deleted: true, id });
  } catch (error) {
    if (error instanceof ConversationError) return respond({ code: error.code, error: error.message }, error.status);
    if (error instanceof BillingError) return respond({ code: error.code, error: error.message }, error.status);
    return respond({ code: 'CONVERSATION_UNAVAILABLE', error: 'Không thể xóa hội thoại.' }, 503);
  }
}

