import {
  normalizeGeoLocation,
  type GeoLocationSuggestion,
} from "@/lib/geo/geo-location";

type GeoapifyResult = Record<string, unknown>;

export function isGeoapifyRecord(
  value: unknown,
): value is GeoapifyResult {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function getGeoapifyString(
  record: GeoapifyResult,
  key: string,
) {
  const value = record[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function getGeoapifyLocality(result: GeoapifyResult) {
  return (
    getGeoapifyString(result, "city") ??
    getGeoapifyString(result, "town") ??
    getGeoapifyString(result, "village") ??
    getGeoapifyString(result, "municipality") ??
    getGeoapifyString(result, "county")
  );
}

export function normalizeGeoapifySuggestion(
  result: GeoapifyResult,
): GeoLocationSuggestion | null {
  const locality = getGeoapifyLocality(result);
  const region =
    getGeoapifyString(result, "state") ??
    getGeoapifyString(result, "county");
  const country = getGeoapifyString(result, "country");
  const location = normalizeGeoLocation({
    locality,
    postalCode: getGeoapifyString(result, "postcode"),
    countryCode: getGeoapifyString(result, "country_code"),
    lat: result.lat,
    lng: result.lon,
  });

  if (!location) return null;

  return {
    id:
      getGeoapifyString(result, "place_id") ??
      [
        location.locality,
        region,
        location.postalCode,
        location.countryCode,
        location.lat,
        location.lng,
      ].join("|"),
    label: [location.locality, region, country].filter(Boolean).join(", "),
    region,
    country,
    location,
  };
}

export function getGeoapifyAddress(result: GeoapifyResult) {
  const street = getGeoapifyString(result, "street");
  const houseNumber = getGeoapifyString(result, "housenumber");

  if (street) return houseNumber ? `${street} ${houseNumber}` : street;

  return (
    getGeoapifyString(result, "address_line1") ??
    getGeoapifyString(result, "name")
  );
}
