export type TowingTrackingPhase = "to_pickup";

export type TowingLiveLocationRow = {
  request_id: string;
  appointment_id: string;
  workshop_id: string;
  latitude: number | null;
  longitude: number | null;
  accuracy_meters: number | null;
  heading_degrees: number | null;
  speed_mps: number | null;
  phase: TowingTrackingPhase;
  is_active: boolean;
  position_updated_at: string | null;
  live_distance_to_pickup_meters: number | null;
  live_duration_to_pickup_seconds: number | null;
  live_eta_calculated_at: string | null;
  live_eta_origin_latitude: number | null;
  live_eta_origin_longitude: number | null;
  created_at: string;
  updated_at: string;
};

export type TowingLiveCoordinate = {
  lat: number;
  lng: number;
};

const LIVE_ETA_STALE_AFTER_MS = 120_000;
const distanceKilometersFormatter = new Intl.NumberFormat("ro-RO", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

export function formatTowingLiveEta(
  row: TowingLiveLocationRow | null,
  now: number,
) {
  if (!row || !row.is_active || row.phase !== "to_pickup") return null;

  const distanceMeters = row.live_distance_to_pickup_meters;
  const durationSeconds = row.live_duration_to_pickup_seconds;
  const calculatedAt = row.live_eta_calculated_at
    ? Date.parse(row.live_eta_calculated_at)
    : Number.NaN;

  if (
    typeof distanceMeters !== "number" ||
    !Number.isFinite(distanceMeters) ||
    distanceMeters < 0 ||
    typeof durationSeconds !== "number" ||
    !Number.isFinite(durationSeconds) ||
    durationSeconds < 0 ||
    !Number.isFinite(calculatedAt) ||
    now - calculatedAt > LIVE_ETA_STALE_AFTER_MS
  ) {
    return null;
  }

  const distanceLabel =
    distanceMeters < 100
      ? "<100 m"
      : distanceMeters < 1_000
        ? `${Math.round(distanceMeters)} m`
        : `${distanceKilometersFormatter.format(distanceMeters / 1_000)} km`;
  const durationLabel =
    durationSeconds < 60
      ? "<1 min"
      : `${Math.max(1, Math.round(durationSeconds / 60))} min`;

  return `${durationLabel} · ${distanceLabel} până la preluare`;
}

export function isValidTowingCoordinate(
  value: unknown,
): value is TowingLiveCoordinate {
  if (typeof value !== "object" || value === null) return false;

  const coordinate = value as Record<string, unknown>;

  return (
    typeof coordinate.lat === "number" &&
    Number.isFinite(coordinate.lat) &&
    coordinate.lat >= -90 &&
    coordinate.lat <= 90 &&
    typeof coordinate.lng === "number" &&
    Number.isFinite(coordinate.lng) &&
    coordinate.lng >= -180 &&
    coordinate.lng <= 180
  );
}
