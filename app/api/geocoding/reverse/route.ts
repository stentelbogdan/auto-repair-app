type GeoapifyResult = Record<string, unknown>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getString(record: GeoapifyResult, key: string) {
  const value = record[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function getAddress(result: GeoapifyResult) {
  const street = getString(result, "street");
  const houseNumber = getString(result, "housenumber");

  if (street) return houseNumber ? `${street} ${houseNumber}` : street;

  return getString(result, "address_line1") ?? getString(result, "name");
}

function getCity(result: GeoapifyResult) {
  return (
    getString(result, "city") ??
    getString(result, "town") ??
    getString(result, "village") ??
    getString(result, "municipality") ??
    getString(result, "county")
  );
}

export async function POST(request: Request) {
  let input: unknown;

  try {
    input = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (!isRecord(input)) {
    return Response.json({ error: "Invalid coordinates." }, { status: 400 });
  }

  const { lat, lng } = input;
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
    return Response.json({ error: "Invalid coordinates." }, { status: 400 });
  }

  const apiKey = process.env.GEOAPIFY_API_KEY;
  if (!apiKey) {
    return Response.json(
      { error: "Reverse geocoding is not configured." },
      { status: 503 },
    );
  }

  const url = new URL("https://api.geoapify.com/v1/geocode/reverse");
  url.searchParams.set("lat", String(lat));
  url.searchParams.set("lon", String(lng));
  url.searchParams.set("format", "json");
  url.searchParams.set("lang", "ro");
  url.searchParams.set("apiKey", apiKey);

  try {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) {
      return Response.json(
        { error: "Reverse geocoding failed." },
        { status: 502 },
      );
    }

    const payload: unknown = await response.json();
    const results =
      isRecord(payload) && Array.isArray(payload.results)
        ? payload.results.filter(isRecord)
        : [];
    const result = results[0];

    return Response.json({
      address: result ? getAddress(result) : null,
      city: result ? getCity(result) : null,
    });
  } catch {
    return Response.json(
      { error: "Reverse geocoding failed." },
      { status: 502 },
    );
  }
}
