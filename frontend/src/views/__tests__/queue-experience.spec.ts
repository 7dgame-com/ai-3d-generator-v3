import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const source = fs.readFileSync(path.resolve(__dirname, '..', 'GeneratorView.vue'), 'utf8')

describe('P1 queue experience', () => {
  it('uses the server 202 queue status and position for optimistic cards', () => {
    expect(source).toContain('status: response.status')
    expect(source).toContain('queuePosition: response.queuePosition')
    expect(source).toContain('directModeTask: false')
  })

  it('shows a retry countdown, safe category message, and cancellation action', () => {
    expect(source).toContain("t('generator.retryingAt'")
    expect(source).toContain('formatRetryTime(task.nextAttemptAt)')
    expect(source).toContain('taskErrorMessage(task)')
    expect(source).toContain('cancelQueuedTask(task.taskId)')
  })

  it('keeps polling non-terminal tasks after a page reload', () => {
    expect(source).toContain("!['success', 'failed', 'timeout', 'cancelled'].includes(task.status)")
    expect(source).toContain('startPolling(task.taskId, updateTask)')
  })
})
