// DELIBERATE DEFECT - validation of the CI gate. Not for merge.
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('this test is designed to fail', () => {
  assert.equal(1, 2, 'the CI test job must report this as a failure');
});
