import { toCsv } from '@/lib/csv';
import { normalizeCampaign } from '@/lib/links/campaigns';
import { normalizeDestinationUrl } from '@/lib/links/validation';
import { normalizeSlug } from '@/lib/links/validation';

/**
 * Bulk link management: import and export.
 *
 * Import is deliberately *partial-success*: one bad row must not lose the other
 * four hundred. Every row is validated independently and the result reports
 * exactly what was created, what was skipped, and why each one failed.
 *
 * Export reuses the existing CSV writer, so it inherits the spreadsheet
 * formula-injection guard for owner-supplied titles and URLs.
 */

export const IMPORT_HEADERS = [
  'slug',
  'destination_url',
  'title',
  'campaign',
  'password',
  'tags'
] as const;

export type ImportRow = {
  slug: string;
  destinationUrl: string;
  title: string;
  campaign: string;
  password: string;
  tags: string[];
};

export type ImportOutcome =
  | { ok: true; row: ImportRow }
  | { ok: false; line: number; error: string; raw: Record<string, string> };

export type ImportResult = {
  created: ImportRow[];
  failed: ImportOutcome[];
  total: number;
};

/** Hard cap so one upload cannot exhaust a serverless request. */
export const MAX_IMPORT_ROWS = 2000;

/**
 * RFC 4180 reader.
 *
 * Handles quoted fields, escaped quotes, and embedded newlines. Returns rows of
 * raw strings; no interpretation happens here.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;

  // Strip a UTF-8 BOM: Excel writes one and it would otherwise corrupt the
  // first header cell.
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  while (i < input.length) {
    const char = input[i];

    if (inQuotes) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += char;
      i += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (char === ',') {
      row.push(field);
      field = '';
      i += 1;
      continue;
    }
    if (char === '\r') {
      i += 1;
      continue;
    }
    if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      i += 1;
      continue;
    }

    field += char;
    i += 1;
  }

  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((r) => r.length > 0 && r.some((cell) => cell.trim() !== ''));
}

function headerIndexMap(headerRow: string[]): Map<string, number> {
  const map = new Map<string, number>();
  headerRow.forEach((raw, index) => {
    map.set(raw.trim().toLowerCase().replace(/[\s-]+/g, '_'), index);
  });
  return map;
}

/**
 * Parse and validate an import file.
 *
 * `knownSlugs` is used to report a collision as a *skip* with a useful message
 * rather than a hard failure, so an owner re-importing a file sees what is
 * already there instead of a wall of errors.
 */
export function parseLinkImport(text: string, knownSlugs: Set<string> = new Set()): ImportResult {
  const rows = parseCsv(text);
  const created: ImportRow[] = [];
  const failed: ImportOutcome[] = [];

  if (rows.length === 0) {
    return { created, failed, total: 0 };
  }

  const headers = headerIndexMap(rows[0]);
  const required = ['slug', 'destination_url'];
  for (const name of required) {
    if (!headers.has(name)) {
      return {
        created,
        failed: [
          {
            ok: false,
            line: 1,
            error: `Missing required column "${name}". Expected headers: ${IMPORT_HEADERS.join(', ')}.`,
            raw: {}
          }
        ],
        total: 0
      };
    }
  }

  const get = (row: string[], name: string): string => {
    const index = headers.get(name);
    return index === undefined ? '' : (row[index] ?? '').trim();
  };

  const dataRows = rows.slice(1).slice(0, MAX_IMPORT_ROWS);

  for (let offset = 0; offset < dataRows.length; offset += 1) {
    const row = dataRows[offset];
    // +2: one for the header row, one for 1-based line numbers.
    const line = offset + 2;
    const raw: Record<string, string> = {};
    for (const name of IMPORT_HEADERS) raw[name] = get(row, name);

    const slug = normalizeSlug(get(row, 'slug'));
    if (slug === '') {
      failed.push({ ok: false, line, error: 'Slug is required.', raw });
      continue;
    }

    if (knownSlugs.has(slug)) {
      failed.push({ ok: false, line, error: `Slug "${slug}" already exists — skipped.`, raw });
      continue;
    }

    const destination = normalizeDestinationUrl(get(row, 'destination_url'));
    if (!destination.ok) {
      failed.push({ ok: false, line, error: `Destination: ${destination.error}`, raw });
      continue;
    }

    let campaign = '';
    const rawCampaign = get(row, 'campaign');
    if (rawCampaign !== '') {
      const parsed = normalizeCampaign(rawCampaign);
      if (!parsed.ok) {
        failed.push({ ok: false, line, error: `Campaign: ${parsed.error}`, raw });
        continue;
      }
      campaign = parsed.campaign ?? '';
    }

    const password = get(row, 'password');

    created.push({
      slug,
      destinationUrl: destination.url,
      title: get(row, 'title'),
      campaign,
      password,
      tags: get(row, 'tags')
        .split(/[|;]/)
        .map((t) => t.trim().replace(/^#/, ''))
        .filter(Boolean)
    });
  }

  return { created, failed, total: dataRows.length };
}

/** Export links for round-tripping back through the importer. */
export function toLinkCsv(
  links: Array<{
    slug: string;
    destinationUrl: string;
    title: string | null;
    campaign: string | null;
    isProtected: boolean;
    tags: string[];
  }>
): string {
  return toCsv(
    [...IMPORT_HEADERS],
    links.map((link) => [
      link.slug,
      link.destinationUrl,
      link.title ?? '',
      link.campaign ?? '',
      // Never export a password: only the fact that one exists. An export that
      // leaked passwords would be a worse leak than the links themselves.
      link.isProtected ? '(protected)' : '',
      link.tags.join('|')
    ])
  );
}