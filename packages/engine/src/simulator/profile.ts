import type { Validity } from "../ir/types.js";

export type SyntheticApplicant = {
  name: string;
  fields: Record<string, string | number | boolean | undefined>;
  apiResults: Record<string, boolean>;
  expectedFinalStatusCode?: string;
  expectedValidity?: Validity;
};
