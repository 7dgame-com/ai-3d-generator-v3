import { onBeforeUnmount } from 'vue'
import { getTask, type Task } from '../api'

const timers = new Map<string, number>()
const ACTIVE_POLL_MS = 3000
const QUEUE_POLL_MS = 5000

export function useTaskPoller() {
  function schedule(taskId: string, onUpdate: (task: Task) => void, delayMs: number) {
    const timer = window.setTimeout(() => poll(taskId, onUpdate), delayMs)
    timers.set(taskId, timer)
  }

  async function poll(taskId: string, onUpdate: (task: Task) => void) {
    let task: Task
    try {
      const response = await getTask(taskId)
      task = response.data
      onUpdate(task)

      if (task.status === 'success' || task.status === 'failed' || task.status === 'timeout' || task.status === 'cancelled') {
        stopPolling(taskId)
        return
      }
    } catch {
      // A network interruption does not make a provider task terminal. Keep a slower retry so
      // the page recovers automatically when connectivity returns.
      schedule(taskId, onUpdate, QUEUE_POLL_MS)
      return
    }

    schedule(
      taskId,
      onUpdate,
      task.status === 'waiting_provider' || task.status === 'retry_wait' ? QUEUE_POLL_MS : ACTIVE_POLL_MS
    )
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
