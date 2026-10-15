'use client';

import { useEffect, useState } from 'react';
import { CopyButton } from '@/components/copy-button';

/**
 * QR preview + download for a short link.
 *
 * The preview and the download use the same owner-gated endpoint, so the
 * rendered image is exactly what gets downloaded. The URL is never sent to a
 * third-party QR service.
 */
export function QrPanel({ linkId, shortUrl }: { linkId: string; shortUrl: string }) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const endpoint = `/api/links/${linkId}/qr`;

  // Reset during render when the endpoint changes, rather than synchronously in
  // the effect. React re-renders before committing, so no flash of stale state.
  const [renderedEndpoint, setRenderedEndpoint] = useState(endpoint);
  if (renderedEndpoint !== endpoint) {
    setRenderedEndpoint(endpoint);
    setDataUrl(null);
    setError(null);
    setLoading(true);
  }

  useEffect(() => {
    let cancelled = false;

    fetch(endpoint, { credentials: 'same-origin' })
      .then(async (res) => {
        if (!res.ok) throw new Error('Unable to generate QR code.');
        const blob = await res.blob();
        return URL.createObjectURL(blob);
      })
      .then((url) => {
        if (cancelled) {
          URL.revokeObjectURL(url);
          return;
        }
        setDataUrl(url);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Unable to load QR code.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [endpoint]);

  // Release the object URL when replaced or unmounted.
  useEffect(() => {
    return () => {
      if (dataUrl) URL.revokeObjectURL(dataUrl);
    };
  }, [dataUrl]);

  async function download() {
    setError(null);
    try {
      const res = await fetch(endpoint, { credentials: 'same-origin' });
      if (!res.ok) throw new Error('Unable to generate QR code.');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${shortUrl.split('/').pop() ?? 'short-link'}-qr.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to download QR code.');
    }
  }

  return (
    <div className="space-y-3 rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">QR code</h3>
        <div className="flex items-center gap-2">
          <CopyButton value={shortUrl} label="Copy link" />
          <button
            type="button"
            onClick={download}
            disabled={loading}
            className="rounded-md bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60"
          >
            Download PNG
          </button>
        </div>
      </div>

      <div className="flex items-center gap-4">
        <div className="flex h-28 w-28 shrink-0 items-center justify-center rounded-md border border-[var(--border)] bg-white p-1">
          {loading ? (
            <span className="text-xs text-slate-400">Loading…</span>
          ) : dataUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={dataUrl} alt={`QR code for ${shortUrl}`} className="h-full w-full" />
          ) : (
            <span className="px-2 text-center text-xs text-slate-400">Unavailable</span>
          )}
        </div>
        <p className="break-all text-xs text-[var(--muted)]">
          Encodes <span className="font-mono">{shortUrl}</span>
        </p>
      </div>

      {error ? (
        <p role="alert" className="text-xs text-red-600">
          {error}
        </p>
      ) : null}
    </div>
  );
}