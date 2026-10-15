/**
 * Minimal RFC 4180 CSV writer.
 *
 * Escaping rules:
 *  - wrap a field in double quotes if it contains a comma, quote, CR or LF;
 *  - double any embedded quote character;
 *  - keep CR/LF inside quoted fields (spreadsheets handle these correctly).
 *
 * Spreadsheet formula injection guard:
 *  - owner-supplied text (titles, notes, referrer hosts) that could be read as a
 *    formula is prefixed with a tab so it is treated as literal text;
 *  - the guard is skipped for real numbers so numeric columns such as click
 *    counts and deltas stay numeric (-50 must not become text).
 */

const NEEDS_QUOTES = /[",\r\n]/;
const FORMULA_PREFIX = /^[\s]*[=+\-@]/;
const CONTROL_PREFIX = /^[\t\r]/;

export function escapeCsvValue(value: unknown): string {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(value) : '';
  }

  let text = value === null || value === undefined ? '' : String(value);

  if (FORMULA_PREFIX.test(text) || CONTROL_PREFIX.test(text)) {
    text = `\t${text}`;
  }

  if (NEEDS_QUOTES.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export type CsvValue = string | number | null | undefined;

export function toCsvRow(values: CsvValue[]): string {
  return values.map(escapeCsvValue).join(',');
}

export function toCsv(headers: string[], rows: CsvValue[][]): string {
  const lines = [toCsvRow(headers), ...rows.map(toCsvRow)];
  // Trailing CRLF keeps the file friendly to strict spreadsheet parsers.
  return lines.join('\r\n') + '\r\n';
}