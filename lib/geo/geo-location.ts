export type GeoLocation = {
  locality: string;
  postalCode: string | null;
  countryCode: string;
  lat: number;
  lng: number;
};

export type GeoLocationSuggestion = {
  id: string;
  label: string;
  region: string | null;
  country: string | null;
  location: GeoLocation;
};

function normalizeText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function normalizeCountryCode(value: unknown) {
  const countryCode = normalizeText(value)?.toUpperCase() ?? null;
  return countryCode && /^[A-Z]{2}$/.test(countryCode) ? countryCode : null;
}

export function isValidLatitude(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= -90 &&
    value <= 90
  );
}

export function isValidLongitude(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= -180 &&
    value <= 180
  );
}

export function normalizeGeoLocation(input: {
  locality: unknown;
  postalCode?: unknown;
  countryCode: unknown;
  lat: unknown;
  lng: unknown;
}): GeoLocation | null {
  const locality = normalizeText(input.locality);
  const postalCode = normalizeText(input.postalCode);
  const countryCode = normalizeCountryCode(input.countryCode);

  if (
    !locality ||
    !countryCode ||
    !isValidLatitude(input.lat) ||
    !isValidLongitude(input.lng)
  ) {
    return null;
  }

  return {
    locality,
    postalCode,
    countryCode,
    lat: input.lat,
    lng: input.lng,
  };
}

export function toPostgisPoint(location: GeoLocation) {
  const normalized = normalizeGeoLocation(location);
  if (!normalized) {
    throw new Error("Locația selectată nu este validă.");
  }

  return `POINT(${normalized.lng} ${normalized.lat})`;
}
