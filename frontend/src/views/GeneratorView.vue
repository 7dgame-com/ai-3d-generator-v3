<template>
  <div class="page">
    <section class="panel">
      <div class="panel-head">
        <h2>{{ t('generator.title') }}</h2>
        <el-select
          v-if="providers.length > 1"
          v-model="selectedProvider"
          data-test="provider-select"
          placeholder="Provider"
          style="width: 200px"
        >
          <el-option v-for="provider in providers" :key="provider" :label="provider" :value="provider" />
        </el-select>
        <span
          v-else-if="providers.length === 1"
          data-test="single-provider-label"
          class="single-provider-label"
        >
          {{ selectedProvider }}
        </span>
      </div>

      <el-tabs v-model="mode">
        <el-tab-pane :label="t('generator.textTab')" name="text">
          <el-input v-model="prompt" type="textarea" :rows="4" :maxlength="500" show-word-limit />
          <div class="actions">
            <el-button type="primary" :disabled="!prompt.trim()" :loading="submitting" @click="submitText">
              {{ t('generator.submit') }}
            </el-button>
          </div>
        </el-tab-pane>
        <el-tab-pane :label="t('generator.imageTab')" name="image">
          <div
            data-test="image-dropzone"
            class="image-upload-area"
            :class="{ 'drag-active': isImageDragActive }"
            @dragenter.prevent="handleImageDragEnter"
            @dragover.prevent="handleImageDragOver"
            @dragleave.prevent="handleImageDragLeave"
            @drop.prevent="handleImageDrop"
          >
            <input
              ref="fileInputRef"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              class="file-input-hidden"
              @change="handleImageChange"
            />
            <div
              v-if="imagePreviewUrl"
              data-test="image-preview"
              class="image-preview"
              @click="openImagePicker"
            >
              <img :src="imagePreviewUrl" alt="preview" class="preview-img" data-test="image-preview-img" />
              <div class="preview-overlay">
                <span>{{ t('generator.changeImage') }}</span>
              </div>
            </div>
            <div v-else class="image-placeholder" @click="openImagePicker">
              <el-icon :size="48"><UploadFilled /></el-icon>
              <span>{{ t('generator.selectImage') }}</span>
            </div>
          </div>
          <div class="actions">
            <el-button type="primary" :disabled="!imageBase64" :loading="submitting" @click="submitImage">
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
                <span v-if="displayPower(task.powerCost, task.creditCost, task.providerId) > 0" class="meta-item">
                  {{ t('generator.power', { n: displayPower(task.powerCost, task.creditCost, task.providerId) }) }}
                </span>
                <span v-if="task.fileSize" class="meta-item">
                  {{ formatFileSize(task.fileSize) }}
                </span>
                <span v-if="task.createdAt" class="meta-item">
                  {{ formatDateTime(task.createdAt) }}
                </span>
                <span v-if="task.createdAt && task.completedAt" class="meta-item">
                  {{ formatTaskDuration(task.createdAt, task.completedAt) }}
                </span>
                <span
                  v-if="getTaskExpiry(task)"
                  class="meta-item"
                  :class="{ 'expiry-urgent': getTaskExpiry(task)?.urgent }"
                >
                  {{ getTaskExpiry(task)?.text }}
                </span>
              </div>
              <el-progress v-if="task.status === 'processing'" :percentage="task.progress" />
              <div class="actions">
                <el-button v-if="task.status === 'success' && !task.downloadExpired" @click="download(task.taskId)">
                  {{ t('generator.download') }}
                </el-button>
                <el-button
                  v-if="task.status === 'success' && !task.downloadExpired && !task.resourceId"
                  :loading="uploadingTaskId === task.taskId"
                  @click="upload(task.taskId, task.prompt)"
                >
                  {{ t('generator.upload') }}
                </el-button>
                <el-tag v-if="task.downloadExpired" type="info" size="small">{{ t('generator.expired') }}</el-tag>
                <el-button
                  v-if="task.resourceId"
                  :data-test="`task-resource-${task.taskId}`"
                  size="small"
                  @click="openMainResource(task.resourceId)"
                >
                  {{ t('generator.view') }}
                </el-button>
              </div>
            </div>
          </div>
        </article>
      </div>
      <el-pagination
        v-if="total > pageSize"
        v-model:current-page="currentPage"
        :page-size="pageSize"
        :total="total"
        layout="prev, pager, next"
        @current-change="handlePageChange"
      />
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
import { UploadFilled } from '@element-plus/icons-vue'
import { downloadTaskFile, fetchThumbnailBlob, getEnabledProviders, listTasks, type Task } from '../api'
import type { TaskStatusOutput } from '../adapters/IFrontendProviderAdapter'
import CreditDialog from '../components/CreditDialog.vue'
import { useCreditCheck } from '../composables/useCreditCheck'
import { useDirectTaskCreation } from '../composables/useDirectTaskCreation'
import { useTaskPoller } from '../composables/useTaskPoller'
import { useUploadService } from '../composables/useUploadService'
import { useI18n } from 'vue-i18n'
import type { AxiosError } from 'axios'
import { useRouter } from 'vue-router'
import { useTheme } from '../composables/useTheme'
import { getProviderDefaultCreditCost } from '../utils/providerBilling'
import {
  formatDuration,
  formatDateTime as formatDateTimeUtil,
  formatExpiryCountdown,
  providerLabel,
  displayPower,
  formatFileSize,
} from './generatorTaskMeta'

const { t, locale } = useI18n()
const router = useRouter()
const { themeName } = useTheme()
const { showCreditDialog, isAdmin, checkCredits, triggerDialog, closeDialog } = useCreditCheck()
const { createTask: createDirectTask } = useDirectTaskCreation()
const { startPolling, stopAllPolling } = useTaskPoller()
const { uploadToMain } = useUploadService()

const mode = ref<'text' | 'image'>('text')
const prompt = ref('')
const fileInputRef = ref<HTMLInputElement | null>(null)
const imageBase64 = ref<string | null>(null)
const imageFile = ref<File | null>(null)
const imagePreviewUrl = ref<string | null>(null)
const isImageDragActive = ref(false)
const submitting = ref(false)
const providers = ref<string[]>([])
const selectedProvider = ref('tripo3d')
const tasks = ref<Task[]>([])
const currentPage = ref(1)
const pageSize = ref(20)
const total = ref(0)
const countdownNowMs = ref(Date.now())
const uploadingTaskId = ref<string | null>(null)
const brokenThumbnailTaskIds = ref<Record<string, boolean>>({})
const thumbnailBlobUrls = ref<Record<string, string>>({})
const acceptedImageMimeTypes = new Set(['image/png', 'image/jpeg', 'image/webp'])
let imageDragDepth = 0

// ── 平滑进度插值 ──
const smoothProgress = ref<Record<string, number>>({})
const targetProgressMap = new Map<string, number>()
let tweenTimer: number | null = null
let countdownTimer: number | null = null
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
  if (countdownTimer !== null) { window.clearInterval(countdownTimer); countdownTimer = null }
  if (imagePreviewUrl.value) {
    URL.revokeObjectURL(imagePreviewUrl.value)
  }
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
  if (error instanceof Error && error.message.trim()) {
    return error.message
  }
  return t('errors.createTaskFailed')
}

function isInsufficientCreditsError(error: unknown): boolean {
  const axiosErr = error as AxiosError<{ code?: string }>
  return axiosErr?.response?.data?.code === 'INSUFFICIENT_CREDITS'
}

onMounted(async () => {
  await loadProviders()
  await loadTasks()
  await checkCredits()
  countdownTimer = window.setInterval(() => {
    countdownNowMs.value = Date.now()
  }, 60 * 1000)
})

async function loadProviders() {
  const response = await getEnabledProviders()
  providers.value = response.data.providers ?? []
  if (providers.value.length > 0) {
    selectedProvider.value = providers.value[0]
  }
}

async function loadTasks(page = currentPage.value) {
  const response = await listTasks({ page, pageSize: pageSize.value })
  currentPage.value = response.data.page ?? page
  pageSize.value = response.data.pageSize ?? pageSize.value
  total.value = response.data.total ?? 0
  tasks.value = (response.data.data ?? []).map((task) => normalizeTask(task))
  tasks.value.forEach((task) => {
    if (task.status === 'queued' || task.status === 'processing') {
      startPolling(task.taskId, updateTask)
    }
  })
}

function handlePageChange(page: number) {
  void loadTasks(page)
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

function updateDirectTaskStatus(taskId: string, status: TaskStatusOutput) {
  const index = tasks.value.findIndex((item) => item.taskId === taskId)
  if (index < 0) {
    return
  }

  const currentTask = tasks.value[index]
  if (status.status === 'queued' || status.status === 'processing') {
    setProgressTarget(taskId, status.progress ?? currentTask.progress ?? 0)
  } else {
    clearProgressTarget(taskId)
  }

  tasks.value[index] = normalizeTask({
    ...currentTask,
    status: status.status,
    progress: status.progress ?? currentTask.progress,
    outputUrl: status.outputUrl ?? currentTask.outputUrl,
    thumbnailUrl: status.thumbnailUrl ?? currentTask.thumbnailUrl,
    errorMessage: status.errorMessage ?? currentTask.errorMessage,
  })
}

function normalizeTask(task: Task): Task {
  if (brokenThumbnailTaskIds.value[task.taskId]) {
    const nextBroken = { ...brokenThumbnailTaskIds.value }
    delete nextBroken[task.taskId]
    brokenThumbnailTaskIds.value = nextBroken
  }

  const creditCost = Number(task.creditCost ?? 0)
  const powerCost = Number(task.powerCost ?? 0)
  const fallbackCreditCost =
    task.status === 'success' && creditCost <= 0 && powerCost <= 0
      ? getProviderDefaultCreditCost(task.providerId)
      : creditCost

  const normalized = {
    ...task,
    creditCost: fallbackCreditCost,
    powerCost,
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

function getTaskExpiry(task: Task) {
  if (task.status !== 'success') {
    return null
  }

  return formatExpiryCountdown(task.expiresAt, countdownNowMs.value)
}

function goToAdmin() {
  router.push('/admin')
  closeDialog()
}

function openImagePicker() {
  fileInputRef.value?.click()
}

function resetImageDragState() {
  imageDragDepth = 0
  isImageDragActive.value = false
}

function isFileDragEvent(event: DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes('Files')
}

function applyImageFile(file: File) {
  if (!acceptedImageMimeTypes.has(file.type)) {
    return
  }

  imageFile.value = file
  if (imagePreviewUrl.value) {
    URL.revokeObjectURL(imagePreviewUrl.value)
  }
  imagePreviewUrl.value = URL.createObjectURL(file)

  const reader = new FileReader()
  reader.onload = () => {
    const result = String(reader.result || '')
    imageBase64.value = result.split(',')[1] || null
  }
  reader.readAsDataURL(file)

  if (fileInputRef.value) {
    fileInputRef.value.value = ''
  }
}

function handleImageDragEnter(event: DragEvent) {
  if (!isFileDragEvent(event)) {
    return
  }
  imageDragDepth += 1
  isImageDragActive.value = true
}

function handleImageDragOver(event: DragEvent) {
  if (!isFileDragEvent(event)) {
    return
  }
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'copy'
  }
  isImageDragActive.value = true
}

function handleImageDragLeave(event: DragEvent) {
  if (!isFileDragEvent(event)) {
    return
  }
  imageDragDepth = Math.max(0, imageDragDepth - 1)
  if (imageDragDepth === 0) {
    isImageDragActive.value = false
  }
}

function handleImageDrop(event: DragEvent) {
  const file = event.dataTransfer?.files?.[0]
  resetImageDragState()
  if (!file) {
    return
  }
  applyImageFile(file)
}

async function submitText() {
  submitting.value = true
  const taskPrompt = prompt.value
  let createdTaskId = ''
  try {
    const response = await createDirectTask({
      type: 'text_to_model',
      prompt: taskPrompt,
      providerId: selectedProvider.value,
      onUpdate: (status) => {
        if (createdTaskId) {
          updateDirectTaskStatus(createdTaskId, status)
        }
      },
      onComplete: () => {
        if (createdTaskId) {
          clearProgressTarget(createdTaskId)
        }
        void loadTasks()
      },
      onFail: (errorMessage) => {
        if (createdTaskId) {
          updateDirectTaskStatus(createdTaskId, {
            status: 'failed',
            progress: 100,
            errorMessage,
          })
        }
        void loadTasks()
      },
    })
    createdTaskId = response.taskId

    tasks.value.unshift({
      taskId: createdTaskId,
      providerId: selectedProvider.value,
      type: 'text_to_model',
      prompt: taskPrompt,
      status: 'queued',
      progress: 0,
      creditCost: 0,
      powerCost: 0,
      outputUrl: null,
      thumbnailUrl: null,
      thumbnailExpired: false,
      directModeTask: true,
      resourceId: null,
      errorMessage: null,
      createdAt: new Date().toISOString(),
      completedAt: null,
      expiresAt: null,
      downloadExpired: false,
    })
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
  if (!imageFile.value) return
  submitting.value = true
  const sourceImageFile = imageFile.value
  let createdTaskId = ''
  try {
    const response = await createDirectTask({
      type: 'image_to_model',
      imageFile: sourceImageFile,
      providerId: selectedProvider.value,
      onUpdate: (status) => {
        if (createdTaskId) {
          updateDirectTaskStatus(createdTaskId, status)
        }
      },
      onComplete: () => {
        if (createdTaskId) {
          clearProgressTarget(createdTaskId)
        }
        void loadTasks()
      },
      onFail: (errorMessage) => {
        if (createdTaskId) {
          updateDirectTaskStatus(createdTaskId, {
            status: 'failed',
            progress: 100,
            errorMessage,
          })
        }
        void loadTasks()
      },
    })
    createdTaskId = response.taskId

    tasks.value.unshift({
      taskId: createdTaskId,
      providerId: selectedProvider.value,
      type: 'image_to_model',
      prompt: null,
      status: 'queued',
      progress: 0,
      creditCost: 0,
      powerCost: 0,
      outputUrl: null,
      thumbnailUrl: null,
      thumbnailExpired: false,
      directModeTask: true,
      resourceId: null,
      errorMessage: null,
      createdAt: new Date().toISOString(),
      completedAt: null,
      expiresAt: null,
      downloadExpired: false,
    })
    imageFile.value = null
    imageBase64.value = null
    imagePreviewUrl.value = null
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
  applyImageFile(file)
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

function openMainResource(resourceId: number | null) {
  if (!resourceId) {
    return
  }

  window.parent.postMessage(
    {
      type: 'EVENT',
      id: `navigate-host-${resourceId}-${Date.now()}`,
      payload: {
        event: 'navigate-host',
        path: '/resource/polygen/index',
        query: {
          lang: String(locale.value),
          theme: String(themeName.value),
          resourceId: String(resourceId),
          open: '1',
        },
      },
    },
    '*',
  )
}
</script>

<style scoped>
.page {
  display: grid;
  gap: 20px;
}

.image-upload-area {
  margin-bottom: 12px;
}

.file-input-hidden {
  display: none;
}

.image-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  width: 100%;
  height: 200px;
  border: 2px dashed #dcdfe6;
  border-radius: 8px;
  cursor: pointer;
  color: #909399;
  transition: border-color 0.2s, color 0.2s;
}

.image-upload-area.drag-active .image-placeholder {
  border-color: #409eff;
  color: #409eff;
  background: linear-gradient(135deg, #f4f9ff, #eef6ff);
  box-shadow: 0 0 0 4px rgba(64, 158, 255, 0.12);
}

.image-placeholder:hover {
  border-color: #409eff;
  color: #409eff;
}

.image-preview {
  position: relative;
  display: inline-block;
  cursor: pointer;
  border: 2px dashed transparent;
  border-radius: 8px;
  overflow: hidden;
  max-width: 100%;
  transition: border-color 0.2s, box-shadow 0.2s;
}

.image-upload-area.drag-active .image-preview {
  border-color: #409eff;
  box-shadow: 0 0 0 4px rgba(64, 158, 255, 0.12);
}

.preview-img {
  display: block;
  max-width: 100%;
  max-height: 300px;
  object-fit: contain;
  border-radius: 8px;
}

.preview-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.4);
  color: #fff;
  font-size: 14px;
  opacity: 0;
  transition: opacity 0.2s;
}

.image-preview:hover .preview-overlay {
  opacity: 1;
}

.image-upload-area.drag-active .preview-overlay {
  opacity: 1;
  background: rgba(64, 158, 255, 0.28);
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

.single-provider-label {
  display: inline-flex;
  align-items: center;
  min-width: 200px;
  min-height: 32px;
  padding: 0 12px;
  border: 1px solid #dcdfe6;
  border-radius: 4px;
  background: #f8fafc;
  color: #606266;
  font-size: 14px;
  font-weight: 600;
  box-sizing: border-box;
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

.expiry-urgent {
  color: #dc2626;
  font-weight: 600;
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
