/**
 * Search-query sanitisation for PostgREST `.or()` filters.
 *
 * The dashboard builds a filter string such as `slug.ilike.%foo%,title.ilike.%foo%`.
 * Anything that could terminate or inject a filter clause (commas, parentheses,
 * quotes, wildcards) is stripped, and control characters are removed rather
 * than embedded literally in the source file.
 */

/** PostgREST filter metacharacters plus whitespace runs. */
const UNSAFE = /[%*(),"'\\]/g;
/** C0/C1 control characters, written as escapes so they stay readable. */
const CONTROL = /[\u0000-\u001f\u007f]/g;

export function sanitizeSearchQuery(input: string): string {
  return input
    .replace(UNSAFE, ' ')
    .replace(CONTROL, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}