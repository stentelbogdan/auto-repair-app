import { createClient } from "@supabase/supabase-js";

import { getGeoapifyRoute } from "@/lib/towing/geoapify-routing";

const MIN_RECALCULATION_INTERVAL_MS = 30_000;
const MAX_RECALCULATION_INTERVAL_MS = 90_000;
const MIN_MOVEMENT_METERS = 200;
const EARTH_RADIUS_METERS = 6_371_000;

type LiveEtaSnapshot = {
  live_distance_to_pickup_meters: number | null;
  live_duration_to_pickup_seconds: number | null;
  live_eta_calculated_at: string | null;
  live_eta_origin_latitude: number | null;
  live_eta_origin_longitude: number | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getBearerToken(request: Request) {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return null;

  const token = authorization.slice("Bearer ".length).trim();
  return token || null;
}

function getCoordinate(value: unknown, type: "latitude" | "longitude") {
  const minimum = type === "latitude" ? -90 : -180;
  const maximum = type === "latitude" ? 90 : 180;

  return typeof value === "number" &&
    Number.isFinite(value) &&
    value >= minimum &&
    value <= maximum
    ? value
    : null;
}

function toRadians(value: number) {
  return (value * Math.PI) / 180;
}

export function getDistanceMeters(
  originLat: number,
  originLng: number,
  destinationLat: number,
  destinationLng: number,
) {
  const latitudeDelta = toRadians(destinationLat - originLat);
  const longitudeDelta = toRadians(destinationLng - originLng);
  const originLatitude = toRadians(originLat);
  const destinationLatitude = toRadians(destinationLat);

  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(originLatitude) *
      Math.cos(destinationLatitude) *
      Math.sin(longitudeDelta / 2) ** 2;

  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(haversine));
}

function getThrottleDecision(
  snapshot: LiveEtaSnapshot,
  latitude: number,
  longitude: number,
) {
  const calculatedAt = snapshot.live_eta_calculated_at
    ? Date.parse(snapshot.live_eta_calculated_at)
    : Number.NaN;
  const originLat = getCoordinate(
    snapshot.live_eta_origin_latitude,
    "latitude",
  );
  const originLng = getCoordinate(
    snapshot.live_eta_origin_longitude,
    "longitude",
  );

  if (
    !Number.isFinite(calculatedAt) ||
    originLat === null ||
    originLng === null ||
    typeof snapshot.live_distance_to_pickup_meters !== "number" ||
    !Number.isFinite(snapshot.live_distance_to_pickup_meters) ||
    snapshot.live_distance_to_pickup_meters < 0 ||
    typeof snapshot.live_duration_to_pickup_seconds !== "number" ||
    !Number.isFinite(snapshot.live_duration_to_pickup_seconds) ||
    snapshot.live_duration_to_pickup_seconds < 0
  ) {
    return { shouldCalculate: true } as const;
  }

  const elapsedMs = Math.max(0, Date.now() - calculatedAt);
  if (elapsedMs < MIN_RECALCULATION_INTERVAL_MS) {
    return { shouldCalculate: false, reason: "fresh" } as const;
  }

  const movedMeters = getDistanceMeters(
    originLat,
    originLng,
    latitude,
    longitude,
  );
  if (
    elapsedMs < MAX_RECALCULATION_INTERVAL_MS &&
    movedMeters < MIN_MOVEMENT_METERS
  ) {
    return { shouldCalculate: false, reason: "not_moved_enough" } as const;
  }

  return { shouldCalculate: true } as const;
}

export async function POST(request: Request) {
  let input: unknown;

  try {
    input = await request.json();
  } catch {
    return Response.json({ error: "Request invalid." }, { status: 400 });
  }

  if (!isRecord(input) || typeof input.requestId !== "string") {
    return Response.json({ error: "Request invalid." }, { status: 400 });
  }

  const requestId = input.requestId.trim();
  if (!requestId) {
    return Response.json({ error: "Request invalid." }, { status: 400 });
  }

  const token = getBearerToken(request);
  if (!token) {
    return Response.json({ error: "Autentificare necesară." }, { status: 401 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) {
    return Response.json(
      { error: "Serviciul nu este configurat." },
      { status: 503 },
    );
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser(token);
  if (authError || !user) {
    return Response.json({ error: "Autentificare invalidă." }, { status: 401 });
  }

  const { data: repairRequest, error: requestError } = await supabase
    .from("repair_requests")
    .select("id, service_type, accepted_offer_id, pickup_lat, pickup_lng")
    .eq("id", requestId)
    .maybeSingle();
  if (requestError) {
    return Response.json({ error: "Cererea nu a putut fi verificată." }, { status: 500 });
  }
  if (!repairRequest || repairRequest.service_type !== "towing") {
    return Response.json({ error: "Cererea Towing nu a fost găsită." }, { status: 404 });
  }

  const pickupLat = getCoordinate(repairRequest.pickup_lat, "latitude");
  const pickupLng = getCoordinate(repairRequest.pickup_lng, "longitude");
  if (!repairRequest.accepted_offer_id || pickupLat === null || pickupLng === null) {
    return Response.json(
      { error: "Cererea nu are date complete pentru ETA." },
      { status: 422 },
    );
  }

  const { data: acceptedOffer, error: offerError } = await supabase
    .from("repair_offers")
    .select("id, request_id, workshop_user_id, status")
    .eq("id", repairRequest.accepted_offer_id)
    .eq("request_id", requestId)
    .eq("status", "accepted")
    .maybeSingle();
  if (offerError || !acceptedOffer || acceptedOffer.workshop_user_id !== user.id) {
    return Response.json({ error: "Acces interzis." }, { status: 403 });
  }

  const { data: latestProgress, error: progressError } = await supabase
    .from("work_progress_updates")
    .select("status")
    .eq("request_id", requestId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (progressError || latestProgress?.status !== "Dispatch") {
    return Response.json(
      { error: "ETA live este disponibil doar în etapa Dispatch." },
      { status: 409 },
    );
  }

  const { data: liveLocation, error: liveLocationError } = await supabase
    .from("towing_live_locations")
    .select(
      "request_id, appointment_id, workshop_id, latitude, longitude, phase, is_active, live_distance_to_pickup_meters, live_duration_to_pickup_seconds, live_eta_calculated_at, live_eta_origin_latitude, live_eta_origin_longitude",
    )
    .eq("request_id", requestId)
    .maybeSingle();
  if (
    liveLocationError ||
    !liveLocation ||
    liveLocation.workshop_id !== user.id ||
    liveLocation.phase !== "to_pickup" ||
    liveLocation.is_active !== true
  ) {
    return Response.json(
      { error: "Trackingul live activ nu a fost găsit." },
      { status: 409 },
    );
  }

  const { data: appointment, error: appointmentError } = await supabase
    .from("repair_appointments")
    .select("id")
    .eq("id", liveLocation.appointment_id)
    .eq("request_id", requestId)
    .eq("offer_id", acceptedOffer.id)
    .eq("workshop_id", user.id)
    .eq("status", "confirmed")
    .maybeSingle();
  if (appointmentError || !appointment) {
    return Response.json(
      { error: "Programarea confirmată nu a fost găsită." },
      { status: 409 },
    );
  }

  const latitude = getCoordinate(liveLocation.latitude, "latitude");
  const longitude = getCoordinate(liveLocation.longitude, "longitude");
  if (latitude === null || longitude === null) {
    return Response.json(
      { error: "Locația live nu este disponibilă." },
      { status: 409 },
    );
  }

  const throttle = getThrottleDecision(liveLocation, latitude, longitude);
  if (!throttle.shouldCalculate) {
    return Response.json({
      status: "skipped",
      reason: throttle.reason,
      distanceMeters: liveLocation.live_distance_to_pickup_meters,
      durationSeconds: liveLocation.live_duration_to_pickup_seconds,
      calculatedAt: liveLocation.live_eta_calculated_at,
    });
  }

  const route = await getGeoapifyRoute({
    originLat: latitude,
    originLng: longitude,
    destinationLat: pickupLat,
    destinationLng: pickupLng,
    requirePaths: false,
  });
  if (route.status === "not_configured") {
    return Response.json(
      { error: "Serviciul de rutare nu este configurat." },
      { status: 503 },
    );
  }
  if (route.status !== "ok") {
    return Response.json(
      { error: "ETA live nu a putut fi calculat." },
      { status: route.status === "not_found" ? 422 : 502 },
    );
  }

  const { error: updateError } = await supabase.rpc("update_towing_live_eta", {
    p_request_id: requestId,
    p_distance_to_pickup_meters: route.distanceMeters,
    p_duration_to_pickup_seconds: route.durationSeconds,
    p_origin_latitude: latitude,
    p_origin_longitude: longitude,
  });
  if (updateError) {
    return Response.json(
      { error: "Eligibilitatea trackingului s-a schimbat." },
      { status: 409 },
    );
  }

  const { data: updatedSnapshot, error: snapshotError } = await supabase
    .from("towing_live_locations")
    .select("live_eta_calculated_at")
    .eq("request_id", requestId)
    .maybeSingle();

  return Response.json({
    status: "updated",
    distanceMeters: route.distanceMeters,
    durationSeconds: route.durationSeconds,
    calculatedAt: snapshotError
      ? null
      : (updatedSnapshot?.live_eta_calculated_at ?? null),
  });
}
