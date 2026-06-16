import type { Validity } from "../ir/types.js";

export type ApplicationState = {
  stateId: string;
  validity: Validity;
  fields: Record<string, string | number | boolean | undefined>;
  apiResults: Record<string, boolean>;
};
