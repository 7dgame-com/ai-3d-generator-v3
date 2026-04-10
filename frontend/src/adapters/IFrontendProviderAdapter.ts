export interface CreateTaskInput {
  type: 'text_to_model' | 'image_to_model'
  prompt?: string
  imageFile?: File
}

export interface CreateTaskOutput {
  taskId: string
  pollingKey?: string
  estimatedCreditCost: number
}

export interface TaskStatusOutput {
  status: 'queued' | 'processing' | 'success' | 'failed'
  progress: number
  creditCost?: number
  outputUrl?: string
  thumbnailUrl?: string
  errorMessage?: string
}

export interface IFrontendProviderAdapter {
  readonly providerId: string
  createTask(apiKey: string, input: CreateTaskInput, apiBaseUrl: string): Promise<CreateTaskOutput>
  getTaskStatus(
    apiKey: string,
    taskId: string,
    apiBaseUrl: string,
    pollingKey?: string
  ): Promise<TaskStatusOutput>
}
