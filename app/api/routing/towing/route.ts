type GeoapifyFeature = Record<string, unknown>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getCoordinate(
  input: Record<string, unknown>,
  key: "pickupLat" | "pickupLng" | "destinationLat" | "destinationLng",
) {
  const value = input[key];
  const isLatitude = key.endsWith("Lat");
  const minimum = isLatitude ? -90 : -180;
  const maximum = isLatitude ? 90 : 180;

  return typeof value === "number" &&
    Number.isFinite(value) &&
    value >= minimum &&
    value <= maximum
    ? value
    : null;
}

function getRouteMetric(feature: GeoapifyFeature, key: "distance" | "time") {
  if (!isRecord(feature.properties)) return null;

  const value = feature.properties[key];
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

export async function POST(request: Request) {
  let input: unknown;

  try {
    input = await request.json();
  } catch {
    return Response.json({ error: "Coordonate invalide." }, { status: 400 });
  }

  if (!isRecord(input)) {
    return Response.json({ error: "Coordonate invalide." }, { status: 400 });
  }

  const pickupLat = getCoordinate(input, "pickupLat");
  const pickupLng = getCoordinate(input, "pickupLng");
  const destinationLat = getCoordinate(input, "destinationLat");
  const destinationLng = getCoordinate(input, "destinationLng");

  if (
    pickupLat === null ||
    pickupLng === null ||
    destinationLat === null ||
    destinationLng === null
  ) {
    return Response.json({ error: "Coordonate invalide." }, { status: 400 });
  }

  if (pickupLat === destinationLat && pickupLng === destinationLng) {
    return Response.json(
      { error: "Ruta nu a putut fi calculată." },
      { status: 422 },
    );
  }

  const apiKey = process.env.GEOAPIFY_API_KEY;
  if (!apiKey) {
    return Response.json(
      { error: "Serviciul de rutare nu este configurat." },
      { status: 503 },
    );
  }

  const url = new URL("https://api.geoapify.com/v1/routing");
  url.searchParams.set(
    "waypoints",
    `${pickupLat},${pickupLng}|${destinationLat},${destinationLng}`,
  );
  url.searchParams.set("mode", "light_truck");
  url.searchParams.set("units", "metric");
  url.searchParams.set("apiKey", apiKey);

  try {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) {
      return Response.json(
        { error: "Ruta nu a putut fi calculată." },
        { status: 502 },
      );
    }

    const payload: unknown = await response.json();
    if (!isRecord(payload) || !Array.isArray(payload.features)) {
      return Response.json(
        { error: "Ruta nu a putut fi calculată." },
        { status: 502 },
      );
    }

    const feature = payload.features.find(isRecord);
    if (!feature) {
      return Response.json(
        { error: "Ruta nu a putut fi calculată." },
        { status: 422 },
      );
    }

    const distanceMeters = getRouteMetric(feature, "distance");
    const durationSeconds = getRouteMetric(feature, "time");
    if (distanceMeters === null || durationSeconds === null) {
      return Response.json(
        { error: "Ruta nu a putut fi calculată." },
        { status: 502 },
      );
    }

    return Response.json({
      route: {
        distanceMeters,
        distanceKm: distanceMeters / 1000,
        durationSeconds,
        durationMinutes: durationSeconds / 60,
      },
    });
  } catch {
    return Response.json(
      { error: "Ruta nu a putut fi calculată." },
      { status: 502 },
    );
  }
}
