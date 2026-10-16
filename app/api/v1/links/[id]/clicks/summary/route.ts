import { summary } from '@/lib/api/analytics-reports';

/**
 * GET /api/v1/links/{id}/clicks/summary
 *
 * Thin re-export: the three report endpoints share parsing, window defaulting
 * and the ownership check, which live in reports.ts rather than being copied.
 */
export const dynamic = 'force-dynamic';
export const GET = summary;
