import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

const COOKIE  = 'wn_session';
const MAX_AGE = 60 * 60 * 12; // 12 hours

export async function GET(req: NextRequest) {
  const ok = req.cookies.get(COOKIE)?.value === '1';
  return NextResponse.json({ ok });
}

export async function POST(req: NextRequest) {
  const { passcode } = await req.json();
  const expected = process.env.STATION_PASSCODE;

  if (!expected || passcode !== expected) {
    return NextResponse.json({ error: 'Invalid passcode' }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE, '1', { httpOnly: true, sameSite: 'strict', maxAge: MAX_AGE, path: '/' });
  return res;
}
