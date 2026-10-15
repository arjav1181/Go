import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeLabel,
  validateLabel,
  TAG_MAX,
  FOLDER_MAX
} from '../lib/tags/validation';

test('normalizes case and collapses whitespace', () => {
  assert.equal(normalizeLabel('  Work   Links '), 'work links');
});

test('accepts a simple tag', () => {
  const result = validateLabel('Work', TAG_MAX, 'tag');
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.name, 'work');
});

test('rejects empty label', () => {
  assert.equal(validateLabel('   ', TAG_MAX, 'tag').ok, false);
});

test('rejects over-long tag', () => {
  assert.equal(validateLabel('a'.repeat(TAG_MAX + 1), TAG_MAX, 'tag').ok, false);
});

test('accepts tag at the maximum length', () => {
  assert.equal(validateLabel('a'.repeat(TAG_MAX), TAG_MAX, 'tag').ok, true);
});

test('allows folders to be longer than tags', () => {
  const long = 'a'.repeat(TAG_MAX + 5);
  assert.equal(validateLabel(long, TAG_MAX, 'tag').ok, false);
  assert.equal(validateLabel(long, FOLDER_MAX, 'folder').ok, true);
});

test('rejects labels starting with punctuation', () => {
  assert.equal(validateLabel('-work', TAG_MAX, 'tag').ok, false);
  assert.equal(validateLabel('_work', TAG_MAX, 'tag').ok, false);
  assert.equal(validateLabel(' work'.trim().length === 0 ? '' : '!work', TAG_MAX, 'tag').ok, false);
});

test('rejects characters outside the allowed set', () => {
  assert.equal(validateLabel('work/2026', TAG_MAX, 'tag').ok, false);
  assert.equal(validateLabel('work<script>', TAG_MAX, 'tag').ok, false);
  assert.equal(validateLabel('café', TAG_MAX, 'tag').ok, false);
});

test('allows digits, spaces, hyphens and underscores after the first char', () => {
  assert.equal(validateLabel('q1 launch-notes_v2', TAG_MAX, 'tag').ok, true);
});

test('allows labels starting with a number', () => {
  assert.equal(validateLabel('2026 review', TAG_MAX, 'folder').ok, true);
});

test('error messages name the kind of label', () => {
  const tagError = validateLabel('', TAG_MAX, 'tag');
  const folderError = validateLabel('', FOLDER_MAX, 'folder');
  assert.equal(tagError.ok, false);
  assert.equal(folderError.ok, false);
  if (!tagError.ok) assert.match(tagError.error, /Tag/);
  if (!folderError.ok) assert.match(folderError.error, /Folder/);
});