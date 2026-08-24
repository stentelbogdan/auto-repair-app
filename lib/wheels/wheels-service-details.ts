export const WHEEL_POSITIONS = [
  { id: "front_left", label: "Față stânga" },
  { id: "front_right", label: "Față dreapta" },
  { id: "rear_left", label: "Spate stânga" },
  { id: "rear_right", label: "Spate dreapta" },
] as const;

export const WHEEL_ISSUES = [
  { id: "pressure_loss", label: "Pierdere de presiune" },
  { id: "puncture", label: "Pană" },
  { id: "tire_wear", label: "Anvelopă uzată" },
  { id: "uneven_tire_wear", label: "Uzură neuniformă" },
  { id: "sidewall_damage", label: "Flanc deteriorat" },
  { id: "tire_replacement", label: "Înlocuire anvelopă" },
  { id: "bent_rim", label: "Jantă îndoită" },
  { id: "cracked_rim", label: "Jantă fisurată" },
  { id: "scratched_rim", label: "Jantă zgâriată" },
  { id: "rim_corrosion", label: "Coroziune jantă" },
] as const;

export const WHEEL_GENERAL_ISSUES = [
  { id: "driving_vibration", label: "Vibrații în mers" },
  { id: "pulls_side", label: "Mașina trage într-o parte" },
  { id: "steering_off_center", label: "Volan necentrat" },
  { id: "tpms_warning", label: "Martor presiune anvelope" },
] as const;

export const WHEEL_SERVICES = [
  { id: "seasonal_change", label: "Schimb sezonier" },
  { id: "tire_mounting", label: "Montare anvelope" },
  { id: "wheel_balancing", label: "Echilibrare roți" },
  { id: "wheel_alignment", label: "Geometrie roți" },
  { id: "wheel_rotation", label: "Rotire anvelope" },
  { id: "rim_refurbishment", label: "Recondiționare jante" },
  { id: "tpms_service", label: "Service TPMS" },
] as const;

export type WheelPositionId = (typeof WHEEL_POSITIONS)[number]["id"];
export type WheelIssueId = (typeof WHEEL_ISSUES)[number]["id"];
export type WheelGeneralIssueId =
  (typeof WHEEL_GENERAL_ISSUES)[number]["id"];
export type WheelServiceId = (typeof WHEEL_SERVICES)[number]["id"];

export type WheelsServiceDetails = {
  version: 1;
  kind: "wheels";
  selectedWheels: WheelPositionId[];
  issuesByWheel: Partial<Record<WheelPositionId, WheelIssueId[]>>;
  generalIssues: WheelGeneralIssueId[];
  services: WheelServiceId[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function filterCanonicalIds<T extends string>(
  values: unknown,
  canonicalIds: readonly T[],
): T[] {
  if (!Array.isArray(values)) return [];

  const selectedIds = new Set(
    values.filter((value): value is string => typeof value === "string"),
  );

  return canonicalIds.filter((id) => selectedIds.has(id));
}

const wheelPositionIds = WHEEL_POSITIONS.map(({ id }) => id);
const wheelIssueIds = WHEEL_ISSUES.map(({ id }) => id);
const wheelGeneralIssueIds = WHEEL_GENERAL_ISSUES.map(({ id }) => id);
const wheelServiceIds = WHEEL_SERVICES.map(({ id }) => id);

export function normalizeWheelsServiceDetails(
  value: unknown,
): WheelsServiceDetails | null {
  if (!isRecord(value) || value.version !== 1 || value.kind !== "wheels") {
    return null;
  }

  if (
    !Array.isArray(value.selectedWheels) ||
    !isRecord(value.issuesByWheel) ||
    !Array.isArray(value.generalIssues) ||
    !Array.isArray(value.services)
  ) {
    return null;
  }

  const issuesByWheel: WheelsServiceDetails["issuesByWheel"] = {};

  for (const positionId of wheelPositionIds) {
    const issues = filterCanonicalIds(
      value.issuesByWheel[positionId],
      wheelIssueIds,
    );

    if (issues.length > 0) {
      issuesByWheel[positionId] = issues;
    }
  }

  return {
    version: 1,
    kind: "wheels",
    selectedWheels: filterCanonicalIds(
      value.selectedWheels,
      wheelPositionIds,
    ),
    issuesByWheel,
    generalIssues: filterCanonicalIds(
      value.generalIssues,
      wheelGeneralIssueIds,
    ),
    services: filterCanonicalIds(value.services, wheelServiceIds),
  };
}

export function isWheelsServiceDetails(
  value: unknown,
): value is WheelsServiceDetails {
  if (!isRecord(value) || value.version !== 1 || value.kind !== "wheels") {
    return false;
  }

  if (
    !Array.isArray(value.selectedWheels) ||
    !isRecord(value.issuesByWheel) ||
    !Array.isArray(value.generalIssues) ||
    !Array.isArray(value.services)
  ) {
    return false;
  }

  const hasOnlyKnownIds = (values: unknown, knownIds: readonly string[]) =>
    Array.isArray(values) &&
    values.every(
      (item) => typeof item === "string" && knownIds.includes(item),
    );

  return (
    hasOnlyKnownIds(value.selectedWheels, wheelPositionIds) &&
    Object.entries(value.issuesByWheel).every(
      ([positionId, issues]) =>
        wheelPositionIds.includes(positionId as WheelPositionId) &&
        hasOnlyKnownIds(issues, wheelIssueIds),
    ) &&
    hasOnlyKnownIds(value.generalIssues, wheelGeneralIssueIds) &&
    hasOnlyKnownIds(value.services, wheelServiceIds)
  );
}
