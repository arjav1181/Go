import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createServerClient } from '@supabase/ssr';

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export function getOwnerEmails(): string[] {
  return (process.env.OWNER_EMAILS ?? '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

export function isOwnerEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return getOwnerEmails().includes(email.trim().toLowerCase());
}

export async function createSupabaseServerClient() {
  const cookieStore = await cookies();
  return createServerClient(
    requiredEnv('NEXT_PUBLIC_SUPABASE_URL'),
    requiredEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options?: Record<string, unknown> }[]) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options);
            });
          } catch {
            // Called from a Server Component; cookie writes are handled by middleware.
          }
        }
      }
    }
  );
}

export async function getCurrentUser() {
  try {
    const supabase = await createSupabaseServerClient();
    const { data } = await supabase.auth.getUser();
    return data.user ?? null;
  } catch {
    return null;
  }
}

export async function getOwnerOrNull() {
  const user = await getCurrentUser();
  if (!user) return null;
  if (!(user.email_confirmed_at ?? (user as { confirmed_at?: string | null }).confirmed_at)) return null;
  if (!isOwnerEmail(user.email)) return null;
  return user;
}

export async function requireOwner() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  const verified = user.email_confirmed_at ?? (user as { confirmed_at?: string | null }).confirmed_at;
  if (!verified || !isOwnerEmail(user.email)) redirect('/login?error=Not+authorized');
  return user;
}

export async function assertOwner() {
  const user = await getOwnerOrNull();
  if (!user) throw new Error('Unauthorized');
  return user;
}
