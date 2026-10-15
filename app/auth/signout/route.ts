import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/auth/owner';

export async function POST() {
  try {
    const supabase = await createSupabaseServerClient();
    await supabase.auth.signOut();
  } catch {
    // ignore
  }
  const response = NextResponse.redirect(new URL('/login', process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'));
  return response;
}
