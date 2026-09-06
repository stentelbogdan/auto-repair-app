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
  route?: {
    distanceMeters: number;
    durationSeconds: number;
    distanceLabel: string;
    durationLabel: string;
  };
};

type TowingRouteEstimate = {
  distanceMeters: number;
  durationSeconds: number;
};

const distanceFormatter = new Intl.NumberFormat("ro-RO", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

function capitalizeDisplayValue(value: string) {
  const trimmed = value.trim();
  const letterIndex = trimmed.search(/\p{L}/u);

  if (letterIndex < 0) return trimmed;

  const [firstLetter] = Array.from(trimmed.slice(letterIndex));
  if (!firstLetter) return trimmed;

  return (
    trimmed.slice(0, letterIndex) +
    firstLetter.toUpperCase() +
    trimmed.slice(letterIndex + firstLetter.length)
  );
}

export function formatTowingRouteDistance(distanceMeters: number) {
  return `${distanceFormatter.format(distanceMeters / 1000)} km`;
}

export function formatTowingRouteDuration(durationSeconds: number) {
  const roundedMinutes = Math.round(durationSeconds / 60);
  const hours = Math.floor(roundedMinutes / 60);
  const minutes = roundedMinutes % 60;

  if (hours === 0) return `${minutes} min`;
  return minutes === 0 ? `${hours} h` : `${hours} h ${minutes} min`;
}

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
  routeEstimate?: TowingRouteEstimate | null,
): TowingDisplaySummary | undefined {
  if (!isTowingServiceDetailsV1(serviceDetails)) return undefined;

  const hasValidRoute =
    routeEstimate !== null &&
    routeEstimate !== undefined &&
    Number.isFinite(routeEstimate.distanceMeters) &&
    routeEstimate.distanceMeters >= 0 &&
    Number.isFinite(routeEstimate.durationSeconds) &&
    routeEstimate.durationSeconds >= 0;

  return {
    pickup: {
      address: capitalizeDisplayValue(serviceDetails.pickup.address),
      city: capitalizeDisplayValue(serviceDetails.pickup.city),
    },
    destination: {
      address: capitalizeDisplayValue(serviceDetails.destination.address),
      city: capitalizeDisplayValue(serviceDetails.destination.city),
    },
    reasonLabel: reasonLabels[serviceDetails.reason],
    startsLabel: serviceDetails.vehicleCondition.starts
      ? "Pornește"
      : "Nu pornește",
    canBePushedLabel: serviceDetails.vehicleCondition.canBePushed
      ? "Poate fi împinsă"
      : "Nu poate fi împinsă",
    wheelsLabel: wheelStateLabels[serviceDetails.vehicleCondition.wheels],
    route: hasValidRoute
      ? {
          ...routeEstimate,
          distanceLabel: formatTowingRouteDistance(
            routeEstimate.distanceMeters,
          ),
          durationLabel: formatTowingRouteDuration(
            routeEstimate.durationSeconds,
          ),
        }
      : undefined,
  };
}
