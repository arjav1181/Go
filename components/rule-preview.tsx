'use client';

import { useState } from 'react';
import { previewRulesAction } from '@/app/actions/rules-config';

type PreviewResult = Awaited<ReturnType<typeof previewRulesAction>>;

/**
 * "Why did this request match?" preview.
 *
 * Runs the same evaluator as the live redirect path, so the explanation is not
 * a simulation of the behaviour — it IS the behaviour.
 */
export function RulePreview({ linkId }: { linkId: string }) {
  const [queryString, setQueryString] = useState('');
  const [result, setResult] = useState<PreviewResult | null>(null);
  const [pending, setPending] = useState(false);

  async function runPreview(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    try {
      const output = await previewRulesAction(linkId, queryString, '');
      setResult(output);
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={runPreview} className="space-y-3 rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
      <div className="space-y-1">
        <label htmlFor="preview-query" className="text-sm font-medium">
          Test a request
        </label>
        <input className="input w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-2 font-mono text-sm" id="preview-query"
          name="query"
          type="text"
          value={queryString}
          onChange={(event) => setQueryString(event.target.value)}
          placeholder="lang=de&utm_source=twitter"
           />
        <p className="text-xs text-[var(--muted)]">
          Query string only. Nothing is sent anywhere; this runs on the server against your rules.
        </p>
      </div>

      <button
        type="submit"
        disabled={pending}
        className="rounded-md border border-[var(--border)] px-3 py-2 text-sm font-medium disabled:opacity-60"
      >
        {pending ? 'Evaluating…' : 'Preview'}
      </button>

      {result && !result.ok ? (
        <p role="alert" className="text-sm text-red-700 dark:text-red-400">
          {result.message}
        </p>
      ) : null}

      {result && result.ok ? (
        <div className="space-y-2 text-sm">
          <p>
            {result.matched ? (
              <>
                Matched <strong>{result.trace.find((r) => r.ruleId === result.matched)?.ruleName ?? result.matched}</strong>
                {' → '}
                <span className="font-mono text-xs">{result.destination}</span>
              </>
            ) : (
              <>No rule matched, so the link&rsquo;s own destination is used.</>
            )}
          </p>

          {result.ignoredParams.length > 0 ? (
            <p className="text-xs text-[var(--muted)]">
              Ignored tracking parameters: {result.ignoredParams.join(', ')}
            </p>
          ) : null}

          {result.shadowed.length > 0 ? (
            <p className="rounded bg-amber-50 p-2 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
              {result.shadowed.length} other rule(s) also matched but were outranked by priority.
            </p>
          ) : null}

          <ul className="space-y-2">
            {result.trace.map((entry) => (
              <li key={entry.ruleId} className="rounded border border-[var(--border)] p-2">
                <p className="text-xs font-medium">
                  {entry.priority}. {entry.ruleName} —{' '}
                  <span className={entry.matched ? 'text-green-700 dark:text-green-400' : 'text-[var(--muted)]'}>
                    {entry.matched ? 'matched' : 'no match'}
                  </span>
                </p>
                <ul className="mt-1 list-disc pl-4 text-xs text-[var(--muted)]">
                  {entry.conditions.map((condition) => (
                    <li key={condition.conditionId}>{condition.reason}</li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </form>
  );
}