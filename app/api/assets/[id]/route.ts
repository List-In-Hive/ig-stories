import { localStorage } from '@/lib/storage';
import { authenticated, failure, noCache } from '@/lib/http';
export const runtime = 'nodejs';
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    authenticated(request);
    const asset = localStorage.read((await context.params).id);
    return new Response(new Uint8Array(asset.bytes), {
      headers: { ...noCache, 'Content-Type': asset.mime, 'X-Content-Type-Options': 'nosniff' },
    });
  } catch (error) {
    return failure(error);
  }
}
