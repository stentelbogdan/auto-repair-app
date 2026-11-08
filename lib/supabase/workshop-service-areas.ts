import {
  normalizeGeoLocation,
  toPostgisPoint,
  type GeoLocation,
} from "@/lib/geo/geo-location";
import { supabase } from "@/lib/supabase/client";

export type WorkshopServiceArea = {
  workshopId: string;
  locality: string;
  postalCode: string | null;
  countryCode: string;
  radiusKm: number | null;
  geocodedAt: string;
  updatedAt: string;
};

type WorkshopServiceAreaRow = {
  workshop_id: string;
  locality: string;
  postal_code: string | null;
  country_code: string;
  radius_km: number | null;
  geocoded_at: string;
  updated_at: string;
};

function mapServiceArea(row: WorkshopServiceAreaRow): WorkshopServiceArea {
  return {
    workshopId: row.workshop_id,
    locality: row.locality,
    postalCode: row.postal_code,
    countryCode: row.country_code,
    radiusKm: row.radius_km,
    geocodedAt: row.geocoded_at,
    updatedAt: row.updated_at,
  };
}

async function getAuthenticatedWorkshopId() {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    throw new Error("Trebuie să fii autentificat pentru a configura zona de lucru.");
  }

  return data.user.id;
}

export async function getOwnWorkshopServiceArea() {
  const workshopId = await getAuthenticatedWorkshopId();
  const { data, error } = await supabase
    .from("workshop_service_areas")
    .select(
      "workshop_id, locality, postal_code, country_code, radius_km, geocoded_at, updated_at",
    )
    .eq("workshop_id", workshopId)
    .maybeSingle<WorkshopServiceAreaRow>();

  if (error) throw error;
  return data ? mapServiceArea(data) : null;
}

export async function saveOwnWorkshopServiceArea(input: {
  location: GeoLocation | null;
  radiusKm: number | null;
  existingArea: WorkshopServiceArea | null;
}) {
  const workshopId = await getAuthenticatedWorkshopId();
  const now = new Date().toISOString();

  if (input.radiusKm !== null && !Number.isInteger(input.radiusKm)) {
    throw new Error("Raza trebuie să fie un număr întreg.");
  }
  if (input.radiusKm !== null && (input.radiusKm < 1 || input.radiusKm > 1000)) {
    throw new Error("Raza trebuie să fie între 1 și 1000 km.");
  }

  if (input.location) {
    const location = normalizeGeoLocation(input.location);
    if (!location) throw new Error("Selectează o localitate validă din listă.");

    const values = {
      location: toPostgisPoint(location),
      locality: location.locality,
      postal_code: location.postalCode,
      country_code: location.countryCode,
      radius_km: input.radiusKm,
      geocoded_at: now,
      updated_at: now,
    };
    // An UPSERT also assigns workshop_id on conflict, requiring UPDATE on the
    // ownership column. Keep it only in the filter (UPDATE) or new row (INSERT).
    const updateOwnArea = () => supabase
      .from("workshop_service_areas")
      .update(values)
      .eq("workshop_id", workshopId)
      .select(
        "workshop_id, locality, postal_code, country_code, radius_km, geocoded_at, updated_at",
      )
      .maybeSingle<WorkshopServiceAreaRow>();

    const updated = await updateOwnArea();
    if (updated.error) throw updated.error;
    if (updated.data) return mapServiceArea(updated.data);

    const { data, error } = await supabase
      .from("workshop_service_areas")
      .insert({ workshop_id: workshopId, ...values })
      .select(
        "workshop_id, locality, postal_code, country_code, radius_km, geocoded_at, updated_at",
      )
      .single<WorkshopServiceAreaRow>();

    // Another device may have created the own row after the empty UPDATE.
    // Retry once, still scoped to auth.getUser(), without assigning its owner.
    if (error?.code === "23505") {
      const retried = await updateOwnArea();
      if (retried.error) throw retried.error;
      if (retried.data) return mapServiceArea(retried.data);
    }
    if (error) throw error;
    return mapServiceArea(data);
  }

  if (!input.existingArea || input.existingArea.workshopId !== workshopId) {
    throw new Error("Selectează o localitate validă din listă.");
  }

  const { data, error } = await supabase
    .from("workshop_service_areas")
    .update({ radius_km: input.radiusKm, updated_at: now })
    .eq("workshop_id", workshopId)
    .select(
      "workshop_id, locality, postal_code, country_code, radius_km, geocoded_at, updated_at",
    )
    .single<WorkshopServiceAreaRow>();

  if (error) throw error;
  return mapServiceArea(data);
}
