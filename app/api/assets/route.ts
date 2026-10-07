import { NextResponse } from 'next/server';
import { uploadFont, uploadLogo } from '@/lib/storage';
import { authenticated, failure, sameOrigin } from '@/lib/http';
import { AppError } from '@/lib/errors';
export const runtime = 'nodejs';
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    authenticated(request);
    const form = await request.formData();
    const file = form.get('file');
    if (!(file instanceof File)) throw new AppError('Select a file.');
    if (form.get('kind') === 'font')
      return NextResponse.json(uploadFont(Buffer.from(await file.arrayBuffer())));
    if (file.size > 5 * 1024 * 1024) throw new AppError('Choose a logo smaller than 5 MB.');
    return NextResponse.json({
      id: await uploadLogo(Buffer.from(await file.arrayBuffer()), file.type),
    });
  } catch (error) {
    return failure(error);
  }
}
