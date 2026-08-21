import {
  isMechanicalCategoryId,
  type MechanicalCategoryId,
} from "@/lib/mechanical/mechanical-categories";

export type MechanicalCategorySelection = {
  category: MechanicalCategoryId;
  symptomIds: string[];
};

export type LegacyMechanicalServiceDetails = {
  version: 1;
  kind: "mechanical";
  category: MechanicalCategoryId;
  symptomIds: string[];
};

export type MechanicalServiceDetails = {
  version: 2;
  kind: "mechanical";
  selections: MechanicalCategorySelection[];
};

export type SupportedMechanicalServiceDetails =
  | LegacyMechanicalServiceDetails
  | MechanicalServiceDetails;

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.every((item) => typeof item === "string")
  );
}

function isMechanicalCategorySelection(
  value: unknown,
): value is MechanicalCategorySelection {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const selection = value as Record<string, unknown>;

  return (
    typeof selection.category === "string" &&
    isMechanicalCategoryId(selection.category) &&
    isStringArray(selection.symptomIds)
  );
}

export function isMechanicalServiceDetails(
  value: unknown,
): value is SupportedMechanicalServiceDetails {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const details = value as Record<string, unknown>;

  if (details.kind !== "mechanical") {
    return false;
  }

  if (details.version === 1) {
    return (
      typeof details.category === "string" &&
      isMechanicalCategoryId(details.category) &&
      isStringArray(details.symptomIds)
    );
  }

  return (
    details.version === 2 &&
    Array.isArray(details.selections) &&
    details.selections.every(isMechanicalCategorySelection)
  );
}

export function normalizeMechanicalServiceDetails(
  value: unknown,
): MechanicalServiceDetails | null {
  if (!isMechanicalServiceDetails(value)) {
    return null;
  }

  if (value.version === 2) {
    return value;
  }

  return {
    version: 2,
    kind: "mechanical",
    selections: [
      {
        category: value.category,
        symptomIds: value.symptomIds,
      },
    ],
  };
}
