export const WHEEL_POSITIONS = [
  { id: "front_left", label: "Față stânga" },
  { id: "front_right", label: "Față dreapta" },
  { id: "rear_left", label: "Spate stânga" },
  { id: "rear_right", label: "Spate dreapta" },
] as const;

export const TIRE_SERVICES = [
  { id: "puncture", label: "Pană" },
  { id: "replace_tire", label: "Schimb anvelopă" },
  { id: "mount_dismount", label: "Montaj / demontaj" },
  { id: "balance", label: "Echilibrare" },
] as const;

export const RIM_SERVICES = [
  { id: "replace_rim", label: "Schimbare jantă" },
  { id: "refinish_rim", label: "Recondiționare / vopsire" },
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
export type WheelComponentId = "tire" | "rim";
export type WheelComponentSelection = {
  wheel: WheelPositionId;
  component: WheelComponentId;
};
export type TireServiceId = (typeof TIRE_SERVICES)[number]["id"];
export type RimServiceId = (typeof RIM_SERVICES)[number]["id"];
export type WheelComponentServiceId = TireServiceId | RimServiceId;
export type WheelComponentServiceSelection = WheelComponentSelection & {
  service: WheelComponentServiceId;
};
export type WheelIssueId = (typeof WHEEL_ISSUES)[number]["id"];
export type WheelGeneralIssueId =
  (typeof WHEEL_GENERAL_ISSUES)[number]["id"];
export type WheelServiceId = (typeof WHEEL_SERVICES)[number]["id"];

export type WheelsServiceDetailsV1 = {
  version: 1;
  kind: "wheels";
  selectedWheels: WheelPositionId[];
  issuesByWheel: Partial<Record<WheelPositionId, WheelIssueId[]>>;
  generalIssues: WheelGeneralIssueId[];
  services: WheelServiceId[];
};

export type WheelPartsSupply = "customer" | "workshop" | null;

export type WheelsServiceDetailsV2 = {
  version: 2;
  kind: "wheels";
  selections: Array<{
    wheel: WheelPositionId;
    components: Array<
      | { component: "tire"; services: TireServiceId[] }
      | { component: "rim"; services: RimServiceId[] }
    >;
  }>;
  wheelSize:
    | { known: false }
    | {
        known: true;
        width: number;
        profile: number;
        rimDiameter: number;
      };
  partsSupply: {
    tire: WheelPartsSupply;
    rim: WheelPartsSupply;
  };
};

export type WheelsServiceDetails =
  | WheelsServiceDetailsV1
  | WheelsServiceDetailsV2;

export type NormalizeWheelsServiceDetailsV2Input = {
  selectedServices: readonly WheelComponentServiceSelection[];
  tireWidth: string | number;
  tireProfile: string | number;
  rimDiameter: string | number;
  unknownWheelSize: boolean;
  tireSupply: WheelPartsSupply;
  rimSupply: WheelPartsSupply;
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
const tireServiceIds = TIRE_SERVICES.map(({ id }) => id);
const rimServiceIds = RIM_SERVICES.map(({ id }) => id);
const wheelPositionIdSet = new Set<string>(wheelPositionIds);
const tireServiceIdSet = new Set<string>(tireServiceIds);
const rimServiceIdSet = new Set<string>(rimServiceIds);
const wheelIssueIds = WHEEL_ISSUES.map(({ id }) => id);
const wheelGeneralIssueIds = WHEEL_GENERAL_ISSUES.map(({ id }) => id);
const wheelServiceIds = WHEEL_SERVICES.map(({ id }) => id);

function isWheelPositionId(value: unknown): value is WheelPositionId {
  return typeof value === "string" && wheelPositionIdSet.has(value);
}

function isTireServiceId(value: unknown): value is TireServiceId {
  return typeof value === "string" && tireServiceIdSet.has(value);
}

function isRimServiceId(value: unknown): value is RimServiceId {
  return typeof value === "string" && rimServiceIdSet.has(value);
}

function isWheelPartsSupply(value: unknown): value is WheelPartsSupply {
  return value === null || value === "customer" || value === "workshop";
}

function parseWheelSizeValue(value: string | number): number | null {
  if (typeof value === "string" && value.trim() === "") return null;

  const parsedValue = Number(value);

  return Number.isInteger(parsedValue) && parsedValue > 0
    ? parsedValue
    : null;
}

function hasCanonicalUniqueOrder<T extends string>(
  values: readonly T[],
  canonicalValues: readonly T[],
) {
  let previousIndex = -1;

  for (const value of values) {
    const index = canonicalValues.indexOf(value);

    if (index <= previousIndex) return false;
    previousIndex = index;
  }

  return true;
}

export function normalizeWheelsServiceDetailsV2(
  input: NormalizeWheelsServiceDetailsV2Input,
): WheelsServiceDetailsV2 | null {
  const selections: WheelsServiceDetailsV2["selections"] = [];

  for (const wheel of WHEEL_POSITIONS) {
    const components: WheelsServiceDetailsV2["selections"][number]["components"] =
      [];
    const tireServices = TIRE_SERVICES.filter(({ id }) =>
      input.selectedServices.some(
        (selection) =>
          selection.wheel === wheel.id &&
          selection.component === "tire" &&
          selection.service === id,
      ),
    ).map(({ id }) => id);
    const rimServices = RIM_SERVICES.filter(({ id }) =>
      input.selectedServices.some(
        (selection) =>
          selection.wheel === wheel.id &&
          selection.component === "rim" &&
          selection.service === id,
      ),
    ).map(({ id }) => id);

    if (tireServices.length > 0) {
      components.push({ component: "tire", services: tireServices });
    }

    if (rimServices.length > 0) {
      components.push({ component: "rim", services: rimServices });
    }

    if (components.length > 0) {
      selections.push({ wheel: wheel.id, components });
    }
  }

  let wheelSize: WheelsServiceDetailsV2["wheelSize"];

  if (input.unknownWheelSize) {
    wheelSize = { known: false };
  } else {
    const width = parseWheelSizeValue(input.tireWidth);
    const profile = parseWheelSizeValue(input.tireProfile);
    const parsedRimDiameter = parseWheelSizeValue(input.rimDiameter);

    if (width === null || profile === null || parsedRimDiameter === null) {
      return null;
    }

    wheelSize = {
      known: true,
      width,
      profile,
      rimDiameter: parsedRimDiameter,
    };
  }

  const hasReplaceTire = selections.some((selection) =>
    selection.components.some(
      (component) =>
        component.component === "tire" &&
        component.services.includes("replace_tire"),
    ),
  );
  const hasReplaceRim = selections.some((selection) =>
    selection.components.some(
      (component) =>
        component.component === "rim" &&
        component.services.includes("replace_rim"),
    ),
  );

  return {
    version: 2,
    kind: "wheels",
    selections,
    wheelSize,
    partsSupply: {
      tire:
        hasReplaceTire && isWheelPartsSupply(input.tireSupply)
          ? input.tireSupply
          : null,
      rim:
        hasReplaceRim && isWheelPartsSupply(input.rimSupply)
          ? input.rimSupply
          : null,
    },
  };
}

function normalizeWheelsServiceDetailsV1(
  value: unknown,
): WheelsServiceDetailsV1 | null {
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

  const issuesByWheel: WheelsServiceDetailsV1["issuesByWheel"] = {};

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

export function isWheelsServiceDetailsV1(
  value: unknown,
): value is WheelsServiceDetailsV1 {
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

export function isWheelsServiceDetailsV2(
  value: unknown,
): value is WheelsServiceDetailsV2 {
  if (!isRecord(value) || value.version !== 2 || value.kind !== "wheels") {
    return false;
  }

  if (
    !Array.isArray(value.selections) ||
    !isRecord(value.wheelSize) ||
    !isRecord(value.partsSupply) ||
    !isWheelPartsSupply(value.partsSupply.tire) ||
    !isWheelPartsSupply(value.partsSupply.rim)
  ) {
    return false;
  }

  if (value.wheelSize.known === true) {
    if (
      parseWheelSizeValue(value.wheelSize.width as string | number) !==
        value.wheelSize.width ||
      parseWheelSizeValue(value.wheelSize.profile as string | number) !==
        value.wheelSize.profile ||
      parseWheelSizeValue(value.wheelSize.rimDiameter as string | number) !==
        value.wheelSize.rimDiameter
    ) {
      return false;
    }
  } else if (value.wheelSize.known !== false) {
    return false;
  }

  let previousWheelIndex = -1;
  let hasReplaceTire = false;
  let hasReplaceRim = false;

  for (const selection of value.selections) {
    if (
      !isRecord(selection) ||
      !isWheelPositionId(selection.wheel) ||
      !Array.isArray(selection.components) ||
      selection.components.length === 0
    ) {
      return false;
    }

    const wheelIndex = wheelPositionIds.indexOf(selection.wheel);

    if (wheelIndex <= previousWheelIndex) return false;
    previousWheelIndex = wheelIndex;

    let previousComponentIndex = -1;

    for (const component of selection.components) {
      if (
        !isRecord(component) ||
        !Array.isArray(component.services) ||
        component.services.length === 0
      ) {
        return false;
      }

      const componentIndex =
        component.component === "tire"
          ? 0
          : component.component === "rim"
            ? 1
            : -1;

      if (componentIndex <= previousComponentIndex) return false;
      previousComponentIndex = componentIndex;

      if (component.component === "tire") {
        if (!component.services.every(isTireServiceId)) return false;
        if (!hasCanonicalUniqueOrder(component.services, tireServiceIds)) {
          return false;
        }
        hasReplaceTire ||= component.services.includes("replace_tire");
      } else {
        if (!component.services.every(isRimServiceId)) return false;
        if (!hasCanonicalUniqueOrder(component.services, rimServiceIds)) {
          return false;
        }
        hasReplaceRim ||= component.services.includes("replace_rim");
      }
    }
  }

  return (
    (hasReplaceTire || value.partsSupply.tire === null) &&
    (hasReplaceRim || value.partsSupply.rim === null)
  );
}

export function normalizeWheelsServiceDetails(
  value: unknown,
): WheelsServiceDetails | null {
  if (isWheelsServiceDetailsV2(value)) return value;
  return normalizeWheelsServiceDetailsV1(value);
}

export function isWheelsServiceDetails(
  value: unknown,
): value is WheelsServiceDetails {
  return isWheelsServiceDetailsV1(value) || isWheelsServiceDetailsV2(value);
}
