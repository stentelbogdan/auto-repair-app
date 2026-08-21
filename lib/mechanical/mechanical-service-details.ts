import {
  isMechanicalCategoryId,
  type MechanicalCategoryId,
} from "@/lib/mechanical/mechanical-categories";

export type MechanicalServiceDetails = {
  version: 1;
  kind: "mechanical";
  category: MechanicalCategoryId;
  symptomIds: string[];
};

export function isMechanicalServiceDetails(
  value: unknown,
): value is MechanicalServiceDetails {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const details = value as Record<string, unknown>;

  return (
    details.version === 1 &&
    details.kind === "mechanical" &&
    typeof details.category === "string" &&
    isMechanicalCategoryId(details.category) &&
    Array.isArray(details.symptomIds) &&
    details.symptomIds.every((symptomId) => typeof symptomId === "string")
  );
}
