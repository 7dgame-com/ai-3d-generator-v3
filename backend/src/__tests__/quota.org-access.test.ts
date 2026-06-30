import type { Response } from 'express';
import type { AuthenticatedRequest } from '../middleware/auth';

const mockGetSummary = jest.fn();
const mockResetAllUsage = jest.fn();
const mockResetUserUsage = jest.fn();
const mockListUsageStatuses = jest.fn();

jest.mock('../services/quotaToolRegistry', () => ({
  activeQuotaTool: {
    getSummary: (...args: unknown[]) => mockGetSummary(...args),
    resetAllUsage: (...args: unknown[]) => mockResetAllUsage(...args),
    resetUserUsage: (...args: unknown[]) => mockResetUserUsage(...args),
    listUsageStatuses: (...args: unknown[]) => mockListUsageStatuses(...args),
  },
}));

import {
  getQuotaSummaryHandler,
  listUserQuotasHandler,
  resetUsageHandler,
  resetUserUsageHandler,
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

describe('quota organization admin access', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetSummary.mockResolvedValue({
      tool: 'simple-user-usage-quota',
      quota_limit: 100,
      used_user_count: 0,
      total_used_power: 0,
      total_remaining_power: 0,
    });
    mockResetAllUsage.mockResolvedValue({ affectedUsers: 1, clearedPower: 12.5 });
    mockResetUserUsage.mockResolvedValue({ affectedUsers: 1, clearedPower: 5 });
    mockListUsageStatuses.mockResolvedValue({
      data: [],
      pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 },
    });
  });

  it('allows same-organization managers to read quota summaries', async () => {
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

    expect(mockGetSummary).toHaveBeenCalledWith({ id: 7 });
    expect(res.json).toHaveBeenCalledWith({
      data: expect.objectContaining({ tool: 'simple-user-usage-quota' }),
    });
  });

  it('rejects organization managers when the organization scope is missing', async () => {
    const req = createRequest({
      user: {
        userId: 9,
        roles: ['manager'],
        organizations: [{ id: 7, name: 'school-a' }],
      },
    });
    const res = createResponseDouble();

    await listUserQuotasHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(422);
    expect(mockListUsageStatuses).not.toHaveBeenCalled();
  });

  it('rejects organization managers outside their organization', async () => {
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

    expect(res.status).toHaveBeenCalledWith(403);
    expect(mockResetAllUsage).not.toHaveBeenCalled();
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

  it('requires learner-role enforcement for organization-scoped single user resets', async () => {
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
      organization: { id: 7 },
      requireLearnerRole: true,
    });
  });
});
