import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * Liveness check.
 *
 * Answers "is this process running?" only. It deliberately does not touch the
 * database and reveals no version, dependency, host or configuration detail, so
 * it is safe to expose publicly.
 */
export async function GET() {
  return NextResponse.json(
    { status: 'ok' },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
