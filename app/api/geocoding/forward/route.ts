type GeoapifyResult = Record<string, unknown>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getString(record: GeoapifyResult, key: string) {
  const value = record[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeLocation(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLocaleLowerCase("ro-RO");
}

function matchesCity(result: GeoapifyResult, requestedCity: string) {
  const normalizedRequestedCity = normalizeLocation(requestedCity);
  const localityKeys = ["city", "town", "village", "municipality"];

  return localityKeys.some((key) => {
    const locality = getString(result, key);
    return locality
      ? normalizeLocation(locality) === normalizedRequestedCity
      : false;
  });
}

function getCoordinate(result: GeoapifyResult, key: "lat" | "lon") {
  const value = result[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export async function POST(request: Request) {
  let input: unknown;

  try {
    input = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (!isRecord(input)) {
    return Response.json({ error: "Invalid address." }, { status: 400 });
  }

  const address = getString(input, "address");
  const city = getString(input, "city");
  if (!address || !city) {
    return Response.json({ error: "Invalid address." }, { status: 400 });
  }

  const apiKey = process.env.GEOAPIFY_API_KEY;
  if (!apiKey) {
    return Response.json(
      { error: "Forward geocoding is not configured." },
      { status: 503 },
    );
  }

  const url = new URL("https://api.geoapify.com/v1/geocode/search");
  url.searchParams.set("text", `${address}, ${city}, România`);
  url.searchParams.set("filter", "countrycode:ro");
  url.searchParams.set("format", "json");
  url.searchParams.set("lang", "ro");
  url.searchParams.set("limit", "5");
  url.searchParams.set("apiKey", apiKey);

  try {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) {
      return Response.json(
        { error: "Forward geocoding failed." },
        { status: 502 },
      );
    }

    const payload: unknown = await response.json();
    const results =
      isRecord(payload) && Array.isArray(payload.results)
        ? payload.results.filter(isRecord)
        : [];
    const result = results.find((candidate) => matchesCity(candidate, city));
    const lat = result ? getCoordinate(result, "lat") : null;
    const lng = result ? getCoordinate(result, "lon") : null;

    if (lat === null || lng === null) {
      return Response.json({ lat: null, lng: null, matched: false });
    }

    return Response.json({ lat, lng, matched: true });
  } catch {
    return Response.json(
      { error: "Forward geocoding failed." },
      { status: 502 },
    );
  }
}
