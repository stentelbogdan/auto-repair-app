export type GeoapifyRoutePath = Array<[number, number]>;

type GeoapifyFeature = Record<string, unknown>;

export type GeoapifyRouteResult =
  | {
      status: "ok";
      distanceMeters: number;
      durationSeconds: number;
      paths: GeoapifyRoutePath[];
    }
  | { status: "not_configured" }
  | { status: "not_found" }
  | { status: "upstream_error" };

type GetGeoapifyRouteInput = {
  originLat: number;
  originLng: number;
  destinationLat: number;
  destinationLng: number;
  requirePaths?: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getRouteMetric(feature: GeoapifyFeature, key: "distance" | "time") {
  if (!isRecord(feature.properties)) return null;

  const value = feature.properties[key];
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

function normalizeRoutePoint(value: unknown): [number, number] | null {
  if (!Array.isArray(value) || value.length < 2) return null;

  const [lng, lat] = value;
  if (
    typeof lat !== "number" ||
    !Number.isFinite(lat) ||
    lat < -90 ||
    lat > 90 ||
    typeof lng !== "number" ||
    !Number.isFinite(lng) ||
    lng < -180 ||
    lng > 180
  ) {
    return null;
  }

  return [lat, lng];
}

function normalizeRoutePath(value: unknown): GeoapifyRoutePath {
  if (!Array.isArray(value)) return [];
  return value
    .map(normalizeRoutePoint)
    .filter((point): point is [number, number] => point !== null);
}

function getRoutePaths(feature: GeoapifyFeature) {
  if (!isRecord(feature.geometry) || !Array.isArray(feature.geometry.coordinates)) {
    return [];
  }

  const { coordinates, type } = feature.geometry;
  const paths =
    type === "LineString"
      ? [normalizeRoutePath(coordinates)]
      : type === "MultiLineString"
        ? coordinates.map(normalizeRoutePath)
        : [];

  return paths.filter((path) => path.length >= 2);
}

export async function getGeoapifyRoute({
  originLat,
  originLng,
  destinationLat,
  destinationLng,
  requirePaths = true,
}: GetGeoapifyRouteInput): Promise<GeoapifyRouteResult> {
  const apiKey = process.env.GEOAPIFY_API_KEY;
  if (!apiKey) return { status: "not_configured" };

  const url = new URL("https://api.geoapify.com/v1/routing");
  url.searchParams.set(
    "waypoints",
    `${originLat},${originLng}|${destinationLat},${destinationLng}`,
  );
  url.searchParams.set("mode", "light_truck");
  url.searchParams.set("units", "metric");
  url.searchParams.set("apiKey", apiKey);

  try {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) return { status: "upstream_error" };

    const payload: unknown = await response.json();
    if (!isRecord(payload) || !Array.isArray(payload.features)) {
      return { status: "upstream_error" };
    }

    const feature = payload.features.find(isRecord);
    if (!feature) return { status: "not_found" };

    const distanceMeters = getRouteMetric(feature, "distance");
    const durationSeconds = getRouteMetric(feature, "time");
    const paths = getRoutePaths(feature);
    if (
      distanceMeters === null ||
      durationSeconds === null ||
      (requirePaths && paths.length === 0)
    ) {
      return { status: "upstream_error" };
    }

    return { status: "ok", distanceMeters, durationSeconds, paths };
  } catch {
    return { status: "upstream_error" };
  }
}
