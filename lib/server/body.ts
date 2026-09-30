export class RequestBodyTooLargeError extends Error {
  constructor() {
    super('Request body too large');
  }
}

export async function readJsonBody(
  request: Request,
  maxBytes: number,
  signal?: AbortSignal,
) {
  const declared = Number(request.headers.get('content-length') ?? 0);
  if (declared > maxBytes) throw new RequestBodyTooLargeError();
  if (!request.body) return null;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      signal?.throwIfAborted();
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new RequestBodyTooLargeError();
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  if (!body.length) return null;
  return JSON.parse(new TextDecoder().decode(body)) as unknown;
}
