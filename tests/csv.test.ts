import { test } from 'node:test';
import assert from 'node:assert/strict';
import { escapeCsvValue, toCsvRow, toCsv } from '../lib/csv';

test('plain values pass through unchanged', () => {
  assert.equal(escapeCsvValue('example.com'), 'example.com');
  assert.equal(escapeCsvValue('desktop'), 'desktop');
  assert.equal(escapeCsvValue(42), '42');
  assert.equal(escapeCsvValue(0), '0');
});

test('null and undefined become empty fields', () => {
  assert.equal(escapeCsvValue(null), '');
  assert.equal(escapeCsvValue(undefined), '');
});

test('values containing commas are quoted', () => {
  assert.equal(escapeCsvValue('a,b'), '"a,b"');
});

test('embedded quotes are doubled and field is quoted', () => {
  assert.equal(escapeCsvValue('say "hi"'), '"say ""hi"""');
});

test('newlines are preserved inside quotes', () => {
  assert.equal(escapeCsvValue('line1\nline2'), '"line1\nline2"');
  assert.equal(escapeCsvValue('line1\r\nline2'), '"line1\r\nline2"');
});

test('a lone quote is escaped', () => {
  assert.equal(escapeCsvValue('"'), '""""');
});

test('formula-like values are neutralised with a tab prefix', () => {
  assert.equal(escapeCsvValue('=1+1'), '\t=1+1');
  assert.equal(escapeCsvValue('+SUM(A1)'), '\t+SUM(A1)');
  assert.equal(escapeCsvValue('-2+3'), '\t-2+3');
  assert.equal(escapeCsvValue('@import'), '\t@import');
});

test('formula injection is neutralised even when the value also needs quoting', () => {
  // The tab guard is applied first, then the whole field is quoted.
  assert.equal(escapeCsvValue('=cmd,\'calc\''), '"\t=cmd,\'calc\'"');
});

test('numbers stay numeric so spreadsheet math still works', () => {
  assert.equal(escapeCsvValue(-5), '-5');
  assert.equal(escapeCsvValue(-0.5), '-0.5');
  assert.equal(escapeCsvValue(42), '42');
});

test('non-finite numbers degrade to an empty field', () => {
  assert.equal(escapeCsvValue(NaN), '');
  assert.equal(escapeCsvValue(Infinity), '');
});

test('leading whitespace does not defeat the guard', () => {
  assert.equal(escapeCsvValue(' =1+1'), '\t =1+1');
});

test('toCsvRow joins escaped values', () => {
  assert.equal(toCsvRow(['a', 'b,c', 'd"e']), 'a,"b,c","d""e"');
});

test('toCsv emits a header, CRLF rows and a trailing newline', () => {
  const csv = toCsv(['day', 'clicks'], [['2026-03-01', 5], ['2026-03-02', 7]]);
  assert.equal(csv, 'day,clicks\r\n2026-03-01,5\r\n2026-03-02,7\r\n');
});

test('toCsv round-trips hostile owner text safely', () => {
  const csv = toCsv(['title'], [['Weekly "notes", updated\nwith detail']]);
  assert.equal(csv, 'title\r\n"Weekly ""notes"", updated\nwith detail"\r\n');
});

test('toCsv with no rows emits just the header', () => {
  assert.equal(toCsv(['a', 'b'], []), 'a,b\r\n');
});