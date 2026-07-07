export type QuotaToolId = 'simple-user-usage-quota';

export interface QuotaStatus {
  tool: QuotaToolId;
  user_id: number;
  quota_limit: number;
  used_power: number;
  remaining_power: number;
  has_record: boolean;
  updated_at: Date | null;
  user_snapshot?: QuotaUserSnapshot | null;
}

export interface QuotaSummary {
  tool: QuotaToolId;
  quota_limit: number;
  used_user_count: number;
  total_used_power: number;
  total_remaining_power: number;
}

export interface QuotaOrganizationSummary {
  id?: number;
  name?: string;
  title?: string;
}

export interface QuotaOrganizationScope {
  id?: number;
  name?: string;
}

export interface QuotaUsageListParams {
  page: number;
  pageSize: number;
  search?: string;
  organization?: QuotaOrganizationScope | null;
}

export interface QuotaUsageListResult {
  data: QuotaStatus[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}

export interface QuotaReserveResult {
  success: boolean;
  errorCode?: 'INSUFFICIENT_CREDITS' | 'CONCURRENT_CONFLICT';
  usedPowerAfter?: number;
  remainingPower?: number;
}

export interface ConfirmDeductResult {
  billingStatus: 'settled' | 'undercharged';
  billingMessage: string | null;
  shortfallAmount: number;
}

export interface QuotaUserSnapshot {
  user_id: number;
  username?: string;
  nickname?: string | null;
  email?: string | null;
  status?: number;
  roles?: string[];
  organizations?: QuotaOrganizationSummary[];
  captured_at?: string;
}

export interface QuotaTool {
  readonly id: QuotaToolId;

  getDefaultLimit(): Promise<number>;
  setDefaultLimit(limit: number): Promise<void>;
  getSummary(organization?: QuotaOrganizationScope | null): Promise<QuotaSummary>;
  resetAllUsage(note?: string, organization?: QuotaOrganizationScope | null): Promise<{ affectedUsers: number; clearedPower: number }>;
  resetUserUsage(
    userId: number,
    note?: string,
    options?: {
      organization?: QuotaOrganizationScope | null;
      requireLearnerRole?: boolean;
    }
  ): Promise<{ affectedUsers: number; clearedPower: number }>;

  getUserStatus(userId: number, userSnapshot?: QuotaUserSnapshot): Promise<QuotaStatus>;
  getUserStatuses(userIds: number[]): Promise<Map<number, QuotaStatus>>;
  listUsageStatuses(params: QuotaUsageListParams): Promise<QuotaUsageListResult>;

  reserve(
    userId: number,
    providerId: string,
    amount: number,
    taskId: string,
    userSnapshot?: QuotaUserSnapshot
  ): Promise<QuotaReserveResult>;

  refund(userId: number, providerId: string, taskId: string): Promise<void>;

  finalizeTaskSuccess(
    userId: number,
    providerId: string,
    taskId: string,
    outputUrl: string,
    powerCost: number,
    creditCost: number,
    thumbnailUrl?: string
  ): Promise<ConfirmDeductResult>;
}
