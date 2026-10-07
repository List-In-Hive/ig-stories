import { NextResponse } from 'next/server';
import { getStory, layoutSchema } from '@/lib/services';
import { renderSvg, validateComposition } from '@/lib/composition';
import { authenticated, failure, sameOrigin } from '@/lib/http';
export const runtime = 'nodejs';
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    authenticated(request);
    const body = await request.json();
    const snapshot = structuredClone(getStory(body.storyId).version.data);
    snapshot.layout = layoutSchema.parse(body.layout);
    return NextResponse.json({ svg: renderSvg(snapshot), errors: validateComposition(snapshot) });
  } catch (error) {
    return failure(error);
  }
}
