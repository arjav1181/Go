import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shouldTriggerCreateShortcut } from '../lib/shortcuts/create-link';

test('plain n triggers the shortcut', () => {
  assert.equal(shouldTriggerCreateShortcut({ key: 'n', target: null }), true);
});

test('uppercase N also triggers', () => {
  assert.equal(shouldTriggerCreateShortcut({ key: 'N', target: null }), true);
});

test('other keys do not trigger', () => {
  for (const key of ['a', 'm', 'Enter', 'Escape', 'Tab', ' ', 'Numpad1']) {
    assert.equal(shouldTriggerCreateShortcut({ key, target: null }), false, `key ${key}`);
  }
});

test('does not trigger while typing in an input', () => {
  const result = shouldTriggerCreateShortcut({ key: 'n', target: { tagName: 'INPUT' } });
  assert.equal(result, false);
});

test('does not trigger while typing in a textarea', () => {
  assert.equal(shouldTriggerCreateShortcut({ key: 'n', target: { tagName: 'TEXTAREA' } }), false);
});

test('does not trigger while a select is focused', () => {
  assert.equal(shouldTriggerCreateShortcut({ key: 'n', target: { tagName: 'SELECT' } }), false);
});

test('does not trigger in contenteditable regions', () => {
  assert.equal(
    shouldTriggerCreateShortcut({ key: 'n', target: { tagName: 'DIV', isContentEditable: true } }),
    false
  );
});

test('tagName matching is case-insensitive', () => {
  assert.equal(shouldTriggerCreateShortcut({ key: 'n', target: { tagName: 'input' } }), false);
  assert.equal(shouldTriggerCreateShortcut({ key: 'n', target: { tagName: 'TextArea' } }), false);
});

test('triggers on non-editable elements such as body or buttons', () => {
  assert.equal(shouldTriggerCreateShortcut({ key: 'n', target: { tagName: 'BODY' } }), true);
  assert.equal(shouldTriggerCreateShortcut({ key: 'n', target: { tagName: 'BUTTON' } }), true);
  assert.equal(shouldTriggerCreateShortcut({ key: 'n', target: { tagName: 'A' } }), true);
});

test('modifier combinations are left to the browser', () => {
  assert.equal(shouldTriggerCreateShortcut({ key: 'n', metaKey: true, target: null }), false);
  assert.equal(shouldTriggerCreateShortcut({ key: 'n', ctrlKey: true, target: null }), false);
  assert.equal(shouldTriggerCreateShortcut({ key: 'n', altKey: true, target: null }), false);
});

test('shift+n still triggers (shift is allowed)', () => {
  assert.equal(shouldTriggerCreateShortcut({ key: 'N', metaKey: false, target: null }), true);
});

test('an already-handled event is ignored', () => {
  assert.equal(shouldTriggerCreateShortcut({ key: 'n', defaultPrevented: true, target: null }), false);
});

test('non-object targets are tolerated', () => {
  assert.equal(shouldTriggerCreateShortcut({ key: 'n', target: undefined }), true);
  assert.equal(shouldTriggerCreateShortcut({ key: 'n', target: 'window' }), true);
});

test('element without tagName does not block the shortcut', () => {
  assert.equal(shouldTriggerCreateShortcut({ key: 'n', target: {} }), true);
});