import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequestExecutionManager } from './requestExecution.js';

/**
 * 功能：
 * 验证当启动第二次执行时，第一次执行会被自动中断。
 *
 * 实现：
 * 先创建执行管理器并启动第一次执行，再启动第二次执行，
 * 最后断言第一次的 signal 已被中断、第二次未被中断，并且最新执行标记正确。
 *
 * 输入：
 * - 测试名称字符串。
 * - 测试回调函数；当前用例不依赖外部参数。
 *
 * 输出：
 * - 无；通过断言结果判断测试是否成功。
 */
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

/**
 * 功能：
 * 验证调用 `cancelActive()` 时会中断当前活动执行。
 *
 * 实现：
 * 启动一次执行后立刻调用取消接口，再断言该执行持有的 signal 已处于中断状态。
 *
 * 输入：
 * - 测试名称字符串。
 * - 测试回调函数；当前用例不依赖外部参数。
 *
 * 输出：
 * - 无；通过断言结果判断测试是否成功。
 */
test('cancelActive aborts the current execution', () => {
  const manager = createRequestExecutionManager();
  const execution = manager.startExecution();

  manager.cancelActive();

  assert.equal(execution.controller.signal.aborted, true);
});
