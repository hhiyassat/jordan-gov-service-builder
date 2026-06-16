import type { ServiceDefinition, TransitionDef, Validity } from "../ir/types.js";
import type { EvalContext } from "../rules/predicate.js";
import { evaluateRule } from "../rules/rule.js";
import type { AuditEntry } from "./audit.js";
import type { ApplicationState } from "./state.js";

function toEvalContext(app: ApplicationState): EvalContext {
  return {
    fields: app.fields,
    apiResults: app.apiResults,
  };
}

function formatBlockedReason(rule: ReturnType<typeof evaluateRule>): string {
  if (!rule.causePresent) {
    return "Cause not satisfied";
  }
  if (rule.failedConditions.length > 0) {
    return `Failed conditions: ${rule.failedConditions.join(", ")}`;
  }
  if (rule.triggeredImpediments.length > 0) {
    return `Triggered impediments: ${rule.triggeredImpediments.join(", ")}`;
  }
  return "Guard blocked";
}

function buildAudit(
  transition: TransitionDef,
  app: ApplicationState,
  toStateId: string | null,
  outcome: AuditEntry["outcome"],
  reason: string | null,
  rule: ReturnType<typeof evaluateRule>,
  validityAfter: Validity,
): AuditEntry {
  return {
    transitionId: transition.id,
    fromStateId: app.stateId,
    toStateId,
    outcome,
    reason,
    rule,
    validityBefore: app.validity,
    validityAfter,
  };
}

function blockedResult(
  transition: TransitionDef,
  app: ApplicationState,
  reason: string,
  rule: ReturnType<typeof evaluateRule>,
): { blocked: true; reason: string; audit: AuditEntry } {
  return {
    blocked: true,
    reason,
    audit: buildAudit(transition, app, null, "blocked", reason, rule, app.validity),
  };
}

export function enabledTransitions(
  def: ServiceDefinition,
  app: ApplicationState,
): TransitionDef[] {
  const current = def.states.find((state) => state.id === app.stateId);
  if (!current || current.isTerminal) {
    return [];
  }

  const ctx = toEvalContext(app);
  return def.transitions
    .filter((transition) => transition.from === app.stateId)
    .filter((transition) => evaluateRule(transition.guard, ctx).passed)
    .sort((left, right) => left.id.localeCompare(right.id));
}

export function advance(
  def: ServiceDefinition,
  app: ApplicationState,
  transitionId: string,
):
  | { next: ApplicationState; audit: AuditEntry }
  | { blocked: true; reason: string; audit: AuditEntry } {
  const current = def.states.find((state) => state.id === app.stateId);
  const transition = def.transitions.find((item) => item.id === transitionId);

  if (!transition) {
    const fallbackRule = evaluateRule(
      {
        id: "missing-transition",
        cause: { kind: "always" },
        conditions: [],
        impediments: [],
      },
      toEvalContext(app),
    );
    return {
      blocked: true,
      reason: "Unknown transition",
      audit: {
        transitionId,
        fromStateId: app.stateId,
        toStateId: null,
        outcome: "blocked",
        reason: "Unknown transition",
        rule: fallbackRule,
        validityBefore: app.validity,
        validityAfter: app.validity,
      },
    };
  }

  if (!current) {
    const rule = evaluateRule(transition.guard, toEvalContext(app));
    return blockedResult(transition, app, "Unknown current state", rule);
  }

  if (current.isTerminal) {
    const rule = evaluateRule(transition.guard, toEvalContext(app));
    return blockedResult(
      transition,
      app,
      "Cannot transition from terminal state",
      rule,
    );
  }

  if (transition.from !== app.stateId) {
    const rule = evaluateRule(transition.guard, toEvalContext(app));
    return blockedResult(
      transition,
      app,
      "Transition not enabled from current state",
      rule,
    );
  }

  const rule = evaluateRule(transition.guard, toEvalContext(app));
  if (!rule.passed) {
    return blockedResult(transition, app, formatBlockedReason(rule), rule);
  }

  const validityAfter = transition.setValidity ?? app.validity;
  const next: ApplicationState = {
    ...app,
    stateId: transition.to,
    validity: validityAfter,
  };

  return {
    next,
    audit: buildAudit(
      transition,
      app,
      transition.to,
      "allowed",
      null,
      rule,
      validityAfter,
    ),
  };
}
