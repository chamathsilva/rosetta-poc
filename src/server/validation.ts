// Message send and nickname validation bounds — design §4, "Message send
// validation". Decided values, not offered as options. Extracted into its
// own module (rather than inlined at each call site) so the bounds are
// unit-testable without a live socket or database
// (PLAN "Test scope": src/server/validation.test.ts) and shared between
// `POST /api/join` (nickname) and the WS send path (body) — "same routine
// class" per the design.

const MIN_NICKNAME_LENGTH = 2;
const MAX_NICKNAME_LENGTH = 24;
export const MAX_BODY_LENGTH = 2000;

// C0 (U+0000-U+001F, U+007F) and C1 (U+0080-U+009F) control characters.
// Nickname only - the design deliberately leaves the message body charset
// unrestricted (escaping happens at the render boundary, not at intake).
// Built from a RegExp(string) with \u escapes, rather than a literal
// character class, so no literal control byte lives in this source file.
const CONTROL_CHAR_RE = new RegExp('[\\u0000-\\u001F\\u007F-\\u009F]');

export type ValidationResult =
  | { readonly ok: true; readonly value: string }
  | { readonly ok: false };

/** Trim; reject empty, `length < 2`, `length > 24`, or any C0/C1 control
 * character. Charset is otherwise unrestricted. */
export function validateNickname(raw: unknown): ValidationResult {
  if (typeof raw !== 'string') return { ok: false };
  const value = raw.trim();
  if (value.length < MIN_NICKNAME_LENGTH || value.length > MAX_NICKNAME_LENGTH) {
    return { ok: false };
  }
  if (CONTROL_CHAR_RE.test(value)) return { ok: false };
  return { ok: true, value };
}

/** Reject when not a string or `trim().length === 0`; store the trimmed
 * value. Max length 2000 chars, checked after trim. */
export function validateBody(raw: unknown): ValidationResult {
  if (typeof raw !== 'string') return { ok: false };
  const value = raw.trim();
  if (value.length === 0 || value.length > MAX_BODY_LENGTH) return { ok: false };
  return { ok: true, value };
}
