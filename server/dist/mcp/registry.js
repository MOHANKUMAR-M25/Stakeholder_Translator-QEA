import { getProjectInfoTool } from "./tools/project.js";
import { getSummaryTool } from "./tools/summary.js";
import { listModulesTool, getModuleTool } from "./tools/modules.js";
import { listStakeholdersTool, getStakeholderTool } from "./tools/stakeholders.js";
import { getMetricsTool } from "./tools/metrics.js";
import { getRiskAnalysisTool } from "./tools/risks.js";
import { listFailedTestsTool, getTestTool } from "./tools/tests.js";
import { searchTool } from "./tools/search.js";
export const TOOL_REGISTRY = [
    getProjectInfoTool,
    getSummaryTool,
    listModulesTool,
    getModuleTool,
    listStakeholdersTool,
    getStakeholderTool,
    getMetricsTool,
    getRiskAnalysisTool,
    listFailedTestsTool,
    getTestTool,
    searchTool,
];
