import {
  isGeoapifyRecord,
  normalizeGeoapifySuggestion,
} from "@/lib/geo/geoapify";

type GeoapifyResult = Record<string, unknown>;

type AutocompleteSuggestion = {
  id: string;
  city: string;
  label: string;
  region: string | null;
  country: string | null;
  countryCode: string | null;
  postalCode: string | null;
  lat: number | null;
  lng: number | null;
  location: {
    locality: string;
    postalCode: string | null;
    countryCode: string;
    lat: number;
    lng: number;
  };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getString(record: GeoapifyResult, key: string) {
  const value = record[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
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
        ? payload.results.filter(isGeoapifyRecord)
        : [];
    const suggestions = results
      .map((result): AutocompleteSuggestion | null => {
        const suggestion = normalizeGeoapifySuggestion(result);
        if (!suggestion) return null;

        return {
          ...suggestion,
          city: suggestion.location.locality,
          countryCode: suggestion.location.countryCode,
          postalCode: suggestion.location.postalCode,
          lat: suggestion.location.lat,
          lng: suggestion.location.lng,
        };
      })
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
