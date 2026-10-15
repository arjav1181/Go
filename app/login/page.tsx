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
    <div className="mx-auto max-w-sm space-y-6 py-10">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Owner sign in</h1>
        <p className="text-sm text-[var(--muted)]">Only verified owner accounts may manage links.</p>
      </div>
      <Suspense fallback={null}>
        <LoginForm />
      </Suspense>
    </div>
  );
}
