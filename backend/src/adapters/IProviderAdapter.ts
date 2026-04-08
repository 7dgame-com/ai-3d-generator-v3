export interface CreateTaskInput {
  type: 'text_to_model' | 'image_to_model';
  prompt?: string;
  imageBase64?: string;
  mimeType?: string;
}

export interface CreateTaskOutput {
  taskId: string;
  pollingKey?: string;
  estimatedCost: number;
}

export interface TaskStatusOutput {
  status: 'queued' | 'processing' | 'success' | 'failed';
  progress: number;
  creditCost?: number;
  outputUrl?: string;
  thumbnailUrl?: string;
  errorMessage?: string;
}

export interface ProviderBalance {
  available: number;
  frozen: number;
}

export interface IProviderAdapter {
  readonly providerId: string;
  validateApiKeyFormat(apiKey: string): boolean;
  verifyApiKey(apiKey: string): Promise<void>;
  createTask(apiKey: string, input: CreateTaskInput): Promise<CreateTaskOutput>;
  getTaskStatus(apiKey: string, taskId: string, pollingKey?: string): Promise<TaskStatusOutput>;
  getBalance(apiKey: string): Promise<ProviderBalance>;
}
