// ---------- localization ----------
export type Localized = { ar: string; en: string };

// ---------- closed capability registry ----------
export type StepKind =
  | "IDENTITY"
  | "FORM"
  | "UPLOAD"
  | "PAYMENT"
  | "APPROVAL"
  | "FEES"
  | "DETAILS";

// ---------- fields (closed type set) ----------
export type FieldType =
  | "text"
  | "email"
  | "number"
  | "phone"
  | "date"
  | "textarea"
  | "select"
  | "file";

export type FieldDef = {
  name: string;
  label: Localized;
  type: FieldType;
  required: boolean;
  options?: { value: string; label: Localized }[];
  validation?: {
    regex?: string;
    min?: number;
    max?: number;
    maxFileSizeBytes?: number;
    accept?: string[];
  };
};

// ---------- predicates ----------
export type Predicate =
  | { kind: "always" }
  | { kind: "fieldEquals"; field: string; value: string | number | boolean }
  | {
      kind: "fieldCompare";
      field: string;
      op: ">" | ">=" | "<" | "<=" | "!=" | "==";
      value: number;
    }
  | { kind: "fieldPresent"; field: string }
  | { kind: "apiCheck"; check: string }
  | { kind: "and"; of: Predicate[] }
  | { kind: "or"; of: Predicate[] }
  | { kind: "not"; of: Predicate };

// ---------- Rule = khitab al-wad' structure ----------
export type Rule = {
  id: string;
  cause: Predicate;
  conditions: Predicate[];
  impediments: Predicate[];
};

// ---------- validity dimension ----------
export type Validity = "VALID" | "CURABLE" | "VOID";

// ---------- steps ----------
export type StepDef = {
  id: string;
  kind: StepKind;
  title: Localized;
  isOptional: boolean;
  estimatedMinutes: number;
  fieldNames?: string[];
  apiIds?: string[];
  approverRoleIds?: string[];
  requiresSignature?: boolean;
  feeIds?: string[];
};

// ---------- guarded state machine ----------
export type StateDef = {
  id: string;
  status: Localized;
  statusCode: string;
  isTerminal: boolean;
};

export type TransitionDef = {
  id: string;
  from: string;
  to: string;
  stepId?: string;
  guard: Rule;
  setValidity?: Validity;
};

// ---------- concession ----------
export type Concession = {
  id: string;
  label: Localized;
  appliesWhen: Predicate;
};

// ---------- fees ----------
export type FeeDef = { id: string; name: Localized; amount: number; currency: "JOD" };

// ---------- the IR root ----------
export type ServiceDefinition = {
  id: string;
  code: string;
  names: Localized;
  entityId: string;
  departmentId: string;
  beneficiaryTypeIds: string[];
  fields: FieldDef[];
  steps: StepDef[];
  states: StateDef[];
  initialStateId: string;
  transitions: TransitionDef[];
  fees?: FeeDef[];
  concessions?: Concession[];
};
