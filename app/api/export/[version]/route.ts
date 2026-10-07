import { exportVersion, recordExport } from '@/lib/services';
import { renderPng } from '@/lib/composition';
import { filename } from '@/lib/export';
import { authenticated, failure, noCache } from '@/lib/http';
export const runtime = 'nodejs';
export async function GET(request: Request, context: { params: Promise<{ version: string }> }) {
  try {
    const user = authenticated(request);
    const version = exportVersion((await context.params).version);
    const bytes = renderPng(version.data);
    recordExport(version, user.id, 'png');
    return new Response(new Uint8Array(bytes), {
      headers: {
        ...noCache,
        'Content-Type': 'image/png',
        'Content-Disposition': `attachment; filename="${filename(version)}"`,
      },
    });
  } catch (error) {
    return failure(error);
  }
}
