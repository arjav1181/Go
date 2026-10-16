import { Suspense } from 'react';
import LoginForm from '@/components/login-form';

export const metadata = {
  title: 'Sign in',
  // Authentication page: no value in search results, and indexing it invites
  // credential phishing.
  robots: { index: false, follow: false, nocache: true }
};

export default function LoginPage() {
  return (
    <div className="mx-auto w-full max-w-sm px-5 py-16 sm:py-24">
      <div className="mb-8 space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
        <p className="text-[13px] leading-relaxed text-[var(--muted)]">
          Only accounts on the owner allowlist may manage links.
        </p>
      </div>
      <Suspense fallback={null}>
        <LoginForm />
      </Suspense>
    </div>
  );
}
