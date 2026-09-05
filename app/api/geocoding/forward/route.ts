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
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("ro-RO");
}

function matchesCity(result: GeoapifyResult, requestedCity: string) {
  const normalizedRequestedCity = normalizeLocation(requestedCity);
  const localityKeys = [
    "city",
    "town",
    "village",
    "municipality",
    "district",
    "county",
  ];

  return localityKeys.some((key) => {
    const locality = getString(result, key);
    if (!locality) return false;

    const normalizedLocality = normalizeLocation(locality);
    const paddedRequestedCity = ` ${normalizedRequestedCity} `;
    const paddedLocality = ` ${normalizedLocality} `;

    return (
      normalizedLocality === normalizedRequestedCity ||
      paddedLocality.includes(paddedRequestedCity) ||
      paddedRequestedCity.includes(paddedLocality)
    );
  });
}

function getCoordinate(result: GeoapifyResult, key: "lat" | "lng" | "lon") {
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

  const hasLat = input.lat !== undefined;
  const hasLng = input.lng !== undefined;
  if (hasLat !== hasLng) {
    return Response.json({ error: "Invalid coordinates." }, { status: 400 });
  }

  const lat = hasLat ? getCoordinate(input, "lat") : null;
  const lng = hasLng ? getCoordinate(input, "lng") : null;
  if ((hasLat && lat === null) || (hasLng && lng === null)) {
    return Response.json({ error: "Invalid coordinates." }, { status: 400 });
  }

  const apiKey = process.env.GEOAPIFY_API_KEY;
  if (!apiKey) {
    return Response.json(
      { error: "Forward geocoding is not configured." },
      { status: 503 },
    );
  }

  const url = new URL("https://api.geoapify.com/v1/geocode/search");
  url.searchParams.set("text", `${address}, ${city}`);
  if (lat !== null && lng !== null) {
    url.searchParams.set("bias", `proximity:${lng},${lat}`);
  }
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
    const resultLat = result ? getCoordinate(result, "lat") : null;
    const resultLng = result ? getCoordinate(result, "lon") : null;

    if (resultLat === null || resultLng === null) {
      return Response.json({ lat: null, lng: null, matched: false });
    }

    return Response.json({ lat: resultLat, lng: resultLng, matched: true });
  } catch {
    return Response.json(
      { error: "Forward geocoding failed." },
      { status: 502 },
    );
  }
}
