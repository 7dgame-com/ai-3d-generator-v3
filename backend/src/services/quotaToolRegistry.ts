import { simpleUserUsageQuotaTool } from './simpleUserUsageQuotaTool';
import type { QuotaTool, QuotaToolId } from './quotaTool';

const tools = new Map<QuotaToolId, QuotaTool>([
  [simpleUserUsageQuotaTool.id, simpleUserUsageQuotaTool],
]);

export function getQuotaTool(toolId = process.env.QUOTA_TOOL_ID): QuotaTool {
  const requestedToolId = (toolId || simpleUserUsageQuotaTool.id) as QuotaToolId;
  const tool = tools.get(requestedToolId);

  if (!tool) {
    throw new Error(`Unsupported quota tool: ${requestedToolId}`);
  }

  return tool;
}

export const activeQuotaTool = getQuotaTool();
