import { z } from "zod";
import type {
  Concession,
  FieldDef,
  FeeDef,
  Predicate,
  Rule,
  ServiceDefinition,
  StateDef,
  StepDef,
  TransitionDef,
} from "./types.js";

export const LocalizedSchema = z.object({
  ar: z.string().min(1),
  en: z.string().min(1),
});

export const StepKindSchema = z.enum([
  "IDENTITY",
  "FORM",
  "UPLOAD",
  "PAYMENT",
  "APPROVAL",
  "FEES",
  "DETAILS",
]);

export const FieldTypeSchema = z.enum([
  "text",
  "email",
  "number",
  "phone",
  "date",
  "textarea",
  "select",
  "file",
]);

export const FieldDefSchema: z.ZodType<FieldDef> = z.object({
  name: z.string().min(1),
  label: LocalizedSchema,
  type: FieldTypeSchema,
  required: z.boolean(),
  options: z
    .array(
      z.object({
        value: z.string(),
        label: LocalizedSchema,
      }),
    )
    .optional(),
  validation: z
    .object({
      regex: z.string().optional(),
      min: z.number().optional(),
      max: z.number().optional(),
      maxFileSizeBytes: z.number().optional(),
      accept: z.array(z.string()).optional(),
    })
    .optional(),
});

export const PredicateSchema: z.ZodType<Predicate> = z.lazy(() =>
  z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("always") }),
    z.object({
      kind: z.literal("fieldEquals"),
      field: z.string(),
      value: z.union([z.string(), z.number(), z.boolean()]),
    }),
    z.object({
      kind: z.literal("fieldCompare"),
      field: z.string(),
      op: z.enum([">", ">=", "<", "<=", "!=", "=="]),
      value: z.number(),
    }),
    z.object({
      kind: z.literal("fieldPresent"),
      field: z.string(),
    }),
    z.object({
      kind: z.literal("apiCheck"),
      check: z.string(),
    }),
    z.object({
      kind: z.literal("and"),
      of: z.array(PredicateSchema),
    }),
    z.object({
      kind: z.literal("or"),
      of: z.array(PredicateSchema),
    }),
    z.object({
      kind: z.literal("not"),
      of: PredicateSchema,
    }),
  ]),
);

export const RuleSchema: z.ZodType<Rule> = z.object({
  id: z.string().min(1),
  cause: PredicateSchema,
  conditions: z.array(PredicateSchema),
  impediments: z.array(PredicateSchema),
});

export const ValiditySchema = z.enum(["VALID", "CURABLE", "VOID"]);

export const StepDefSchema: z.ZodType<StepDef> = z.object({
  id: z.string().min(1),
  kind: StepKindSchema,
  title: LocalizedSchema,
  isOptional: z.boolean(),
  estimatedMinutes: z.number().nonnegative(),
  fieldNames: z.array(z.string()).optional(),
  apiIds: z.array(z.string()).optional(),
  approverRoleIds: z.array(z.string()).optional(),
  requiresSignature: z.boolean().optional(),
  feeIds: z.array(z.string()).optional(),
});

export const StateDefSchema: z.ZodType<StateDef> = z.object({
  id: z.string().min(1),
  status: LocalizedSchema,
  statusCode: z.string().min(1),
  isTerminal: z.boolean(),
});

export const TransitionDefSchema: z.ZodType<TransitionDef> = z.object({
  id: z.string().min(1),
  from: z.string().min(1),
  to: z.string().min(1),
  stepId: z.string().optional(),
  guard: RuleSchema,
  setValidity: ValiditySchema.optional(),
});

export const FeeDefSchema: z.ZodType<FeeDef> = z.object({
  id: z.string().min(1),
  name: LocalizedSchema,
  amount: z.number().nonnegative(),
  currency: z.literal("JOD"),
});

export const ConcessionSchema: z.ZodType<Concession> = z.object({
  id: z.string().min(1),
  label: LocalizedSchema,
  appliesWhen: PredicateSchema,
  overrides: z.object({
    fees: z.array(FeeDefSchema).optional(),
    steps: z.array(StepDefSchema).optional(),
    transitions: z.array(TransitionDefSchema).optional(),
  }),
});

export const ServiceDefinitionSchema: z.ZodType<ServiceDefinition> = z.object({
  id: z.string().min(1),
  code: z.string().min(1),
  names: LocalizedSchema,
  entityId: z.string().min(1),
  departmentId: z.string().min(1),
  beneficiaryTypeIds: z.array(z.string()).min(1),
  fields: z.array(FieldDefSchema),
  steps: z.array(StepDefSchema).min(1),
  states: z.array(StateDefSchema).min(1),
  initialStateId: z.string().min(1),
  transitions: z.array(TransitionDefSchema),
  fees: z.array(FeeDefSchema).optional(),
  concessions: z.array(ConcessionSchema).optional(),
});

export function parseServiceDefinition(input: unknown): ServiceDefinition {
  return ServiceDefinitionSchema.parse(input);
}
