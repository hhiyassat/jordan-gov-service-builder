import { ZodError } from "zod";
import { ServiceDefinitionSchema } from "../ir/schema.js";
import type { Concession, Predicate, Rule, ServiceDefinition } from "../ir/types.js";
import { assertNever } from "../rules/assertNever.js";

export type ValidationErrorCode =
  | "SCHEMA"
  | "REFERENTIAL_INTEGRITY"
  | "COMPLETENESS"
  | "REACHABILITY";

export type ValidationError = {
  code: ValidationErrorCode;
  path: string;
  message: string;
};

export type CompileResult =
  | { ok: true }
  | { ok: false; errors: ValidationError[] };

type EntityRegistry = {
  fieldNames: Set<string>;
  stepIds: Set<string>;
  stateIds: Set<string>;
  feeIds: Set<string>;
  apiIds: Set<string>;
};

function formatPath(path: (string | number)[]): string {
  return path.length > 0 ? path.map(String).join(".") : "(root)";
}

function schemaErrors(error: ZodError): ValidationError[] {
  return error.issues.map((issue) => ({
    code: "SCHEMA",
    path: formatPath(issue.path),
    message: issue.message,
  }));
}

function pushError(
  errors: ValidationError[],
  code: ValidationErrorCode,
  path: string,
  message: string,
): void {
  errors.push({ code, path, message });
}

function buildRegistry(def: ServiceDefinition): EntityRegistry {
  return {
    fieldNames: new Set(def.fields.map((field) => field.name)),
    stepIds: new Set(def.steps.map((step) => step.id)),
    stateIds: new Set(def.states.map((state) => state.id)),
    feeIds: new Set((def.fees ?? []).map((fee) => fee.id)),
    apiIds: new Set(
      def.steps.flatMap((step) => step.apiIds ?? []),
    ),
  };
}

function mergeRegistries(
  base: EntityRegistry,
  extra: {
    steps?: ServiceDefinition["steps"];
    fees?: NonNullable<ServiceDefinition["fees"]>;
  },
): EntityRegistry {
  const merged: EntityRegistry = {
    fieldNames: new Set(base.fieldNames),
    stepIds: new Set(base.stepIds),
    stateIds: new Set(base.stateIds),
    feeIds: new Set(base.feeIds),
    apiIds: new Set(base.apiIds),
  };

  for (const fee of extra.fees ?? []) {
    merged.feeIds.add(fee.id);
  }
  for (const step of extra.steps ?? []) {
    merged.stepIds.add(step.id);
    for (const apiId of step.apiIds ?? []) {
      merged.apiIds.add(apiId);
    }
  }

  return merged;
}

function validateFieldReference(
  errors: ValidationError[],
  registry: EntityRegistry,
  path: string,
  field: string,
): void {
  if (!registry.fieldNames.has(field)) {
    pushError(
      errors,
      "REFERENTIAL_INTEGRITY",
      path,
      `Unknown field reference "${field}"`,
    );
  }
}

function validateApiReference(
  errors: ValidationError[],
  registry: EntityRegistry,
  path: string,
  check: string,
): void {
  if (!registry.apiIds.has(check)) {
    pushError(
      errors,
      "REFERENTIAL_INTEGRITY",
      path,
      `Unknown api check reference "${check}"`,
    );
  }
}

function validatePredicate(
  errors: ValidationError[],
  registry: EntityRegistry,
  predicate: Predicate,
  path: string,
): void {
  switch (predicate.kind) {
    case "always":
      return;
    case "fieldEquals":
    case "fieldCompare":
    case "fieldPresent":
      validateFieldReference(errors, registry, `${path}.field`, predicate.field);
      return;
    case "apiCheck":
      validateApiReference(errors, registry, `${path}.check`, predicate.check);
      return;
    case "and":
    case "or":
      predicate.of.forEach((child, index) => {
        validatePredicate(errors, registry, child, `${path}.of[${index}]`);
      });
      return;
    case "not":
      validatePredicate(errors, registry, predicate.of, `${path}.of`);
      return;
    default:
      assertNever(predicate);
  }
}

function validateRule(
  errors: ValidationError[],
  registry: EntityRegistry,
  rule: Rule,
  path: string,
): void {
  validatePredicate(errors, registry, rule.cause, `${path}.cause`);
  rule.conditions.forEach((condition, index) => {
    validatePredicate(errors, registry, condition, `${path}.conditions[${index}]`);
  });
  rule.impediments.forEach((impediment, index) => {
    validatePredicate(errors, registry, impediment, `${path}.impediments[${index}]`);
  });
}

function validateStepReferences(
  errors: ValidationError[],
  registry: EntityRegistry,
  step: ServiceDefinition["steps"][number],
  path: string,
): void {
  for (const [index, fieldName] of (step.fieldNames ?? []).entries()) {
    if (!registry.fieldNames.has(fieldName)) {
      pushError(
        errors,
        "REFERENTIAL_INTEGRITY",
        `${path}.fieldNames[${index}]`,
        `Unknown field reference "${fieldName}"`,
      );
    }
  }

  for (const [index, feeId] of (step.feeIds ?? []).entries()) {
    if (!registry.feeIds.has(feeId)) {
      pushError(
        errors,
        "REFERENTIAL_INTEGRITY",
        `${path}.feeIds[${index}]`,
        `Unknown fee reference "${feeId}"`,
      );
    }
  }
}

function validateTransitionReferences(
  errors: ValidationError[],
  registry: EntityRegistry,
  transition: ServiceDefinition["transitions"][number],
  path: string,
): void {
  if (!registry.stateIds.has(transition.from)) {
    pushError(
      errors,
      "REFERENTIAL_INTEGRITY",
      `${path}.from`,
      `Unknown state reference "${transition.from}"`,
    );
  }
  if (!registry.stateIds.has(transition.to)) {
    pushError(
      errors,
      "REFERENTIAL_INTEGRITY",
      `${path}.to`,
      `Unknown state reference "${transition.to}"`,
    );
  }
  if (transition.stepId !== undefined && !registry.stepIds.has(transition.stepId)) {
    pushError(
      errors,
      "REFERENTIAL_INTEGRITY",
      `${path}.stepId`,
      `Unknown step reference "${transition.stepId}"`,
    );
  }
  validateRule(errors, registry, transition.guard, `${path}.guard`);
}

function validateConcession(
  errors: ValidationError[],
  baseRegistry: EntityRegistry,
  concession: Concession,
  index: number,
): void {
  const path = `concessions[${index}]`;
  validatePredicate(
    errors,
    baseRegistry,
    concession.appliesWhen,
    `${path}.appliesWhen`,
  );

  const overrideRegistry = mergeRegistries(baseRegistry, {
    fees: concession.overrides.fees,
    steps: concession.overrides.steps,
  });

  concession.overrides.steps?.forEach((step, stepIndex) => {
    validateStepReferences(
      errors,
      overrideRegistry,
      step,
      `${path}.overrides.steps[${stepIndex}]`,
    );
  });

  concession.overrides.transitions?.forEach((transition, transitionIndex) => {
    validateTransitionReferences(
      errors,
      overrideRegistry,
      transition,
      `${path}.overrides.transitions[${transitionIndex}]`,
    );
  });
}

function collectReferentialIntegrityErrors(
  def: ServiceDefinition,
  errors: ValidationError[],
): void {
  const registry = buildRegistry(def);

  if (!registry.stateIds.has(def.initialStateId)) {
    pushError(
      errors,
      "REFERENTIAL_INTEGRITY",
      "initialStateId",
      `Unknown state reference "${def.initialStateId}"`,
    );
  }

  def.steps.forEach((step, index) => {
    validateStepReferences(errors, registry, step, `steps[${index}]`);
  });

  def.transitions.forEach((transition, index) => {
    validateTransitionReferences(errors, registry, transition, `transitions[${index}]`);
  });

  def.concessions?.forEach((concession, index) => {
    validateConcession(errors, registry, concession, index);
  });
}

function collectCompletenessErrors(
  def: ServiceDefinition,
  errors: ValidationError[],
): void {
  if (!def.states.some((state) => state.id === def.initialStateId)) {
    pushError(
      errors,
      "COMPLETENESS",
      "initialStateId",
      `Initial state "${def.initialStateId}" is not declared`,
    );
  }

  def.steps.forEach((step, index) => {
    if (step.kind === "PAYMENT" && (step.feeIds?.length ?? 0) < 1) {
      pushError(
        errors,
        "COMPLETENESS",
        `steps[${index}].feeIds`,
        `PAYMENT step "${step.id}" must reference at least one fee`,
      );
    }
    if (step.kind === "APPROVAL" && (step.approverRoleIds?.length ?? 0) < 1) {
      pushError(
        errors,
        "COMPLETENESS",
        `steps[${index}].approverRoleIds`,
        `APPROVAL step "${step.id}" must list at least one approver`,
      );
    }
  });
}

function collectReachabilityErrors(
  def: ServiceDefinition,
  errors: ValidationError[],
): void {
  const reachable = new Set<string>([def.initialStateId]);
  const queue = [def.initialStateId];

  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) {
      continue;
    }
    for (const transition of def.transitions) {
      if (transition.from === current && !reachable.has(transition.to)) {
        reachable.add(transition.to);
        queue.push(transition.to);
      }
    }
  }

  for (const state of def.states) {
    if (state.id !== def.initialStateId && !reachable.has(state.id)) {
      pushError(
        errors,
        "REACHABILITY",
        `states[${state.id}]`,
        `State "${state.id}" is not reachable from the initial state`,
      );
    }
  }

  const terminalReachable = def.states.some(
    (state) => state.isTerminal && reachable.has(state.id),
  );
  if (!terminalReachable) {
    pushError(
      errors,
      "REACHABILITY",
      "states",
      "No terminal state is reachable from the initial state",
    );
  }
}

export function compile(def: unknown): CompileResult {
  const parsed = ServiceDefinitionSchema.safeParse(def);
  if (!parsed.success) {
    return { ok: false, errors: schemaErrors(parsed.error) };
  }

  const errors: ValidationError[] = [];
  collectReferentialIntegrityErrors(parsed.data, errors);
  collectCompletenessErrors(parsed.data, errors);
  collectReachabilityErrors(parsed.data, errors);

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return { ok: true };
}
