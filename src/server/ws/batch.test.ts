// The BATCH merge: normalization, dedup, and (createdAt, id) ordering,
// including the 31-80/1-30 case that motivated building one ordered batch
// server-side instead of trusting dedup alone (design, "Fix — build one
// ordered initial batch server-side"). PLAN "Test scope":
// src/server/ws/batch.test.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildBatch } from './connection.js';
import type { MessageRow } from '../../db/queries/messages.js';
import type { MessageFrame, ErrorFrame } from '../../shared/protocol.js';

function row(id: string, isoTime: string, body = 'hi'): MessageRow {
  return {
    id,
    author_nickname: 'alice',
    body,
    created_at: new Date(isoTime),
  };
}

function messageFrame(id: string, createdAt: string, body = 'hi'): string {
  const frame: MessageFrame = { type: 'message', id, nickname: 'bob', body, createdAt };
  return JSON.stringify(frame);
}

// --- Normalization ---

test('buildBatch: normalizes DB row shape (author_nickname, created_at) to wire shape (nickname, createdAt)', () => {
  const { history } = buildBatch([row('1', '2026-01-01T00:00:00.000Z', 'hello')], []);
  assert.deepEqual(history, [
    { id: '1', nickname: 'alice', body: 'hello', createdAt: '2026-01-01T00:00:00.000Z' },
  ]);
});

test('buildBatch: empty history and empty buffer produces an empty batch', () => {
  const { history, extras } = buildBatch([], []);
  assert.deepEqual(history, []);
  assert.deepEqual(extras, []);
});

// --- Ordering ---

test('buildBatch: sorts ascending by createdAt regardless of input (DESC) order', () => {
  // QUERY returns created_at DESC - buildBatch must reverse the effective
  // order without the caller pre-reversing anything.
  const rows = [
    row('3', '2026-01-01T00:00:03.000Z'),
    row('2', '2026-01-01T00:00:02.000Z'),
    row('1', '2026-01-01T00:00:01.000Z'),
  ];
  const { history } = buildBatch(rows, []);
  assert.deepEqual(
    history.map((m) => m.id),
    ['1', '2', '3'],
  );
});

test('buildBatch: id is the tie-breaker when createdAt ties', () => {
  const tie = '2026-01-01T00:00:00.000Z';
  const rows = [row('b', tie), row('a', tie), row('c', tie)];
  const { history } = buildBatch(rows, []);
  assert.deepEqual(
    history.map((m) => m.id),
    ['a', 'b', 'c'],
  );
});

// --- Dedup ---

test('buildBatch: a message present in both history and the buffer is deduped by id, not doubled', () => {
  const createdAt = '2026-01-01T00:00:05.000Z';
  const rows = [row('m1', createdAt, 'from history')];
  const buffered = [messageFrame('m1', createdAt, 'from buffer')];
  const { history } = buildBatch(rows, buffered);
  assert.equal(history.length, 1);
  assert.equal(history[0]?.id, 'm1');
});

test('buildBatch: the classic 31-80 / 1-30 case - a full window of concurrent history plus buffer merges into one correctly ordered, deduped batch', () => {
  // Design's own motivating example: 80 messages arrive during the history
  // query; the snapshot (QUERY, LIMIT 50) returns the newest 50 (ids
  // 31-80); the buffer independently accumulated broadcasts for messages
  // that committed after JOIN, which - under ordinary load - is exactly
  // the same tail the snapshot also captured (ids 31-80 again, as live
  // broadcasts), NOT ids 1-30 (dedup does not fabricate missing rows).
  // Without server-side batching, flushing the buffer after the
  // (unsorted) history would append duplicates or misorder the tail.
  const base = Date.parse('2026-01-01T00:00:00.000Z');
  const historyRows: MessageRow[] = [];
  for (let i = 31; i <= 80; i++) {
    historyRows.push(row(String(i), new Date(base + i * 1000).toISOString()));
  }
  // created_at DESC, as QUERY returns it.
  historyRows.reverse();

  // The buffer independently saw the same live broadcasts for 31-80 (ids
  // committed after this socket's JOIN, before the QUERY snapshot).
  const buffered = historyRows
    .slice()
    .reverse()
    .map((r) => messageFrame(r.id, r.created_at.toISOString()));

  const { history } = buildBatch(historyRows, buffered);

  // Exactly once each, in ascending order, ids 31..80 - not 111 entries,
  // not out of order.
  assert.equal(history.length, 50);
  assert.deepEqual(
    history.map((m) => m.id),
    Array.from({ length: 50 }, (_, i) => String(i + 31)),
  );
  for (let i = 1; i < history.length; i++) {
    const prev = history[i - 1];
    const curr = history[i];
    assert.ok(prev !== undefined && curr !== undefined);
    assert.ok(prev.createdAt <= curr.createdAt);
  }
});

// --- Partitioning non-message frames ---

test('buildBatch: partitions a buffered error frame out of the history merge, preserving buffer order', () => {
  const errorFrame: ErrorFrame = { type: 'error', code: 'invalid_body' };
  const buffered = [
    messageFrame('1', '2026-01-01T00:00:01.000Z'),
    JSON.stringify(errorFrame),
    messageFrame('2', '2026-01-01T00:00:02.000Z'),
  ];
  const { history, extras } = buildBatch([], buffered);

  assert.deepEqual(
    history.map((m) => m.id),
    ['1', '2'],
  );
  assert.deepEqual(extras, [JSON.stringify(errorFrame)]);
});

test('buildBatch: multiple buffered error frames keep their relative order in extras', () => {
  const e1: ErrorFrame = { type: 'error', code: 'invalid_body' };
  const e2: ErrorFrame = { type: 'error', code: 'send_failed' };
  const buffered = [JSON.stringify(e1), JSON.stringify(e2)];
  const { extras } = buildBatch([], buffered);
  assert.deepEqual(extras, [JSON.stringify(e1), JSON.stringify(e2)]);
});

test('buildBatch: unparseable JSON in the buffer is dropped, not thrown', () => {
  assert.doesNotThrow(() => {
    const { history, extras } = buildBatch([], ['not json{{{']);
    assert.deepEqual(history, []);
    assert.deepEqual(extras, []);
  });
});

test('buildBatch: a malformed buffered "message" frame (missing field) is dropped rather than corrupting the sort', () => {
  const malformed = JSON.stringify({ type: 'message', id: '1' }); // missing nickname/body/createdAt
  const { history } = buildBatch([], [malformed]);
  assert.deepEqual(history, []);
});
