import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { localAuth } from './auth';
import { AppError } from './errors';
export function authenticated(request: Request) {
  const token = request.headers.get('cookie')?.match(/(?:^|;\s*)storyloom=([^;]+)/)?.[1];
  const user = token ? localAuth.session(token) : null;
  if (!user) throw new AppError('Please sign in to continue.', 401);
  return user;
}
export function sameOrigin(request: Request) {
  const origin = request.headers.get('origin');
  const url = new URL(request.url);
  const expected = `${url.protocol}//${request.headers.get('host') || url.host}`;
  if (origin && origin !== expected) throw new AppError('This request origin is not allowed.', 403);
}
export function failure(error: unknown) {
  if (error instanceof ZodError)
    return NextResponse.json(
      { error: error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(' ') },
      { status: 400 },
    );
  if (error instanceof AppError)
    return NextResponse.json(
      { error: error.message, details: error.details },
      { status: error.status },
    );
  console.error(error);
  return NextResponse.json(
    { error: 'The request could not be completed. Please try again.' },
    { status: 500 },
  );
}
export const noCache = { 'Cache-Control': 'private, no-store' };
