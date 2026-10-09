import { z } from 'zod';
import { exportVersion, recordExport } from '@/lib/services';
import { filename } from '@/lib/export';
import { MOTIONS, renderVideo } from '@/lib/video';
import { authenticated, failure, noCache } from '@/lib/http';
export const runtime = 'nodejs';
// The approved version as an MP4 with a slow camera move and the text easing in.
export async function GET(request: Request, context: { params: Promise<{ version: string }> }) {
  try {
    const user = authenticated(request);
    const version = exportVersion((await context.params).version);
    const motion = z
      .enum(MOTIONS)
      .catch('zoom-in')
      .parse(new URL(request.url).searchParams.get('motion'));
    const bytes = await renderVideo(version.data, { motion });
    recordExport(version, user.id, 'mp4');
    return new Response(new Uint8Array(bytes), {
      headers: {
        ...noCache,
        'Content-Type': 'video/mp4',
        'Content-Disposition': `attachment; filename="${filename(version, 'mp4')}"`,
      },
    });
  } catch (error) {
    return failure(error);
  }
}
