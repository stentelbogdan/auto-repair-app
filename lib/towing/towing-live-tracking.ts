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
  created_at: string;
  updated_at: string;
};

export type TowingLiveCoordinate = {
  lat: number;
  lng: number;
};

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
