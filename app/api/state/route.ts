import { NextResponse } from 'next/server';
import { state } from '@/lib/services';
import { authenticated, failure, noCache } from '@/lib/http';
export const runtime = 'nodejs';
export async function GET(request: Request) {
  try {
    return NextResponse.json(state(authenticated(request)), { headers: noCache });
  } catch (error) {
    return failure(error);
  }
}
