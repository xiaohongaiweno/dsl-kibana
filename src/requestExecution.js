export function createRequestExecutionManager() {
  let latestExecutionId = 0;
  let activeController = null;

  function startExecution() {
    latestExecutionId += 1;

    if (activeController) {
      activeController.abort(new DOMException('Superseded by a newer request', 'AbortError'));
    }

    const executionId = latestExecutionId;
    const controller = new AbortController();
    activeController = controller;

    return {
      executionId,
      controller,
      isLatest() {
        return executionId === latestExecutionId;
      },
      release() {
        if (activeController === controller) {
          activeController = null;
        }
      },
    };
  }

  function cancelActive(reason = new DOMException('Request cancelled', 'AbortError')) {
    if (activeController) {
      activeController.abort(reason);
      activeController = null;
    }
  }

  return {
    startExecution,
    cancelActive,
    getLatestExecutionId() {
      return latestExecutionId;
    },
  };
}
