import JSZip from 'jszip';
import { z } from 'zod';
import { exportVersion, recordExport } from '@/lib/services';
import { filename, renderStory } from '@/lib/export';
import { authenticated, failure, sameOrigin, noCache } from '@/lib/http';
export const runtime = 'nodejs';
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const user = authenticated(request);
    const { versionIds } = z
      .object({ versionIds: z.array(z.string()).min(1).max(40) })
      .parse(await request.json());
    const versions = [...new Set(versionIds)].map(exportVersion);
    const zip = new JSZip();
    for (const version of versions) {
      const image = await renderStory(version.data);
      zip.file(filename(version, image.extension), image.bytes);
    }
    const bytes = await zip.generateAsync({ type: 'nodebuffer' });
    for (const version of versions) recordExport(version, user.id, 'zip');
    return new Response(new Uint8Array(bytes), {
      headers: {
        ...noCache,
        'Content-Type': 'application/zip',
        'Content-Disposition':
          'attachment; filename="inspirovate-creatives-storyloom-approved-stories.zip"',
      },
    });
  } catch (error) {
    return failure(error);
  }
}
