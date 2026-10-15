import { getExpiryInfo, formatRemaining, STATUS_LABEL, type LinkStatus } from '@/lib/links/status';

const STYLES: Record<LinkStatus, string> = {
  active: 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300',
  expiring_soon: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-300',
  expired: 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300',
  disabled: 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200'
};

export function StatusBadge({
  isActive,
  expiresAt,
  now
}: {
  isActive: boolean;
  expiresAt: string | null;
  /** Pass a stable `now` so server and client renders agree. */
  now?: Date;
}) {
  const info = getExpiryInfo({ is_active: isActive, expires_at: expiresAt }, now);
  const remaining =
    info.remainingMs === null
      ? null
      : info.status === 'expired'
        ? formatRemaining(info.remainingMs)
        : `expires in ${formatRemaining(info.remainingMs)}`;

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${STYLES[info.status]}`}
    >
      {STATUS_LABEL[info.status]}
      {remaining ? <span className="font-normal opacity-80">· {remaining}</span> : null}
    </span>
  );
}