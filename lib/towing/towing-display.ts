import { isTowingServiceDetailsV1 } from "@/lib/towing/towing-service-details";

export type TowingDisplayLocation = {
  address: string;
  city: string;
};

export type TowingDisplaySummary = {
  pickup: TowingDisplayLocation;
  destination: TowingDisplayLocation;
  reasonLabel: string;
  startsLabel: string;
  canBePushedLabel: string;
  wheelsLabel: string;
};

const reasonLabels = {
  breakdown: "Defecțiune",
  accident: "Accident",
  flat_tire: "Pană",
  other: "Altul",
} as const;

const wheelStateLabels = {
  free: "Roți libere",
  blocked: "Roți blocate",
  unknown: "Nu se știe",
} as const;

export function getTowingDisplaySummary(
  serviceDetails: unknown,
): TowingDisplaySummary | undefined {
  if (!isTowingServiceDetailsV1(serviceDetails)) return undefined;

  return {
    pickup: serviceDetails.pickup,
    destination: serviceDetails.destination,
    reasonLabel: reasonLabels[serviceDetails.reason],
    startsLabel: serviceDetails.vehicleCondition.starts
      ? "Pornește"
      : "Nu pornește",
    canBePushedLabel: serviceDetails.vehicleCondition.canBePushed
      ? "Poate fi împinsă"
      : "Nu poate fi împinsă",
    wheelsLabel: wheelStateLabels[serviceDetails.vehicleCondition.wheels],
  };
}
