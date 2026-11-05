import { supabase } from "@/lib/supabase/client";
import type { RepairRequestRow } from "./repair-requests";

export type CustomerActivityRequest = RepairRequestRow & { last_relevant_activity_at: string };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FIELDS = ["id", "user_id", "car_brand", "car_model", "car_year", "city", "license_plate", "damage_type", "service_details",
  "service_type", "request_type", "target_workshop_id", "description", "images", "status", "accepted_offer_id", "pickup_lat", "pickup_lng",
  "destination_lat", "destination_lng", "route_distance_meters", "route_duration_seconds", "route_paths", "towing_schedule_type",
  "towing_requested_at", "towing_requested_timezone", "created_at", "offers_count"];
function record(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}
function json(v: unknown): boolean {
  return v === null || typeof v === "string" || typeof v === "boolean" ||
    (typeof v === "number" && Number.isFinite(v)) ||
    (Array.isArray(v) ? v.every(json) : record(v) && Object.values(v).every(json));
}
function timestamp(v: unknown): v is string {
  return typeof v === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?(?:Z|[+-]\d\d:\d\d)$/.test(v) && Number.isFinite(Date.parse(v));
}
function invalid(): never { throw new Error("INVALID_CUSTOMER_ACTIVITY_RESPONSE"); }
function count(v: unknown): number {
  if (typeof v === "string" && /^(0|[1-9]\d*)$/.test(v)) v = Number(v);
  if (typeof v !== "number" || !Number.isSafeInteger(v) || v < 0) return invalid();
  return v;
}

export function parseCustomerActivity(data: unknown, userId: string): CustomerActivityRequest[] {
  if (!UUID.test(userId) || !Array.isArray(data)) return invalid();
  const ids = new Set<string>();
  // Never sort here: preserve server microsecond precision and deterministic ties.
  return data.map(envelope => {
    if (!record(envelope) || Object.keys(envelope).length !== 2 || !timestamp(envelope.last_relevant_activity_at)) return invalid();
    const r = envelope.request_data;
    if (!record(r) || !json(r) || Object.keys(r).length !== FIELDS.length || !FIELDS.every(key => Object.hasOwn(r, key)) ||
      typeof r.id !== "string" || !UUID.test(r.id) || ids.has(r.id) || r.user_id !== userId) return invalid();
    ids.add(r.id);
    for (const key of ["car_brand", "car_model", "car_year", "city", "damage_type", "status"]) {
      if (typeof r[key] !== "string") return invalid();
    }
    if (!timestamp(r.created_at)) return invalid();
    for (const key of ["license_plate", "description", "towing_requested_timezone"]) {
      if (r[key] !== null && typeof r[key] !== "string") return invalid();
    }
    for (const key of ["target_workshop_id", "accepted_offer_id"]) {
      if (r[key] !== null && (typeof r[key] !== "string" || !UUID.test(r[key]))) return invalid();
    }
    if (![null, "repair", "direct_request"].includes(r.request_type as string | null) ||
      ![null, "bodywork", "mechanical", "wheels", "towing"].includes(r.service_type as string | null) ||
      ![null, "asap", "scheduled"].includes(r.towing_schedule_type as string | null) ||
      (r.towing_requested_at !== null && !timestamp(r.towing_requested_at))) return invalid();
    for (const key of ["pickup_lat", "pickup_lng", "destination_lat", "destination_lng", "route_distance_meters", "route_duration_seconds"]) {
      if (r[key] !== null && (typeof r[key] !== "number" || !Number.isFinite(r[key]))) return invalid();
    }
    if (r.service_details !== null && !record(r.service_details) &&
      !(Array.isArray(r.service_details) && r.service_details.every(v => typeof v === "string"))) return invalid();
    if (r.route_paths !== null && !(Array.isArray(r.route_paths) && r.route_paths.every(path => Array.isArray(path) && path.every(
      point => Array.isArray(point) && point.length === 2 && point.every(v => typeof v === "number" && Number.isFinite(v)))))) return invalid();
    if (!Array.isArray(r.images) || !r.images.every(image => record(image) &&
      ["name", "url", "thumbUrl", "dataUrl", "path", "fingerprint", "fingerprintVersion"].every(key => image[key] === undefined || typeof image[key] === "string"))) return invalid();
    // Legacy optional photo metadata is retained; no guessed values or category conversions.
    return { ...r, offers_count: count(r.offers_count),
      last_relevant_activity_at: envelope.last_relevant_activity_at } as CustomerActivityRequest;
  });
}

export async function getCustomerRequestsByActivity(userId: string, signal: AbortSignal): Promise<CustomerActivityRequest[]> {
  if (!UUID.test(userId) || process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "") !== "https://bstjobvvxxfqqwyjoimx.supabase.co" ||
    process.env.NEXT_PUBLIC_AUTOREPAIR_SUPABASE_PROJECT_REF !== "bstjobvvxxfqqwyjoimx") throw new Error("CUSTOMER_ACTIVITY_TEST_ONLY");
  const current = async () => {
    signal.throwIfAborted();
    const { data, error } = await supabase.auth.getSession();
    if (error || data.session?.user.id !== userId) throw new Error("CUSTOMER_ACTIVITY_SESSION_CHANGED");
    signal.throwIfAborted();
  };
  await current();
  // Server auth.uid(), JWT role, profile and ownership remain authoritative.
  const result = await supabase.rpc("get_customer_requests_by_activity").abortSignal(signal);
  if (result.error) throw new Error("CUSTOMER_ACTIVITY_READ_FAILED");
  await current();
  const rows = parseCustomerActivity(result.data, userId);
  if (!rows.length) return rows; // Includes a current account without the Client role.
  const views = await supabase.rpc("get_customer_request_view_counts", { p_request_ids: rows.map(r => r.id) }).abortSignal(signal);
  if (views.error || !Array.isArray(views.data)) throw new Error("CUSTOMER_ACTIVITY_VIEW_COUNTS_FAILED");
  const counts = new Map<string, number>();
  const ids = new Set(rows.map(r => r.id));
  for (const item of views.data) {
    if (!record(item) || typeof item.request_id !== "string" || !ids.has(item.request_id) || counts.has(item.request_id)) return invalid();
    counts.set(item.request_id, count(item.view_count));
  }
  await current();
  return rows.map(r => ({ ...r, view_count: counts.get(r.id) ?? 0 }));
}
