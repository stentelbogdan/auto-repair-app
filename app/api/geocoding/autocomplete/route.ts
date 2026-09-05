type GeoapifyResult = Record<string, unknown>;

type AutocompleteSuggestion = {
  id: string;
  city: string;
  label: string;
  region: string | null;
  country: string | null;
  countryCode: string | null;
  lat: number | null;
  lng: number | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getString(record: GeoapifyResult, key: string) {
  const value = record[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function getCoordinate(result: GeoapifyResult, key: "lat" | "lon") {
  const value = result[key];
  const minimum = key === "lat" ? -90 : -180;
  const maximum = key === "lat" ? 90 : 180;

  return typeof value === "number" &&
    Number.isFinite(value) &&
    value >= minimum &&
    value <= maximum
    ? value
    : null;
}

function getInputCoordinate(
  input: Record<string, unknown>,
  key: "lat" | "lng",
) {
  const value = input[key];
  const minimum = key === "lat" ? -90 : -180;
  const maximum = key === "lat" ? 90 : 180;

  return typeof value === "number" &&
    Number.isFinite(value) &&
    value >= minimum &&
    value <= maximum
    ? value
    : null;
}

function normalizeSuggestion(
  result: GeoapifyResult,
  index: number,
): AutocompleteSuggestion | null {
  const city =
    getString(result, "city") ??
    getString(result, "town") ??
    getString(result, "village") ??
    getString(result, "municipality");
  if (!city) return null;

  const region = getString(result, "state") ?? getString(result, "county");
  const country = getString(result, "country");
  const countryCode = getString(result, "country_code");
  const label = [city, region, country].filter(Boolean).join(", ");
  const lat = getCoordinate(result, "lat");
  const lng = getCoordinate(result, "lon");

  return {
    id:
      getString(result, "place_id") ??
      [city, region, countryCode, lat, lng, index].join("|"),
    city,
    label,
    region,
    country,
    countryCode,
    lat,
    lng,
  };
}

export async function POST(request: Request) {
  let input: unknown;

  try {
    input = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (!isRecord(input)) {
    return Response.json({ error: "Invalid search text." }, { status: 400 });
  }

  const text = getString(input, "text");
  if (!text || text.length < 3) {
    return Response.json({ error: "Invalid search text." }, { status: 400 });
  }

  const hasLat = input.lat !== undefined;
  const hasLng = input.lng !== undefined;
  if (hasLat !== hasLng) {
    return Response.json({ error: "Invalid coordinates." }, { status: 400 });
  }

  const lat = hasLat ? getInputCoordinate(input, "lat") : null;
  const lng = hasLng ? getInputCoordinate(input, "lng") : null;
  if ((hasLat && lat === null) || (hasLng && lng === null)) {
    return Response.json({ error: "Invalid coordinates." }, { status: 400 });
  }

  const apiKey = process.env.GEOAPIFY_API_KEY;
  if (!apiKey) {
    return Response.json(
      { error: "Location autocomplete is not configured." },
      { status: 503 },
    );
  }

  const url = new URL("https://api.geoapify.com/v1/geocode/autocomplete");
  url.searchParams.set("text", text);
  url.searchParams.set("type", "city");
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", "8");
  url.searchParams.set("apiKey", apiKey);
  if (lat !== null && lng !== null) {
    url.searchParams.set("bias", `proximity:${lng},${lat}`);
  }

  try {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) {
      return Response.json(
        { error: "Location autocomplete failed." },
        { status: 502 },
      );
    }

    const payload: unknown = await response.json();
    const results =
      isRecord(payload) && Array.isArray(payload.results)
        ? payload.results.filter(isRecord)
        : [];
    const suggestions = results
      .map(normalizeSuggestion)
      .filter((suggestion): suggestion is AutocompleteSuggestion =>
        Boolean(suggestion),
      );

    return Response.json({ suggestions });
  } catch {
    return Response.json(
      { error: "Location autocomplete failed." },
      { status: 502 },
    );
  }
}
