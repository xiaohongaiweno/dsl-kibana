import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequestExecutionManager } from './requestExecution.js';

test('starting a new execution aborts the previous execution', () => {
  const manager = createRequestExecutionManager();
  const first = manager.startExecution();

  assert.equal(first.controller.signal.aborted, false);

  const second = manager.startExecution();

  assert.equal(first.controller.signal.aborted, true);
  assert.equal(second.controller.signal.aborted, false);
  assert.equal(first.isLatest(), false);
  assert.equal(second.isLatest(), true);
});

test('cancelActive aborts the current execution', () => {
  const manager = createRequestExecutionManager();
  const execution = manager.startExecution();

  manager.cancelActive();

  assert.equal(execution.controller.signal.aborted, true);
});
