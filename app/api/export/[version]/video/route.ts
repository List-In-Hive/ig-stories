import { z } from 'zod';
import { exportVersion, recordExport } from '@/lib/services';
import { filename } from '@/lib/export';
import { MOTIONS, renderVideo } from '@/lib/video';
import { animation } from '@/lib/animate';
import { localStorage } from '@/lib/storage';
import { AppError } from '@/lib/errors';
import { authenticated, failure, noCache } from '@/lib/http';
export const runtime = 'nodejs';
// The approved version as an MP4: a camera move made here, or the finished AI video.
export async function GET(request: Request, context: { params: Promise<{ version: string }> }) {
  try {
    const user = authenticated(request);
    const version = exportVersion((await context.params).version);
    const motion = z
      .enum([...MOTIONS, 'ai'])
      .catch('zoom-in')
      .parse(new URL(request.url).searchParams.get('motion'));
    let bytes: Buffer;
    if (motion === 'ai') {
      const assetId = animation(version.id)?.assetId;
      if (!assetId) throw new AppError('The AI video is not ready yet.', 404);
      bytes = localStorage.read(assetId).bytes;
    } else bytes = await renderVideo(version.data, { motion });
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
