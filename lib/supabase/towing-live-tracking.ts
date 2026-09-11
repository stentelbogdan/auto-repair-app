import { supabase } from "@/lib/supabase/client";
import type { TowingLiveLocationRow } from "@/lib/towing/towing-live-tracking";

export type UpsertTowingLiveLocationInput = {
  requestId: string;
  appointmentId: string;
  latitude: number;
  longitude: number;
  accuracyMeters?: number | null;
  headingDegrees?: number | null;
  speedMps?: number | null;
};

export async function upsertTowingLiveLocation({
  requestId,
  appointmentId,
  latitude,
  longitude,
  accuracyMeters = null,
  headingDegrees = null,
  speedMps = null,
}: UpsertTowingLiveLocationInput) {
  const { error } = await supabase.rpc("upsert_towing_live_location", {
    p_request_id: requestId,
    p_appointment_id: appointmentId,
    p_latitude: latitude,
    p_longitude: longitude,
    p_accuracy_meters: accuracyMeters,
    p_heading_degrees: headingDegrees,
    p_speed_mps: speedMps,
  });

  if (error) throw new Error(error.message);
}

export async function stopTowingLiveTracking(requestId: string) {
  const { error } = await supabase.rpc("stop_towing_live_tracking", {
    p_request_id: requestId,
  });

  if (error) throw new Error(error.message);
}

export async function getTowingLiveLocation(requestId: string) {
  const { data, error } = await supabase
    .from("towing_live_locations")
    .select("*")
    .eq("request_id", requestId)
    .maybeSingle<TowingLiveLocationRow>();

  if (error) throw new Error(error.message);
  return data ?? null;
}
