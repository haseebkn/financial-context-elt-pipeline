import { searchContextTool } from "./search-context.js";
import { queryWarehouseTool } from "./query-warehouse.js";
import { getPortfolioSnapshotTool } from "./get-portfolio-snapshot.js";
import { summarizeSpendTool } from "./summarize-spend.js";

export const tools = [
  searchContextTool,
  queryWarehouseTool,
  getPortfolioSnapshotTool,
  summarizeSpendTool,
] as const;

export {
  searchContextTool,
  queryWarehouseTool,
  getPortfolioSnapshotTool,
  summarizeSpendTool,
};
