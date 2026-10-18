import { NextResponse } from 'next/server';
import { requireOwner } from '@/lib/auth/owner';
import { getServiceSupabase } from '@/lib/db/supabase-server';
import { verifyTxtRecord } from '@/lib/domains/verification';

export const dynamic = 'force-dynamic';

/**
 * POST /api/v1/domains/{id}/verify
 *
 * Re-checks the TXT record and records the outcome.
 *
 * A failed check updates `status` to 'failed' with a reason, but a domain that
 * was previously verified and now fails is left verified rather than being
 * downgraded: DNS is outside the owner's control once it is set up, and flipping
 * a working domain to 'failed' because a resolver had a bad minute would stop
 * it serving traffic for no good reason.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const owner = await requireOwner();
  const { id } = await params;

  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return NextResponse.json({ error: { code: 'invalid_request', message: 'Bad domain id.' } }, { status: 400 });
  }

  const supabase = getServiceSupabase();
  const { data } = await supabase
    .from('custom_domains')
    .select('id,hostname,verification_token,status')
    .eq('id', id)
    .eq('created_by', owner.id)
    .maybeSingle();

  if (!data) {
    return NextResponse.json({ error: { code: 'not_found', message: 'Domain not found.' } }, { status: 404 });
  }

  const row = data as { id: string; hostname: string; verification_token: string; status: string };
  const result = await verifyTxtRecord(row.hostname, row.verification_token);
  const checkedAt = new Date().toISOString();

  if (result.ok) {
    const { error } = await supabase
      .from('custom_domains')
      .update({
        status: 'verified',
        verified_at: checkedAt,
        last_checked_at: checkedAt,
        failure_reason: ''
      })
      .eq('id', row.id);

    if (error) {
      return NextResponse.json({ error: { code: 'server_error', message: 'Verified, but could not save.' } }, { status: 500 });
    }
    return NextResponse.json({ id: row.id, hostname: row.hostname, status: 'verified', verified: true });
  }

  const downgrade = row.status !== 'verified' ? 'failed' : row.status;

  await supabase
    .from('custom_domains')
    .update({
      status: downgrade,
      last_checked_at: checkedAt,
      failure_reason: result.reason ?? 'Verification failed.'
    })
    .eq('id', row.id);

  return NextResponse.json(
    {
      id: row.id,
      hostname: row.hostname,
      status: downgrade,
      verified: false,
      reason: result.reason
    },
    { status: 422 }
  );
}
