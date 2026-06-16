import type { Rule } from "../ir/types.js";
import {
  describePredicate,
  evalPredicate,
  type EvalContext,
} from "./predicate.js";

export type RuleResult = {
  passed: boolean;
  causePresent: boolean;
  failedConditions: string[];
  triggeredImpediments: string[];
};

export function evaluateRule(rule: Rule, ctx: EvalContext): RuleResult {
  const causePresent = evalPredicate(rule.cause, ctx);

  const failedConditions = rule.conditions
    .filter((condition) => !evalPredicate(condition, ctx))
    .map(describePredicate);

  const triggeredImpediments = rule.impediments
    .filter((impediment) => evalPredicate(impediment, ctx))
    .map(describePredicate);

  const passed =
    causePresent &&
    failedConditions.length === 0 &&
    triggeredImpediments.length === 0;

  return {
    passed,
    causePresent,
    failedConditions,
    triggeredImpediments,
  };
}
