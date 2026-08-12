import type { FindingCategorySchema, FindingSeveritySchema } from "../agent/schema.js";
import type { z } from "zod";

export type Severity = z.infer<typeof FindingSeveritySchema>;
export type FindingCategory = z.infer<typeof FindingCategorySchema>;

export interface Finding {
  severity: Severity;
  category: FindingCategory;
  description: string;
}
