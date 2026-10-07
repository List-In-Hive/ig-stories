import { exportVersion, recordExport } from '@/lib/services';
import { filename, renderStory } from '@/lib/export';
import { authenticated, failure, noCache } from '@/lib/http';
export const runtime = 'nodejs';
export async function GET(request: Request, context: { params: Promise<{ version: string }> }) {
  try {
    const user = authenticated(request);
    const version = exportVersion((await context.params).version);
    const image = await renderStory(version.data);
    recordExport(version, user.id, image.extension);
    return new Response(new Uint8Array(image.bytes), {
      headers: {
        ...noCache,
        'Content-Type': image.mime,
        'Content-Disposition': `attachment; filename="${filename(version, image.extension)}"`,
      },
    });
  } catch (error) {
    return failure(error);
  }
}
