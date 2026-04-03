import { onBeforeUnmount } from 'vue'
import { getTask, type Task } from '../api'

const timers = new Map<string, number>()

export function useTaskPoller() {
  async function poll(taskId: string, onUpdate: (task: Task) => void) {
    try {
      const response = await getTask(taskId)
      const task = response.data
      onUpdate(task)

      if (task.status === 'success' || task.status === 'failed' || task.status === 'timeout') {
        stopPolling(taskId)
        return
      }
    } catch {
      stopPolling(taskId)
      return
    }

    const timer = window.setTimeout(() => poll(taskId, onUpdate), 3000)
    timers.set(taskId, timer)
  }

  function startPolling(taskId: string, onUpdate: (task: Task) => void) {
    stopPolling(taskId)
    void poll(taskId, onUpdate)
  }

  function stopPolling(taskId: string) {
    const timer = timers.get(taskId)
    if (timer) {
      window.clearTimeout(timer)
      timers.delete(taskId)
    }
  }

  function stopAllPolling() {
    for (const timer of timers.values()) {
      window.clearTimeout(timer)
    }
    timers.clear()
  }

  onBeforeUnmount(() => {
    stopAllPolling()
  })

  return {
    startPolling,
    stopPolling,
    stopAllPolling,
  }
}
