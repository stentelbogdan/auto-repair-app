import { supabase } from "@/lib/supabase/client";
import type { RepairServiceDetails, TowingScheduleType } from "./repair-requests";
import type { RepairServiceType } from "@/lib/repair-requests/service-types";
import type { TowingRoutePaths } from "@/lib/towing/towing-route";

export type WorkshopRequestDetail = {
  id: string;
  car_brand: string;
  car_model: string;
  car_year: string;
  city: string;
  license_plate: string | null;
  damage_type: string | null;
  service_details: RepairServiceDetails | null;
  service_type: RepairServiceType | null;
  pickup_lat: number | null;
  pickup_lng: number | null;
  destination_lat: number | null;
  destination_lng: number | null;
  route_distance_meters: number | null;
  route_duration_seconds: number | null;
  route_paths: TowingRoutePaths | null;
  towing_schedule_type: TowingScheduleType | null;
  towing_requested_at: string | null;
  towing_requested_timezone: string | null;
  description: string | null;
  images: { name?: string; url?: string; dataUrl?: string; thumbUrl?: string }[];
  status: string;
  request_type: string | null;
  target_workshop_id: string | null;
  accepted_offer_id: string | null;
  created_at: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isJson(value: unknown): boolean {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJson);
  return isRecord(value) && Object.values(value).every(isJson);
}

function invalidResponse(): Error {
  return new Error("Răspuns invalid la încărcarea cererii Service.");
}

export async function getWorkshopRequestDetail(requestId: string): Promise<WorkshopRequestDetail | null> {
  const { data, error } = await supabase.rpc("get_workshop_repair_request_detail", {
    p_request_id: requestId,
  });
  if (error) throw error;
  if (!Array.isArray(data)) throw invalidResponse();
  if (data.length === 0) return null;
  if (data.length !== 1 || !isRecord(data[0])) throw invalidResponse();

  const row: unknown = data[0].request_data;
  if (!isRecord(row) || !isJson(row) || row.id !== requestId ||
    typeof row.id !== "string" || row.id.length !== 36 ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(row.id)) {
    throw invalidResponse();
  }
  for (const key of ["car_brand", "car_model", "car_year", "city", "status", "created_at"]) {
    if (typeof row[key] !== "string") throw invalidResponse();
  }
  for (const key of ["license_plate", "damage_type", "description", "service_type", "request_type",
    "target_workshop_id", "accepted_offer_id", "towing_schedule_type", "towing_requested_at", "towing_requested_timezone"]) {
    if (row[key] !== null && typeof row[key] !== "string") throw invalidResponse();
  }
  for (const key of ["pickup_lat", "pickup_lng", "destination_lat", "destination_lng",
    "route_distance_meters", "route_duration_seconds"]) {
    if (row[key] !== null && (typeof row[key] !== "number" || !Number.isFinite(row[key]))) throw invalidResponse();
  }
  // Validate transport shapes without normalizing legacy metadata or replacing
  // the category/route guards already used by the existing display components.
  if (row.service_details !== null && !isRecord(row.service_details) &&
    !(Array.isArray(row.service_details) && row.service_details.every(item => typeof item === "string"))) {
    throw invalidResponse();
  }
  if (row.route_paths !== null && !Array.isArray(row.route_paths)) throw invalidResponse();
  if (!Array.isArray(row.images) || !row.images.every(image => isRecord(image) &&
    ["name", "url", "dataUrl", "thumbUrl"].every(key => image[key] === undefined || typeof image[key] === "string"))) {
    throw invalidResponse();
  }
  return row as WorkshopRequestDetail;
}
