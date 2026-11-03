import { offerReadVersion, type OfferReadObservation } from "@/lib/offer-read-version";
import { supabase } from "@/lib/supabase/client";

export type NotificationId = string | number;
export type ReadRole = "customer" | "workshop";
export type ReadContext = { requestId: string; offerId?: string; appointmentId?: string };
export type NotificationSnapshot = {
  userId: string;
  role: ReadRole;
  rows: { id: NotificationId; type: string; request_id: string | null; offer_id: string | null; appointment_id: string | null }[];
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function validNotificationId(id: unknown): id is NotificationId {
  return typeof id === "string" ? uuid.test(id) || /^[1-9][0-9]*$/.test(id)
    : typeof id === "number" && Number.isSafeInteger(id) && id > 0;
}
export function validReadIds(ids: readonly string[]): string[] {
  if (ids.some(id => typeof id !== "string" || !uuid.test(id))) throw new Error("INVALID_READ_IDS");
  return [...new Set(ids)];
}
export function readCount(value: unknown, maximum: number): number {
  const number = typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value) ? Number(value) : value;
  if (typeof number !== "number" || !Number.isSafeInteger(number) || number < 0 || number > maximum) {
    throw new Error("INVALID_READ_COUNT");
  }
  return number;
}
async function sameUser(userId: string) {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user || data.user.id !== userId) throw new Error("READ_SESSION_CHANGED");
}
export async function captureNotificationSnapshot(userId: string, role: ReadRole): Promise<NotificationSnapshot> {
  await sameUser(userId);
  const { data, error } = await supabase.from("notifications")
    .select("id,type,request_id,offer_id,appointment_id")
    .eq("recipient_id", userId).eq("recipient_role", role).is("read_at", null);
  if (error || !Array.isArray(data)) throw new Error("READ_SNAPSHOT_UNAVAILABLE");
  const rows: NotificationSnapshot["rows"] = [];
  for (const row of data) {
    if (!row || !validNotificationId(row.id) || typeof row.type !== "string" ||
      [row.request_id, row.offer_id, row.appointment_id].some(id => id !== null && (typeof id !== "string" || !uuid.test(id)))) {
      throw new Error("INVALID_READ_SNAPSHOT");
    }
    rows.push({ id: row.id, type: row.type, request_id: row.request_id, offer_id: row.offer_id, appointment_id: row.appointment_id });
  }
  await sameUser(userId);
  return { userId, role, rows };
}
export function displayedNotificationIds(snapshot: NotificationSnapshot, context: ReadContext, types: readonly string[]) {
  return snapshot.rows.filter(row => types.includes(row.type) && row.request_id === context.requestId &&
    (row.offer_id === null || row.offer_id === context.offerId) &&
    (row.appointment_id === null || row.appointment_id === context.appointmentId)).map(row => row.id);
}
export async function confirmNotificationRead(snapshot: NotificationSnapshot, ids: readonly NotificationId[]): Promise<NotificationId[]> {
  if (ids.some(id => !validNotificationId(id))) throw new Error("INVALID_NOTIFICATION_IDS");
  const unique = [...new Set(ids)];
  if (unique.some(id => !snapshot.rows.some(row => row.id === id))) throw new Error("UNOBSERVED_NOTIFICATION");
  if (!unique.length) return [];
  await sameUser(snapshot.userId);
  const { error } = await supabase.from("notifications").update({ read_at: new Date().toISOString() })
    .eq("recipient_id", snapshot.userId).eq("recipient_role", snapshot.role).in("id", unique).is("read_at", null);
  if (error) throw new Error("NOTIFICATION_READ_DENIED");
  const { data, error: readError } = await supabase.from("notifications").select("id,read_at")
    .eq("recipient_id", snapshot.userId).eq("recipient_role", snapshot.role).in("id", unique);
  await sameUser(snapshot.userId);
  if (readError || !Array.isArray(data)) throw new Error("NOTIFICATION_READ_UNCONFIRMED");
  return unique.filter(id => data.some(row => row.id === id && typeof row.read_at === "string" && Number.isFinite(Date.parse(row.read_at))));
}
// The observation is captured with the displayed offer, never fetched before writing.
export async function confirmOfferRead(role: ReadRole, userId: string, observations: readonly OfferReadObservation[],
  options: { signal?: AbortSignal; isCurrent?: () => boolean } = {}) {
  const current = () => {
    if (options.signal?.aborted || options.isCurrent?.() === false) throw new Error("READ_OBSERVATION_CANCELLED");
  };
  const versions = new Map<string, string>();
  for (const observation of observations) {
    if (observation.userId !== userId || observation.role !== role || !uuid.test(observation.offerId) ||
      !offerReadVersion(observation.version)) throw new Error("INVALID_OFFER_OBSERVATION");
    if (versions.has(observation.offerId) && versions.get(observation.offerId) !== observation.version) throw new Error("CONFLICTING_OFFER_VERSIONS");
    versions.set(observation.offerId, observation.version);
  }
  const ids = [...versions.keys()];
  if (!ids.length) return { changed: 0, confirmedIds: [] as string[], staleIds: [] as string[] };
  current();
  await sameUser(userId);
  current();
  let rpc = supabase.rpc(role === "customer" ? "mark_customer_repair_offers_read" : "mark_workshop_repair_offers_read", {
    p_offer_ids: ids, p_expected_versions: [...versions.values()],
  });
  if (options.signal) rpc = rpc.abortSignal(options.signal);
  const { data, error } = await rpc;
  current();
  if (error) {
    if (error.code === "PGRST202" || error.code === "42883") throw new Error("OFFER_READ_UNAVAILABLE");
    throw new Error("OFFER_READ_DENIED");
  }
  const changed = readCount(data, ids.length);
  await sameUser(userId);
  current();
  const column = role === "customer" ? "customer_read_at" : "workshop_read_at";
  let query = supabase.from("repair_offers").select(role === "customer"
    ? "id,customer_read_at,read_state_version::text,repair_requests!inner(user_id)"
    : "id,workshop_read_at,read_state_version::text").in("id", ids);
  query = role === "customer" ? query.eq("repair_requests.user_id", userId) : query.eq("workshop_user_id", userId);
  if (options.signal) query = query.abortSignal(options.signal);
  const { data: rows, error: readError } = await query.overrideTypes<{ id: unknown; read_state_version: unknown; customer_read_at?: unknown; workshop_read_at?: unknown }[], { merge: false }>();
  await sameUser(userId);
  current();
  if (readError || !Array.isArray(rows)) throw new Error("OFFER_READ_UNCONFIRMED");
  const confirmedIds: string[] = [], staleIds: string[] = [];
  for (const id of ids) {
    const matches = rows.filter(row => row.id === id);
    if (matches.length !== 1) { staleIds.push(id); continue; }
    const row = matches[0];
    const version = offerReadVersion(row.read_state_version);
    if (!version) throw new Error("INVALID_OFFER_READBACK_VERSION");
    const expected = versions.get(id)!;
    // An acknowledgement advances the version once. Other advances require a new
    // rendered observation; aggregate count never assigns successes to particular IDs.
    const sameGeneration = version === expected || BigInt(version) === BigInt(expected) + BigInt(1);
    if (sameGeneration && typeof row[column] === "string" && Number.isFinite(Date.parse(row[column]))) confirmedIds.push(id);
    else staleIds.push(id);
  }
  return { changed, confirmedIds, staleIds };
}

export const markCustomerRepairOffersRead = (userId: string, observations: readonly OfferReadObservation[]) => confirmOfferRead("customer", userId, observations);
export const markWorkshopRepairOffersRead = (userId: string, observations: readonly OfferReadObservation[]) => confirmOfferRead("workshop", userId, observations);
