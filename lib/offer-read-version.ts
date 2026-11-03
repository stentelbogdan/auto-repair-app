// PostgREST casts before JSON serialization. Never recover an already rounded number.
export const OFFER_VERSION_PROJECTION = ",read_state_version::text";
const MAX_VERSION = "9223372036854775807";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function offerReadVersion(value: unknown): string | null {
  return typeof value === "string" && value === value.trim() && /^[1-9][0-9]{0,18}$/.test(value) &&
    (value.length < MAX_VERSION.length || value <= MAX_VERSION) ? value : null;
}

export type OfferReadObservation = Readonly<{
  userId: string;
  role: "customer" | "workshop";
  offerId: string;
  version: string;
}>;

export function offerReadObservation(userId: string, role: OfferReadObservation["role"], offerId: string, version: unknown): OfferReadObservation | null {
  const exact = offerReadVersion(version);
  if (!uuid.test(userId) || !uuid.test(offerId) || !exact || (role !== "customer" && role !== "workshop")) return null;
  return Object.freeze({ userId, role, offerId, version: exact });
}

// Only the absent-column compatibility path may omit the projection. Same filters,
// same RLS, no separate version fetch, no fallback for transport/permission failures.
export async function loadWithOfferVersion<T extends { error: unknown }>(load: (projection: typeof OFFER_VERSION_PROJECTION | "") => PromiseLike<T>): Promise<T> {
  const result = await load(OFFER_VERSION_PROJECTION);
  const error = result.error as { code?: unknown; message?: unknown } | null;
  if (error && (error.code === "42703" || error.code === "PGRST204") &&
      typeof error.message === "string" && /\bread_state_version\b/.test(error.message)) {
    return load("");
  }
  return result;
}
