export const REPAIR_SERVICE_TYPES = [
  "bodywork",
  "mechanical",
  "wheels",
] as const;

export type RepairServiceType = (typeof REPAIR_SERVICE_TYPES)[number];

export function isRepairServiceType(
  value: unknown,
): value is RepairServiceType {
  return REPAIR_SERVICE_TYPES.some((serviceType) => serviceType === value);
}

export function resolveRepairServiceType(
  value?: string | null,
): RepairServiceType | null {
  if (value === null || value === undefined || value.trim() === "") {
    return "bodywork";
  }

  return isRepairServiceType(value) ? value : null;
}
