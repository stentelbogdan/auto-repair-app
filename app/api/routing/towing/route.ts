import { getGeoapifyRoute } from "@/lib/towing/geoapify-routing";

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

  const route = await getGeoapifyRoute({
    originLat: pickupLat,
    originLng: pickupLng,
    destinationLat,
    destinationLng,
  });

  if (route.status === "not_configured") {
    return Response.json(
      { error: "Serviciul de rutare nu este configurat." },
      { status: 503 },
    );
  }
  if (route.status === "not_found") {
    return Response.json(
      { error: "Ruta nu a putut fi calculată." },
      { status: 422 },
    );
  }
  if (route.status === "upstream_error") {
    return Response.json(
      { error: "Ruta nu a putut fi calculată." },
      { status: 502 },
    );
  }

  return Response.json({
    route: {
      distanceMeters: route.distanceMeters,
      distanceKm: route.distanceMeters / 1000,
      durationSeconds: route.durationSeconds,
      durationMinutes: route.durationSeconds / 60,
      paths: route.paths,
    },
  });
}
