// AC-IP-1...7, 10 (plans/gated-deploy/GATED-DEPLOY-SPECS.md §3.1). Pure
// function, no DB, no sockets — table-driven where the cases share shape,
// explicit where they don't (the trust rule and the log guards deserve
// their own named tests, not table rows).
import { test, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractClientIp,
  resetClientIpLogStateForTests,
} from './client-ip.js';

// AC-IP-10's once-per-process log guards are module-level state, so every
// test that touches logging must reset it first or tests become
// order-dependent (reviewer note on AC-IP-10) — pass in one run order,
// fail in another. Resetting before *every* test (not just logging ones)
// keeps the whole file order-independent regardless of how tests are
// reordered or filtered later.
beforeEach(() => {
  resetClientIpLogStateForTests();
});

// --- AC-IP-1: trusted peer, single XFF value ---

test('AC-IP-1: trusted peer + single XFF value returns the XFF value', () => {
  const result = extractClientIp('127.0.0.1', '203.0.113.9');
  assert.equal(result, '203.0.113.9');
});

// --- AC-IP-2: trusted peer, chained XFF - last value wins ---

test('AC-IP-2: trusted peer + chained XFF returns the LAST value, not the first', () => {
  const result = extractClientIp('127.0.0.1', '1.2.3.4, 203.0.113.9');
  assert.equal(result, '203.0.113.9');
});

test('AC-IP-2b: trailing whitespace around the last chained value is trimmed', () => {
  const result = extractClientIp('127.0.0.1', '1.2.3.4,   203.0.113.9   ');
  assert.equal(result, '203.0.113.9');
});

// --- AC-IP-3: the security case - untrusted peer, header ignored ---

test('AC-IP-3: untrusted peer + XFF present returns the PEER, header is ignored entirely', () => {
  const result = extractClientIp('203.0.113.50', '1.2.3.4');
  assert.equal(result, '203.0.113.50');
});

test('AC-IP-3b: untrusted peer + a chained XFF is still fully ignored (not even the last value leaks through)', () => {
  const result = extractClientIp('203.0.113.50', '1.2.3.4, 5.6.7.8, 9.9.9.9');
  assert.equal(result, '203.0.113.50');
});

// --- AC-IP-4: the IPv4-mapped loopback form must be trusted ---

test('AC-IP-4: ::ffff:127.0.0.1 (dual-stack loopback form) is trusted like 127.0.0.1', () => {
  const result = extractClientIp('::ffff:127.0.0.1', '203.0.113.9');
  assert.equal(result, '203.0.113.9');
});

test('AC-IP-4b: ::1 (IPv6 loopback) is also trusted', () => {
  const result = extractClientIp('::1', '203.0.113.9');
  assert.equal(result, '203.0.113.9');
});

// --- AC-IP-5: trusted peer, header absent - falls back to peer ---

test('AC-IP-5: trusted peer + header absent returns the peer', () => {
  const result = extractClientIp('127.0.0.1', undefined);
  assert.equal(result, '127.0.0.1');
});

// --- AC-IP-6: trusted peer, malformed header - never the malformed string ---

test('AC-IP-6: trusted peer + malformed XFF returns the peer, never the malformed string', () => {
  const result = extractClientIp('127.0.0.1', 'not-an-ip');
  assert.equal(result, '127.0.0.1');
});

test('AC-IP-6b: trusted peer + empty-string XFF returns the peer', () => {
  const result = extractClientIp('127.0.0.1', '');
  assert.equal(result, '127.0.0.1');
});

test('AC-IP-6c: trusted peer + chained XFF whose last value is malformed returns the peer, not the malformed tail', () => {
  const result = extractClientIp('127.0.0.1', '203.0.113.9, not-an-ip');
  assert.equal(result, '127.0.0.1');
});

// --- AC-IP-7: no peer, no header - undefined (column is nullable) ---

test('AC-IP-7: remoteAddress undefined + no header returns undefined', () => {
  const result = extractClientIp(undefined, undefined);
  assert.equal(result, undefined);
});

test('AC-IP-7b: remoteAddress undefined + header present still returns undefined (undefined peer is never "trusted")', () => {
  const result = extractClientIp(undefined, '203.0.113.9');
  assert.equal(result, undefined);
});

// --- Additional edge cases named in the plan's "Notes (traps)" and arch-notes §1.8 ---

test('array-form X-Forwarded-For (repeated header) takes the last comma-separated value across all elements', () => {
  const result = extractClientIp('127.0.0.1', ['1.2.3.4', '203.0.113.9']);
  assert.equal(result, '203.0.113.9');
});

test('empty-array X-Forwarded-For is treated as absent, not as a value to parse', () => {
  const result = extractClientIp('127.0.0.1', []);
  assert.equal(result, '127.0.0.1');
});

test('IPv6 XFF value validates and is returned', () => {
  const result = extractClientIp('127.0.0.1', '2001:db8::1');
  assert.equal(result, '2001:db8::1');
});

// --- The trust rule itself, proven both ways ---
//
// A green suite is not evidence the suite checks anything. This test
// fails the moment the trust direction is inverted (leftmost trusted
// instead of rightmost, or untrusted peers honored) because it asserts
// the concrete value the plan calls "the security case" — not merely that
// *a* string came back.
test('trust rule: rightmost XFF value wins under a trusted peer, and untrusted peers never leak any XFF value', () => {
  // Rightmost, not leftmost.
  assert.equal(extractClientIp('127.0.0.1', 'attacker-controlled-1.1.1.1, 9.9.9.9'), '9.9.9.9');
  // Untrusted peer: the header is attacker-supplied end to end and must
  // never surface, regardless of how well-formed it looks.
  assert.equal(extractClientIp('198.51.100.1', '9.9.9.9'), '198.51.100.1');
});

// --- AC-IP-10: each of the 3 log conditions fires at most once per process ---

test('AC-IP-10a: "trusted peer, header absent" warns exactly once across repeated connections', () => {
  const warnCalls: unknown[][] = [];
  const restore = mock.method(console, 'warn', (...args: unknown[]) => {
    warnCalls.push(args);
  });
  try {
    extractClientIp('127.0.0.1', undefined);
    extractClientIp('127.0.0.1', undefined);
    extractClientIp('127.0.0.1', undefined);
  } finally {
    restore.mock.restore();
  }
  assert.equal(warnCalls.length, 1);
});

test('AC-IP-10b: "untrusted peer" warns exactly once across repeated connections', () => {
  const warnCalls: unknown[][] = [];
  const restore = mock.method(console, 'warn', (...args: unknown[]) => {
    warnCalls.push(args);
  });
  try {
    extractClientIp('203.0.113.50', '1.2.3.4');
    extractClientIp('203.0.113.50', '1.2.3.4');
  } finally {
    restore.mock.restore();
  }
  assert.equal(warnCalls.length, 1);
});

test('AC-IP-10c: the two warn conditions are tracked independently, not by one shared guard', () => {
  const warnCalls: unknown[][] = [];
  const restore = mock.method(console, 'warn', (...args: unknown[]) => {
    warnCalls.push(args);
  });
  try {
    extractClientIp('127.0.0.1', undefined); // condition a
    extractClientIp('203.0.113.50', '1.2.3.4'); // condition b
  } finally {
    restore.mock.restore();
  }
  assert.equal(warnCalls.length, 2);
});

test('AC-IP-10d: first-resolution info line logs exactly once per process regardless of source mix', () => {
  const infoCalls: unknown[][] = [];
  const restore = mock.method(console, 'info', (...args: unknown[]) => {
    infoCalls.push(args);
  });
  try {
    extractClientIp('127.0.0.1', '203.0.113.9'); // resolves via xff
    extractClientIp('203.0.113.50', '1.2.3.4'); // resolves via peer
    extractClientIp('127.0.0.1', undefined); // resolves via peer
  } finally {
    restore.mock.restore();
  }
  assert.equal(infoCalls.length, 1);
});

test('AC-IP-10e: resetClientIpLogStateForTests() re-arms all three guards for the next test', () => {
  const warnCalls: unknown[][] = [];
  const infoCalls: unknown[][] = [];
  const restoreWarn = mock.method(console, 'warn', (...args: unknown[]) => {
    warnCalls.push(args);
  });
  const restoreInfo = mock.method(console, 'info', (...args: unknown[]) => {
    infoCalls.push(args);
  });
  try {
    extractClientIp('127.0.0.1', undefined);
    resetClientIpLogStateForTests();
    extractClientIp('127.0.0.1', undefined);
  } finally {
    restoreWarn.mock.restore();
    restoreInfo.mock.restore();
  }
  assert.equal(warnCalls.length, 2);
  assert.equal(infoCalls.length, 2);
});
