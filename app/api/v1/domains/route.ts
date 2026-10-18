import { NextResponse } from 'next/server';
import { requireOwner } from '@/lib/auth/owner';
import { getServiceSupabase } from '@/lib/db/supabase-server';
import {
  validateDomainHostname,
  generateVerificationToken,
  dnsInstructions,
  MAX_DOMAIN_LENGTH
} from '@/lib/domains/verification';

export const dynamic = 'force-dynamic';

function canonicalHost(): string {
  const raw = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
  try {
    return new URL(raw).hostname;
  } catch {
    return 'localhost';
  }
}

/**
 * GET /api/v1/domains
 *
 * Lists the owner's custom domains with their status and the DNS records they
 * still need. `satisfied` is computed from the stored status rather than being a
 * live DNS check, so listing is one query and does not block on the network.
 * `POST .../verify` is the explicit way to re-check.
 */
export async function GET() {
  const owner = await requireOwner();
  const supabase = getServiceSupabase();

  const { data, error } = await supabase
    .from('custom_domains')
    .select('id,hostname,status,verification_token,root_redirect_url,verified_at,last_checked_at,failure_reason,created_at')
    .eq('created_by', owner.id)
    .eq('archived', false)
    .order('created_at', { ascending: false });

  if (error) {
    return NextResponse.json({ error: { code: 'server_error', message: 'Unable to list domains.' } }, { status: 500 });
  }

  const host = canonicalHost();

  return NextResponse.json(
    {
      domains: (data ?? []).map((row) => {
        const r = row as Record<string, unknown>;
        const hostname = String(r.hostname);
        return {
          id: r.id,
          hostname,
          status: r.status,
          root_redirect_url: r.root_redirect_url,
          verified_at: r.verified_at,
          last_checked_at: r.last_checked_at,
          failure_reason: r.failure_reason,
          // Re-derive the instructions rather than storing them: the canonical
          // host can change between when a domain was added and now, and a
          // stale CNAME target in the UI would send someone chasing an old value.
          dns: dnsInstructions(hostname, String(r.verification_token ?? ''), host)
        };
      })
    },
    { headers: { 'Cache-Control': 'private, no-store' } }
  );
}

/**
 * POST /api/v1/domains
 *
 * Registers a candidate domain and returns the records to publish. This does
 * not verify anything — the owner has to publish DNS first, then call the verify
 * endpoint. That ordering is deliberate: it lets them verify before moving live
 * traffic.
 */
export async function POST(request: Request) {
  const owner = await requireOwner();

  let body: { hostname?: string; root_redirect_url?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: { code: 'invalid_request', message: 'Body must be JSON.' } }, { status: 400 });
  }

  const hostname = String(body.hostname ?? '').trim().toLowerCase();
  const check = validateDomainHostname(hostname, canonicalHost());
  if (!check.ok) {
    return NextResponse.json(
      { error: { code: 'invalid_request', message: check.reason } },
      { status: 400 }
    );
  }

  const rootRedirect = String(body.root_redirect_url ?? '').trim();
  if (rootRedirect) {
    try {
      const url = new URL(rootRedirect);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('scheme');
    } catch {
      // The database constrains this too, but a clear message here saves a
      // round trip and this is a redirect target the owner will hit directly.
      return NextResponse.json(
        { error: { code: 'invalid_request', message: 'Root redirect must be an http(s) URL.' } },
        { status: 400 }
      );
    }
  }

  const token = generateVerificationToken();
  const supabase = getServiceSupabase();

  const { data, error } = await supabase
    .from('custom_domains')
    .insert({
      created_by: owner.id,
      hostname,
      verification_token: token,
      root_redirect_url: rootRedirect,
      status: 'pending'
    })
    .select('id,hostname,status,verification_token')
    .single();

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json(
        { error: { code: 'invalid_request', message: 'That domain is already registered.' } },
        { status: 409 }
      );
    }
    if (error.message?.includes('custom_domains_hostname_length')) {
      return NextResponse.json(
        { error: { code: 'invalid_request', message: `Must be ${MAX_DOMAIN_LENGTH} characters or fewer.` } },
        { status: 400 }
      );
    }
    return NextResponse.json({ error: { code: 'server_error', message: 'Unable to add the domain.' } }, { status: 500 });
  }

  return NextResponse.json(
    {
      id: data.id,
      hostname: data.hostname,
      status: data.status,
      dns: dnsInstructions(data.hostname, token, canonicalHost()),
      next: 'Publish these records, then POST to /api/v1/domains/{id}/verify.'
    },
    { status: 201 }
  );
}