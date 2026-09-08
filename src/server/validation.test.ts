// Design §4 bounds at their edges. Pure functions, no mocks needed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateNickname, validateBody, MAX_BODY_LENGTH } from './validation.js';

// --- Nickname ---

test('validateNickname: trims surrounding whitespace and accepts the trimmed value', () => {
  const result = validateNickname('  alice  ');
  assert.deepEqual(result, { ok: true, value: 'alice' });
});

test('validateNickname: rejects non-string input', () => {
  assert.deepEqual(validateNickname(42), { ok: false });
  assert.deepEqual(validateNickname(undefined), { ok: false });
  assert.deepEqual(validateNickname(null), { ok: false });
});

test('validateNickname: rejects empty after trim', () => {
  assert.deepEqual(validateNickname(''), { ok: false });
  assert.deepEqual(validateNickname('   '), { ok: false });
});

test('validateNickname: length boundary - 1 char rejected, 2 chars accepted', () => {
  assert.deepEqual(validateNickname('a'), { ok: false });
  assert.deepEqual(validateNickname('ab'), { ok: true, value: 'ab' });
});

test('validateNickname: length boundary - 24 chars accepted, 25 chars rejected', () => {
  const twentyFour = 'a'.repeat(24);
  const twentyFive = 'a'.repeat(25);
  assert.deepEqual(validateNickname(twentyFour), { ok: true, value: twentyFour });
  assert.deepEqual(validateNickname(twentyFive), { ok: false });
});

test('validateNickname: rejects a C0 control character (built from a code point, not a literal byte)', () => {
  const withSoh = 'al' + String.fromCharCode(0x01) + 'ice'; // SOH, mid-string
  const withNul = 'alice' + String.fromCharCode(0x00); // NUL, appended
  assert.deepEqual(validateNickname(withSoh), { ok: false });
  assert.deepEqual(validateNickname(withNul), { ok: false });
});

test('validateNickname: rejects a C1 control character (built from a code point, not a literal byte)', () => {
  const withNel = 'al' + String.fromCharCode(0x85) + 'ice'; // NEL, U+0080-U+009F range
  assert.deepEqual(validateNickname(withNel), { ok: false });
});

test('validateNickname: charset otherwise unrestricted (emoji, non-Latin script)', () => {
  const value = 'a' + String.fromCodePoint(0x1f642) + 'b'; // slightly-smiling-face emoji
  assert.deepEqual(validateNickname(value), { ok: true, value });
});

// --- Body ---

test('validateBody: trims and stores the trimmed value', () => {
  assert.deepEqual(validateBody('  hello  '), { ok: true, value: 'hello' });
});

test('validateBody: rejects non-string input', () => {
  assert.deepEqual(validateBody(123), { ok: false });
  assert.deepEqual(validateBody(undefined), { ok: false });
});

test('validateBody: rejects empty after trim', () => {
  assert.deepEqual(validateBody(''), { ok: false });
  assert.deepEqual(validateBody('   '), { ok: false });
});

test('validateBody: length boundary - 2000 chars accepted, 2001 rejected (checked after trim)', () => {
  const atLimit = 'x'.repeat(MAX_BODY_LENGTH);
  const overLimit = 'x'.repeat(MAX_BODY_LENGTH + 1);
  assert.deepEqual(validateBody(atLimit), { ok: true, value: atLimit });
  assert.deepEqual(validateBody(overLimit), { ok: false });
});

test('validateBody: length check applies after trim, not before', () => {
  // 2000 x's plus padding whitespace that trim() removes - must still pass.
  const padded = '  ' + 'x'.repeat(MAX_BODY_LENGTH) + '  ';
  assert.deepEqual(validateBody(padded), { ok: true, value: 'x'.repeat(MAX_BODY_LENGTH) });
});

test('validateBody: body charset is unrestricted, including control characters (design §4)', () => {
  // design §4: the body charset is deliberately unrestricted at intake -
  // escaping happens at the render boundary, not here. Distinct from the
  // nickname's control-character rejection above.
  const withNul = 'hello' + String.fromCharCode(0x00) + 'world';
  assert.deepEqual(validateBody(withNul), { ok: true, value: withNul });
});
