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
          <div class="task-top">
            <strong>{{ task.type }}</strong>
            <el-tag>{{ task.status }}</el-tag>
          </div>
          <p>{{ task.prompt || task.taskId }}</p>
          <el-progress v-if="task.status === 'processing'" :percentage="task.progress" />
          <div class="actions">
            <el-button v-if="task.status === 'success' && can('download-model')" @click="download(task.taskId)">
              {{ t('generator.download') }}
            </el-button>
            <el-button
              v-if="task.status === 'success' && !task.resourceId && can('upload-to-main')"
              :loading="uploadingTaskId === task.taskId"
              @click="upload(task.taskId, task.prompt)"
            >
              {{ t('generator.upload') }}
            </el-button>
            <span v-if="task.resourceId">Resource #{{ task.resourceId }}</span>
          </div>
        </article>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { createTask, getEnabledProviders, listTasks, type Task } from '../api'
import { usePermissions } from '../composables/usePermissions'
import { useTaskPoller } from '../composables/useTaskPoller'
import { useUploadService } from '../composables/useUploadService'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
const { can, fetchAllowedActions } = usePermissions()
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

onMounted(async () => {
  await fetchAllowedActions()
  await loadProviders()
  await loadTasks()
})

onBeforeUnmount(() => {
  stopAllPolling()
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
  tasks.value = response.data.data ?? []
  tasks.value.forEach((task) => {
    if (task.status === 'queued' || task.status === 'processing') {
      startPolling(task.taskId, updateTask)
    }
  })
}

function updateTask(task: Task) {
  const index = tasks.value.findIndex((item) => item.taskId === task.taskId)
  if (index >= 0) {
    tasks.value[index] = task
  }
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
      type: 'text_to_model',
      prompt: prompt.value,
      status: response.data.status,
      progress: 0,
      creditCost: 0,
      outputUrl: null,
      resourceId: null,
      errorMessage: null,
      createdAt: new Date().toISOString(),
      completedAt: null,
    })
    startPolling(response.data.taskId, updateTask)
    prompt.value = ''
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '创建任务失败')
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
      type: 'image_to_model',
      prompt: null,
      status: response.data.status,
      progress: 0,
      creditCost: 0,
      outputUrl: null,
      resourceId: null,
      errorMessage: null,
      createdAt: new Date().toISOString(),
      completedAt: null,
    })
    startPolling(response.data.taskId, updateTask)
    imageBase64.value = null
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '创建任务失败')
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

function download(taskId: string) {
  window.open(`/backend/download/${taskId}`, '_blank')
}

async function upload(taskId: string, taskPrompt: string | null) {
  uploadingTaskId.value = taskId
  try {
    await uploadToMain(taskId, taskPrompt, () => {})
    await loadTasks()
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '上传失败')
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
</style>
