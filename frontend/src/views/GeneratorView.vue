<template>
  <div class="page">
    <section class="panel">
      <div class="panel-head">
        <h2>{{ t('generator.title') }}</h2>
        <el-select v-model="selectedProvider" placeholder="Provider" style="width: 200px">
          <el-option v-for="provider in providers" :key="provider" :label="provider" :value="provider" />
        </el-select>
      </div>

      <el-tabs v-model="mode">
        <el-tab-pane :label="t('generator.textTab')" name="text">
          <el-input v-model="prompt" type="textarea" :rows="4" :maxlength="500" show-word-limit />
          <div class="actions">
            <el-button type="primary" :disabled="!can('generate-model') || !prompt.trim()" :loading="submitting" @click="submitText">
              {{ t('generator.submit') }}
            </el-button>
          </div>
        </el-tab-pane>
        <el-tab-pane :label="t('generator.imageTab')" name="image">
          <input type="file" accept="image/png,image/jpeg,image/webp" @change="handleImageChange" />
          <div class="actions">
            <el-button type="primary" :disabled="!can('generate-model') || !imageBase64" :loading="submitting" @click="submitImage">
              {{ t('generator.submit') }}
            </el-button>
          </div>
        </el-tab-pane>
      </el-tabs>
    </section>

    <section class="panel">
      <div class="panel-head">
        <h2>{{ t('generator.tasks') }}</h2>
        <el-button text @click="loadTasks">{{ t('common.refresh') }}</el-button>
      </div>

      <el-empty v-if="tasks.length === 0" :description="t('generator.empty')" />
      <div v-else class="task-list">
        <article v-for="task in tasks" :key="task.taskId" class="task-card">
          <div class="task-card-body">
            <div class="task-thumbnail-shell">
              <img
                v-if="shouldShowThumbnail(task)"
                :src="thumbnailBlobUrls[task.taskId]"
                :data-test="`task-thumbnail-${task.taskId}`"
                class="task-thumbnail-image"
                @error="handleThumbnailError(task.taskId)"
              />
              <div
                v-else
                :data-test="`task-thumbnail-placeholder-${task.taskId}`"
                class="task-thumbnail-placeholder"
                aria-hidden="true"
              >
                <span class="task-thumbnail-placeholder-label">3D</span>
              </div>
            </div>

            <div class="task-content">
              <div class="task-top">
                <strong>{{ t(`generator.typeLabel.${task.type}`, task.type) }}</strong>
                <el-tag>{{ task.status }}</el-tag>
              </div>
              <p>{{ task.prompt || task.taskId }}</p>
              <div class="task-meta">
                <el-tag v-if="task.providerId" size="small" type="info">
                  {{ providerLabel(task.providerId) }}
                </el-tag>
                <span v-if="task.creditCost > 0" class="meta-item">
                  {{ t('generator.credits', { n: task.creditCost }) }}
                </span>
                <span v-if="task.createdAt" class="meta-item">
                  {{ formatDateTime(task.createdAt) }}
                </span>
                <span v-if="task.createdAt && task.completedAt" class="meta-item">
                  {{ formatTaskDuration(task.createdAt, task.completedAt) }}
                </span>
              </div>
              <el-progress v-if="task.status === 'processing'" :percentage="task.progress" />
              <div class="actions">
                <el-button v-if="task.status === 'success' && !task.downloadExpired && can('download-model')" @click="download(task.taskId)">
                  {{ t('generator.download') }}
                </el-button>
                <el-button
                  v-if="task.status === 'success' && !task.downloadExpired && !task.resourceId && can('upload-to-main')"
                  :loading="uploadingTaskId === task.taskId"
                  @click="upload(task.taskId, task.prompt)"
                >
                  {{ t('generator.upload') }}
                </el-button>
                <el-tag v-if="task.downloadExpired" type="info" size="small">{{ t('generator.expired') }}</el-tag>
                <span v-if="task.resourceId">Resource #{{ task.resourceId }}</span>
              </div>
            </div>
          </div>
        </article>
      </div>
    </section>
  </div>

  <CreditDialog
    :visible="showCreditDialog"
    :is-admin="isAdmin"
    @update:visible="closeDialog"
    @go-admin="goToAdmin"
  />
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { createTask, downloadTaskFile, fetchThumbnailBlob, getEnabledProviders, listTasks, type Task } from '../api'
import CreditDialog from '../components/CreditDialog.vue'
import { useCreditCheck } from '../composables/useCreditCheck'
import { usePermissions } from '../composables/usePermissions'
import { useTaskPoller } from '../composables/useTaskPoller'
import { useUploadService } from '../composables/useUploadService'
import { useI18n } from 'vue-i18n'
import type { AxiosError } from 'axios'
import { useRouter } from 'vue-router'
import { formatDuration, formatDateTime as formatDateTimeUtil, providerLabel } from './generatorTaskMeta'

const { t, locale } = useI18n()
const router = useRouter()
const { can, fetchAllowedActions } = usePermissions()
const { showCreditDialog, isAdmin, checkCredits, triggerDialog, closeDialog } = useCreditCheck()
const { startPolling, stopAllPolling } = useTaskPoller()
const { uploadToMain } = useUploadService()

const mode = ref<'text' | 'image'>('text')
const prompt = ref('')
const imageBase64 = ref<string | null>(null)
const imageMimeType = ref<string>('image/png')
const submitting = ref(false)
const providers = ref<string[]>([])
const selectedProvider = ref('tripo3d')
const tasks = ref<Task[]>([])
const uploadingTaskId = ref<string | null>(null)
const brokenThumbnailTaskIds = ref<Record<string, boolean>>({})
const thumbnailBlobUrls = ref<Record<string, string>>({})

// ── 平滑进度插值 ──
const smoothProgress = ref<Record<string, number>>({})
const targetProgressMap = new Map<string, number>()
let tweenTimer: number | null = null
const TWEEN_MS = 200
const CREEP = 0.5   // 没有新目标时每 tick 缓慢前进
const MAX_SMOOTH = 95

function ensureTween() {
  if (tweenTimer !== null) return
  tweenTimer = window.setInterval(() => {
    const next = { ...smoothProgress.value }
    let changed = false
    for (const [id, target] of targetProgressMap) {
      const cur = next[id] ?? 0
      let val: number
      if (cur < target) {
        val = cur + Math.max((target - cur) * 0.25, 0.5)
        if (val > target) val = target
      } else {
        val = cur + CREEP
      }
      val = Math.min(val, MAX_SMOOTH)
      if (Math.round(val) !== Math.round(cur)) {
        next[id] = val
        changed = true
      }
    }
    if (changed) smoothProgress.value = next
  }, TWEEN_MS)
}

function setProgressTarget(taskId: string, progress: number) {
  targetProgressMap.set(taskId, progress)
  if (!(taskId in smoothProgress.value)) {
    smoothProgress.value = { ...smoothProgress.value, [taskId]: 0 }
  }
  ensureTween()
}

function clearProgressTarget(taskId: string) {
  targetProgressMap.delete(taskId)
  const next = { ...smoothProgress.value }
  delete next[taskId]
  smoothProgress.value = next
  if (targetProgressMap.size === 0 && tweenTimer !== null) {
    window.clearInterval(tweenTimer)
    tweenTimer = null
  }
}

function getDisplayProgress(taskId: string, serverProgress: number): number {
  return Math.round(smoothProgress.value[taskId] ?? serverProgress)
}

onBeforeUnmount(() => {
  stopAllPolling()
  if (tweenTimer !== null) { window.clearInterval(tweenTimer); tweenTimer = null }
  // 释放所有 blob URL
  Object.values(thumbnailBlobUrls.value).forEach((url) => URL.revokeObjectURL(url))
})
/** Map backend error codes to i18n keys */
function getErrorMessage(error: unknown): string {
  const axiosErr = error as AxiosError<{ code?: string; message?: string }>
  const code = axiosErr?.response?.data?.code
  if (typeof code === 'string' && t(`errors.${code}`) !== `errors.${code}`) {
    return t(`errors.${code}`)
  }
  return t('errors.createTaskFailed')
}

function isInsufficientCreditsError(error: unknown): boolean {
  const axiosErr = error as AxiosError<{ code?: string }>
  return axiosErr?.response?.data?.code === 'INSUFFICIENT_CREDITS'
}

onMounted(async () => {
  await fetchAllowedActions()
  await loadProviders()
  await loadTasks()
  await checkCredits()
})

async function loadProviders() {
  const response = await getEnabledProviders()
  providers.value = response.data.providers ?? []
  if (providers.value.length > 0) {
    selectedProvider.value = providers.value[0]
  }
}

async function loadTasks() {
  const response = await listTasks()
  tasks.value = (response.data.data ?? []).map((task) => normalizeTask(task))
  tasks.value.forEach((task) => {
    if (task.status === 'queued' || task.status === 'processing') {
      startPolling(task.taskId, updateTask)
    }
  })
}

function updateTask(task: Task) {
  const index = tasks.value.findIndex((item) => item.taskId === task.taskId)
  if (index >= 0) {
    const previousTask = tasks.value[index]
    if (task.status === 'queued' || task.status === 'processing') {
      setProgressTarget(task.taskId, task.progress ?? 0)
    } else {
      clearProgressTarget(task.taskId)
    }

    const becameSuccessful =
      (previousTask.status === 'queued' || previousTask.status === 'processing') && task.status === 'success'
    if (becameSuccessful && thumbnailBlobUrls.value[task.taskId]) {
      URL.revokeObjectURL(thumbnailBlobUrls.value[task.taskId])
      const nextBlobUrls = { ...thumbnailBlobUrls.value }
      delete nextBlobUrls[task.taskId]
      thumbnailBlobUrls.value = nextBlobUrls
    }

    tasks.value[index] = normalizeTask(task)
  }
}

function normalizeTask(task: Task): Task {
  if (brokenThumbnailTaskIds.value[task.taskId]) {
    const nextBroken = { ...brokenThumbnailTaskIds.value }
    delete nextBroken[task.taskId]
    brokenThumbnailTaskIds.value = nextBroken
  }

  const normalized = {
    ...task,
    thumbnailUrl: task.thumbnailUrl ?? null,
    thumbnailExpired: task.thumbnailExpired ?? false,
  }

  // 异步加载缩略图 blob URL
  if (
    normalized.status === 'success' &&
    normalized.thumbnailUrl &&
    !normalized.thumbnailExpired &&
    !thumbnailBlobUrls.value[task.taskId]
  ) {
    loadThumbnail(task.taskId)
  }

  return normalized
}

async function loadThumbnail(taskId: string) {
  try {
    const response = await fetchThumbnailBlob(taskId)
    const blobUrl = URL.createObjectURL(response.data)
    thumbnailBlobUrls.value = { ...thumbnailBlobUrls.value, [taskId]: blobUrl }
  } catch {
    brokenThumbnailTaskIds.value = { ...brokenThumbnailTaskIds.value, [taskId]: true }
  }
}

function shouldShowThumbnail(task: Task): boolean {
  return Boolean(thumbnailBlobUrls.value[task.taskId] && !brokenThumbnailTaskIds.value[task.taskId])
}

function handleThumbnailError(taskId: string) {
  brokenThumbnailTaskIds.value = {
    ...brokenThumbnailTaskIds.value,
    [taskId]: true,
  }
}

function formatTaskDuration(start: string, end: string): string {
  return formatDuration(start, end, String(locale.value))
}

function formatDateTime(isoString: string): string {
  return formatDateTimeUtil(isoString, String(locale.value))
}

function goToAdmin() {
  router.push('/admin')
  closeDialog()
}

async function submitText() {
  submitting.value = true
  try {
    const response = await createTask({
      type: 'text_to_model',
      prompt: prompt.value,
      provider_id: selectedProvider.value,
    })
    tasks.value.unshift({
      taskId: response.data.taskId,
      providerId: selectedProvider.value,
      type: 'text_to_model',
      prompt: prompt.value,
      status: response.data.status,
      progress: 0,
      creditCost: 0,
      outputUrl: null,
      thumbnailUrl: null,
      thumbnailExpired: false,
      resourceId: null,
      errorMessage: null,
      createdAt: new Date().toISOString(),
      completedAt: null,
      downloadExpired: false,
    })
    startPolling(response.data.taskId, updateTask)
    prompt.value = ''
  } catch (error) {
    if (isInsufficientCreditsError(error)) {
      triggerDialog()
    } else {
      ElMessage.error(getErrorMessage(error))
    }
  } finally {
    submitting.value = false
  }
}

async function submitImage() {
  if (!imageBase64.value) return
  submitting.value = true
  try {
    const response = await createTask({
      type: 'image_to_model',
      imageBase64: imageBase64.value,
      mimeType: imageMimeType.value,
      provider_id: selectedProvider.value,
    })
    tasks.value.unshift({
      taskId: response.data.taskId,
      providerId: selectedProvider.value,
      type: 'image_to_model',
      prompt: null,
      status: response.data.status,
      progress: 0,
      creditCost: 0,
      outputUrl: null,
      thumbnailUrl: null,
      thumbnailExpired: false,
      resourceId: null,
      errorMessage: null,
      createdAt: new Date().toISOString(),
      completedAt: null,
      downloadExpired: false,
    })
    startPolling(response.data.taskId, updateTask)
    imageBase64.value = null
  } catch (error) {
    if (isInsufficientCreditsError(error)) {
      triggerDialog()
    } else {
      ElMessage.error(getErrorMessage(error))
    }
  } finally {
    submitting.value = false
  }
}

function handleImageChange(event: Event) {
  const target = event.target as HTMLInputElement
  const file = target.files?.[0]
  if (!file) return
  imageMimeType.value = file.type
  const reader = new FileReader()
  reader.onload = () => {
    const result = String(reader.result || '')
    imageBase64.value = result.split(',')[1] || null
  }
  reader.readAsDataURL(file)
}

function getFilenameFromDisposition(contentDisposition: string | undefined, fallbackName: string): string {
  if (!contentDisposition) {
    return fallbackName
  }

  const utf8Match = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i)
  if (utf8Match?.[1]) {
    return decodeURIComponent(utf8Match[1])
  }

  const plainMatch = contentDisposition.match(/filename="?([^";]+)"?/i)
  return plainMatch?.[1] ?? fallbackName
}

async function download(taskId: string) {
  try {
    const response = await downloadTaskFile(taskId)
    const blobUrl = URL.createObjectURL(response.data)
    const filename = getFilenameFromDisposition(
      response.headers['content-disposition'],
      `${taskId}.glb`
    )
    const link = document.createElement('a')
    link.href = blobUrl
    link.download = filename
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(blobUrl)
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : t('errors.downloadFailed'))
  }
}

async function upload(taskId: string, taskPrompt: string | null) {
  uploadingTaskId.value = taskId
  try {
    await uploadToMain(taskId, taskPrompt, () => {})
    await loadTasks()
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : t('generator.uploadFailed'))
  } finally {
    uploadingTaskId.value = null
  }
}
</script>

<style scoped>
.page {
  display: grid;
  gap: 20px;
}

.panel {
  background: #fff;
  border-radius: 16px;
  padding: 20px;
  box-shadow: 0 16px 40px rgba(15, 23, 42, 0.06);
}

.panel-head {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  align-items: center;
  margin-bottom: 16px;
}

.task-list {
  display: grid;
  gap: 12px;
}

.task-card {
  border: 1px solid #e8edf5;
  border-radius: 12px;
  padding: 16px;
}

.task-card-body {
  display: flex;
  gap: 16px;
  align-items: flex-start;
}

.task-thumbnail-shell {
  width: 80px;
  min-width: 80px;
}

.task-thumbnail-image,
.task-thumbnail-placeholder {
  width: 80px;
  height: 80px;
  border-radius: 14px;
}

.task-thumbnail-image {
  display: block;
  object-fit: cover;
  background: linear-gradient(135deg, #edf2f7, #d7e3f1);
}

.task-thumbnail-placeholder {
  display: grid;
  place-items: center;
  border: 1px dashed #c7d4e2;
  background:
    radial-gradient(circle at 30% 20%, rgba(255, 255, 255, 0.85), transparent 35%),
    linear-gradient(135deg, #f8fbff, #e7eef7);
}

.task-thumbnail-placeholder-label {
  font-size: 14px;
  font-weight: 700;
  letter-spacing: 0.12em;
  color: #6b7f95;
}

.task-content {
  flex: 1;
  min-width: 0;
}

.task-content p {
  margin: 8px 0 0;
  color: #334155;
  word-break: break-word;
}

.task-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  margin-top: 10px;
  color: #64748b;
  font-size: 13px;
}

.meta-item {
  display: inline-flex;
  align-items: center;
}

.task-top,
.actions {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: center;
}

.actions {
  margin-top: 12px;
}

@media (max-width: 640px) {
  .task-card-body {
    flex-direction: column;
  }

  .task-thumbnail-shell {
    width: 100%;
    min-width: 0;
  }
}
</style>
