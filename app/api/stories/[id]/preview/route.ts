import { getStory, getVersion } from '@/lib/services';
import { renderSvg } from '@/lib/composition';
import { authenticated, failure, noCache } from '@/lib/http';
import { AppError } from '@/lib/errors';
export const runtime = 'nodejs';
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    authenticated(request);
    const story = getStory((await context.params).id);
    const versionId = new URL(request.url).searchParams.get('version');
    const version = versionId ? getVersion(versionId) : story.version;
    if (version.storyId !== story.id) throw new AppError('Version does not belong to this story.');
    return new Response(renderSvg(version.data), {
      headers: { ...noCache, 'Content-Type': 'image/svg+xml', 'X-Content-Type-Options': 'nosniff' },
    });
  } catch (error) {
    return failure(error);
  }
}
