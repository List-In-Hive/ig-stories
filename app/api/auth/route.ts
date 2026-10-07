import { NextResponse } from 'next/server';
import { z } from 'zod';
import { localAuth, tokenDigest } from '@/lib/auth';
import { run } from '@/lib/db';
import { failure, sameOrigin } from '@/lib/http';
export const runtime = 'nodejs';
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const body = await request.json();
    if (body.action === 'signout') {
      const token = request.headers.get('cookie')?.match(/storyloom=([^;]+)/)?.[1];
      if (token) run('DELETE FROM sessions WHERE tokenHash=?', tokenDigest(token));
      const response = NextResponse.json({ ok: true });
      response.cookies.set('storyloom', '', { httpOnly: true, path: '/', maxAge: 0 });
      return response;
    }
    const parsed = z
      .object({ username: z.string().trim().min(1).max(80), password: z.string().max(128) })
      .parse(body);
    const { token, user } = localAuth.signIn(parsed.username, parsed.password);
    const response = NextResponse.json({ user });
    response.cookies.set('storyloom', token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production' && new URL(request.url).protocol === 'https:',
      path: '/',
      maxAge: 604800,
    });
    return response;
  } catch (error) {
    return failure(error);
  }
}
