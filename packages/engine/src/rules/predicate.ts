import type { Predicate } from "../ir/types.js";
import { assertNever } from "./assertNever.js";

export type EvalContext = {
  fields: Record<string, string | number | boolean | undefined>;
  apiResults: Record<string, boolean>;
};

function readField(
  ctx: EvalContext,
  field: string,
): string | number | boolean | undefined {
  return ctx.fields[field];
}

function readApiCheck(ctx: EvalContext, check: string): boolean {
  // Missing apiResults keys are treated as false (caller must supply results explicitly).
  return ctx.apiResults[check] ?? false;
}

export function describePredicate(predicate: Predicate): string {
  switch (predicate.kind) {
    case "always":
      return "always";
    case "fieldEquals":
      return `fieldEquals(${predicate.field} == ${JSON.stringify(predicate.value)})`;
    case "fieldCompare":
      return `fieldCompare(${predicate.field} ${predicate.op} ${predicate.value})`;
    case "fieldPresent":
      return `fieldPresent(${predicate.field})`;
    case "apiCheck":
      return `apiCheck(${predicate.check})`;
    case "and":
      return `and(${predicate.of.map(describePredicate).join(", ")})`;
    case "or":
      return `or(${predicate.of.map(describePredicate).join(", ")})`;
    case "not":
      return `not(${describePredicate(predicate.of)})`;
    default:
      return assertNever(predicate);
  }
}

export function evalPredicate(predicate: Predicate, ctx: EvalContext): boolean {
  switch (predicate.kind) {
    case "always":
      return true;
    case "fieldEquals": {
      const actual = readField(ctx, predicate.field);
      return actual === predicate.value;
    }
    case "fieldCompare": {
      const raw = readField(ctx, predicate.field);
      if (typeof raw !== "number") {
        return false;
      }
      const value = raw;
      switch (predicate.op) {
        case ">":
          return value > predicate.value;
        case ">=":
          return value >= predicate.value;
        case "<":
          return value < predicate.value;
        case "<=":
          return value <= predicate.value;
        case "!=":
          return value !== predicate.value;
        case "==":
          return value === predicate.value;
        default:
          return assertNever(predicate.op);
      }
    }
    case "fieldPresent": {
      const value = readField(ctx, predicate.field);
      return value !== undefined && value !== "";
    }
    case "apiCheck":
      return readApiCheck(ctx, predicate.check);
    case "and":
      return predicate.of.every((child) => evalPredicate(child, ctx));
    case "or":
      return predicate.of.some((child) => evalPredicate(child, ctx));
    case "not":
      return !evalPredicate(predicate.of, ctx);
    default:
      return assertNever(predicate);
  }
}
