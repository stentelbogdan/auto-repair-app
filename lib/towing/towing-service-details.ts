export const TOWING_REASONS = [
  "breakdown",
  "accident",
  "flat_tire",
  "other",
] as const;

export const TOWING_WHEEL_STATES = ["free", "blocked", "unknown"] as const;

export type TowingReason = (typeof TOWING_REASONS)[number];
export type TowingWheelState = (typeof TOWING_WHEEL_STATES)[number];

export type TowingServiceDetailsV1 = {
  version: 1;
  kind: "towing";
  pickup: {
    address: string;
    city: string;
  };
  destination: {
    address: string;
    city: string;
  };
  reason: TowingReason;
  vehicleCondition: {
    starts: boolean;
    canBePushed: boolean;
    wheels: TowingWheelState;
  };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function isTowingServiceDetailsV1(
  value: unknown,
): value is TowingServiceDetailsV1 {
  if (!isRecord(value) || value.version !== 1 || value.kind !== "towing") {
    return false;
  }

  const { pickup, destination, vehicleCondition } = value;

  if (
    !isRecord(pickup) ||
    !isNonEmptyString(pickup.address) ||
    !isNonEmptyString(pickup.city) ||
    !isRecord(destination) ||
    !isNonEmptyString(destination.address) ||
    !isNonEmptyString(destination.city) ||
    !TOWING_REASONS.some((reason) => reason === value.reason) ||
    !isRecord(vehicleCondition)
  ) {
    return false;
  }

  return (
    typeof vehicleCondition.starts === "boolean" &&
    typeof vehicleCondition.canBePushed === "boolean" &&
    TOWING_WHEEL_STATES.some(
      (wheelState) => wheelState === vehicleCondition.wheels,
    )
  );
}
