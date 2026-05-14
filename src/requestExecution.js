export function createRequestExecutionManager() {
  let latestExecutionId = 0;
  let activeController = null;

  /**
   * 功能：
   * 启动一次新的请求执行，并把它标记为当前唯一有效的执行上下文。
   *
   * 实现：
   * 每调用一次都会递增 `latestExecutionId`。
   * 如果之前已经存在活动请求，则立即通过旧的 `AbortController` 中断它，
   * 以确保界面始终只保留最新一次请求的结果资格。
   * 随后为本次执行创建新的控制器，并返回一个带辅助方法的执行对象。
   *
   * 输入：
   * - 无。
   *
   * 输出：
   * - 返回一个执行对象，包含：
   *   - `executionId`：本次执行编号。
   *   - `controller`：本次执行对应的 `AbortController`。
   *   - `isLatest()`：判断本次执行是否仍是最新执行。
   *   - `release()`：在执行完成后尝试释放活动控制器引用。
   */
  function startExecution() {
    latestExecutionId += 1;

    // The UI only presents one response at a time, so a newer execution always wins.
    if (activeController) {
      activeController.abort(new DOMException('Superseded by a newer request', 'AbortError'));
    }

    const executionId = latestExecutionId;
    const controller = new AbortController();
    activeController = controller;

    return {
      executionId,
      controller,
      /**
       * 功能：
       * 判断当前执行对象是否仍然代表“最新一次请求”。
       *
       * 实现：
       * 比较本次执行创建时捕获的 `executionId` 与闭包里当前的 `latestExecutionId`。
       *
       * 输入：
       * - 无。
       *
       * 输出：
       * - 返回布尔值；`true` 表示该执行仍可安全更新界面。
       */
      isLatest() {
        return executionId === latestExecutionId;
      },
      /**
       * 功能：
       * 在请求生命周期结束后释放当前执行占用的活动控制器引用。
       *
       * 实现：
       * 只有当闭包里的 `activeController` 仍然等于本次执行持有的控制器时，
       * 才会把它置空，避免误清理后面更新请求创建的控制器。
       *
       * 输入：
       * - 无。
       *
       * 输出：
       * - 无；副作用是可能修改 `activeController`。
       */
      release() {
        if (activeController === controller) {
          activeController = null;
        }
      },
    };
  }

  /**
   * 功能：
   * 主动取消当前活动请求。
   *
   * 实现：
   * 如果当前存在 `activeController`，则调用其 `abort()` 中断请求，
   * 并在中断后把活动控制器引用清空。
   *
   * 输入：
   * - `reason`：可选的中断原因对象，默认是 `Request cancelled` 对应的 `AbortError`。
   *
   * 输出：
   * - 无；副作用是中断当前活动请求。
   */
  function cancelActive(reason = new DOMException('Request cancelled', 'AbortError')) {
    if (activeController) {
      activeController.abort(reason);
      activeController = null;
    }
  }

  return {
    startExecution,
    cancelActive,
    /**
     * 功能：
     * 读取当前最新执行编号。
     *
     * 实现：
     * 直接返回闭包中维护的 `latestExecutionId`，不做任何额外计算。
     *
     * 输入：
     * - 无。
     *
     * 输出：
     * - 返回数字类型的最新执行编号。
     */
    getLatestExecutionId() {
      return latestExecutionId;
    },
  };
}
