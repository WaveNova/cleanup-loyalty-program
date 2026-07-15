import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const { passcode } = await req.json();
  const expected = process.env.STATION_PASSCODE;

  if (!expected || passcode !== expected) {
    return NextResponse.json({ error: 'Invalid passcode' }, { status: 401 });
  }

  return NextResponse.json({ ok: true });
}
