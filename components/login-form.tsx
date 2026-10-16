'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

const GENERIC_FAILURE =
  'Sign-in failed. Check your credentials, or try again in a few minutes if you have tried several times.';

export default function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password })
      });

      const payload: { ok?: boolean; error?: string } = await response.json().catch(() => ({}));

      if (!response.ok || !payload.ok) {
        // Deliberately vague: never reveal whether an account exists.
        setError(payload.error ?? GENERIC_FAILURE);
        return;
      }

      router.push('/dashboard');
      router.refresh();
    } catch {
      setError(GENERIC_FAILURE);
    } finally {
      setLoading(false);
    }
  }

  const urlError = searchParams.get('error');

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      {urlError ? (
        <p className="rounded-lg border border-[var(--ds-red-500)]/30 bg-[var(--ds-red-500)]/10 px-3.5 py-3 text-copy-13 text-[var(--ds-red-600)]">
          {urlError}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="rounded-lg border border-[var(--ds-red-500)]/30 bg-[var(--ds-red-500)]/10 px-3.5 py-3 text-copy-13 text-[var(--ds-red-600)]">
          {error}
        </p>
      ) : null}
      <div className="space-y-1.5">
        <label htmlFor="email" className="block text-label-14 text-primary">Email</label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="input"
        />
      </div>
      <div className="space-y-1.5">
        <label htmlFor="password" className="block text-label-14 text-primary">Password</label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="input"
        />
      </div>
      <button type="submit" disabled={loading} className="btn btn-primary btn-lg w-full">
        {loading ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  );
}