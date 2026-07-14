import type { Response } from 'express';
import type { AuthenticatedRequest } from '../middleware/auth';

const mockGetSummary = jest.fn();
const mockSetDefaultLimit = jest.fn();
const mockResetAllUsage = jest.fn();
const mockResetUserUsage = jest.fn();
const mockListUsageStatuses = jest.fn();
const mockRecordAdminAudit = jest.fn();

jest.mock('../services/quotaToolRegistry', () => ({
  activeQuotaTool: {
    getSummary: (...args: unknown[]) => mockGetSummary(...args),
    setDefaultLimit: (...args: unknown[]) => mockSetDefaultLimit(...args),
    resetAllUsage: (...args: unknown[]) => mockResetAllUsage(...args),
    resetUserUsage: (...args: unknown[]) => mockResetUserUsage(...args),
    listUsageStatuses: (...args: unknown[]) => mockListUsageStatuses(...args),
  },
}));

jest.mock('../services/adminAudit', () => ({
  recordAdminAudit: (...args: unknown[]) => mockRecordAdminAudit(...args),
}));

import {
  getQuotaSummaryHandler,
  listUserQuotasHandler,
  resetUsageHandler,
  resetUserUsageHandler,
  updateDefaultLimitHandler,
} from '../controllers/quota';

function createResponseDouble() {
  const res = {
    status: jest.fn(),
    json: jest.fn(),
  } as unknown as Response;

  (res.status as unknown as jest.Mock).mockReturnValue(res);
  return res;
}

function createRequest(input: Partial<AuthenticatedRequest>): AuthenticatedRequest {
  return {
    body: {},
    query: {},
    params: {},
    ...input,
  } as AuthenticatedRequest;
}

describe('quota admin access', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetSummary.mockResolvedValue({
      tool: 'simple-user-usage-quota',
      quota_limit: 100,
      used_user_count: 0,
      total_used_power: 0,
      total_remaining_power: 0,
    });
    mockSetDefaultLimit.mockResolvedValue(undefined);
    mockResetAllUsage.mockResolvedValue({ affectedUsers: 1, clearedPower: 12.5 });
    mockResetUserUsage.mockResolvedValue({ affectedUsers: 1, clearedPower: 5 });
    mockListUsageStatuses.mockResolvedValue({
      data: [],
      pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 },
    });
    mockRecordAdminAudit.mockResolvedValue(undefined);
  });

  it('allows managers to read global quota summaries', async () => {
    const req = createRequest({
      query: { organization_id: '7' },
      user: {
        userId: 9,
        roles: ['manager'],
        organizations: [{ id: 7, name: 'school-a' }],
      },
    });
    const res = createResponseDouble();

    await getQuotaSummaryHandler(req, res);

    expect(mockGetSummary).toHaveBeenCalledWith(null);
    expect(res.json).toHaveBeenCalledWith({
      data: expect.objectContaining({ tool: 'simple-user-usage-quota' }),
    });
  });

  it('allows managers to list global user quotas without an organization scope', async () => {
    const req = createRequest({
      user: {
        userId: 9,
        roles: ['manager'],
        organizations: [{ id: 7, name: 'school-a' }],
      },
    });
    const res = createResponseDouble();

    await listUserQuotasHandler(req, res);

    expect(mockListUsageStatuses).toHaveBeenCalledWith({
      page: 1,
      pageSize: 20,
      search: '',
      organization: null,
    });
    expect(res.json).toHaveBeenCalledWith({
      data: [],
      pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 },
    });
  });

  it('allows admins to update the global default limit with an organization scope', async () => {
    const req = createRequest({
      body: { organization_id: 7, quota_limit: 250.555 },
      user: {
        userId: 9,
        roles: ['admin'],
        organizations: [{ id: 7, name: 'school-a' }],
      },
    });
    const res = createResponseDouble();

    await updateDefaultLimitHandler(req, res);

    expect(mockSetDefaultLimit).toHaveBeenCalledWith(250.56);
    expect(mockGetSummary).toHaveBeenCalledWith(null);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: expect.objectContaining({ tool: 'simple-user-usage-quota' }),
    });
  });

  it('allows managers to update default limits without an organization scope', async () => {
    const req = createRequest({
      body: { quota_limit: 250 },
      user: {
        userId: 9,
        roles: ['manager'],
        organizations: [{ id: 7, name: 'school-a' }],
      },
    });
    const res = createResponseDouble();

    await updateDefaultLimitHandler(req, res);

    expect(mockSetDefaultLimit).toHaveBeenCalledWith(250);
    expect(mockGetSummary).toHaveBeenCalledWith(null);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: expect.objectContaining({ tool: 'simple-user-usage-quota' }),
    });
  });

  it('lets root update the global default limit without an organization scope', async () => {
    const req = createRequest({
      body: { quota_limit: 300 },
      user: {
        userId: 1,
        roles: ['root'],
        organizations: [],
      },
    });
    const res = createResponseDouble();

    await updateDefaultLimitHandler(req, res);

    expect(mockSetDefaultLimit).toHaveBeenCalledWith(300);
    expect(mockGetSummary).toHaveBeenCalledWith(null);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: expect.objectContaining({ tool: 'simple-user-usage-quota' }),
    });
  });

  it('allows admins to reset global usage even when an organization is supplied', async () => {
    const req = createRequest({
      body: { organization_id: 12 },
      user: {
        userId: 9,
        roles: ['admin'],
        organizations: [{ id: 7, name: 'school-a' }],
      },
    });
    const res = createResponseDouble();

    await resetUsageHandler(req, res);

    expect(mockResetAllUsage).toHaveBeenCalledWith('admin reset by user 9', null);
    expect(mockGetSummary).toHaveBeenCalledWith(null);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: expect.objectContaining({ affectedUsers: 1, clearedPower: 12.5 }),
    });
  });

  it('lets root reset global usage without an organization scope', async () => {
    const req = createRequest({
      user: {
        userId: 1,
        roles: ['root'],
        organizations: [],
      },
    });
    const res = createResponseDouble();

    await resetUsageHandler(req, res);

    expect(mockResetAllUsage).toHaveBeenCalledWith('admin reset by user 1', null);
    expect(mockGetSummary).toHaveBeenCalledWith(null);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: expect.objectContaining({ affectedUsers: 1, clearedPower: 12.5 }),
    });
  });

  it('requires learner-role enforcement for global single user resets', async () => {
    const req = createRequest({
      params: { userId: '42' },
      body: { organization_id: 7 },
      user: {
        userId: 9,
        roles: ['admin'],
        organizations: [{ id: 7, name: 'school-a' }],
      },
    });
    const res = createResponseDouble();

    await resetUserUsageHandler(req, res);

    expect(mockResetUserUsage).toHaveBeenCalledWith(42, 'single user reset by user 9', {
      organization: null,
      requireLearnerRole: true,
    });
  });
});
