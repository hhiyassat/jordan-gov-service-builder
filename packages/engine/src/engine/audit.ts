import type { Validity } from "../ir/types.js";
import type { RuleResult } from "../rules/rule.js";

export type AuditEntry = {
  transitionId: string;
  fromStateId: string;
  toStateId: string | null;
  outcome: "allowed" | "blocked";
  reason: string | null;
  rule: RuleResult;
  validityBefore: Validity;
  validityAfter: Validity;
};
