import type { SupabaseClient } from "@supabase/supabase-js";

export type OwnProfile = {
  id: string;
  email: string | null;
  full_name: string | null;
  created_at: string | null;
  role: string[] | null;
  workshop_name: string | null;
  workshop_phone: string | null;
  workshop_address: string | null;
  workshop_city: string | null;
  workshop_hours: string | null;
  workshop_description: string | null;
  workshop_logo_url: string | null;
  workshop_gallery_urls: string[] | null;
  workshop_slug: string | null;
  workshop_specializations: string[] | null;
  display_name: string | null;
  city: string | null;
  gdpr_accepted: boolean | null;
  gdpr_accepted_at: string | null;
};

export type PublicWorkshopProfile = {
  workshop_id: string;
  workshop_name: string | null;
  workshop_phone: string | null;
  workshop_address: string | null;
  workshop_city: string | null;
  workshop_hours: string | null;
  workshop_description: string | null;
  workshop_logo_url: string | null;
  workshop_gallery_urls: string[] | null;
  workshop_slug: string | null;
  workshop_specializations: string[] | null;
};

export type PublicWorkshopSummary = {
  workshop_id: string;
  workshop_name: string | null;
  workshop_slug: string | null;
  workshop_logo_url: string | null;
};

export function getOwnProfile(supabase: SupabaseClient) {
  return supabase.rpc("get_own_profile").maybeSingle<OwnProfile>();
}

export function getPublicWorkshopProfile(
  supabase: SupabaseClient,
  workshopSlug: string,
) {
  return supabase
    .rpc("get_public_workshop_profile", {
      p_workshop_slug: workshopSlug,
    })
    .maybeSingle<PublicWorkshopProfile>();
}

export function getPublicWorkshopSummaries(
  supabase: SupabaseClient,
  workshopIds: string[],
) {
  return supabase.rpc("get_public_workshop_summaries", {
    p_workshop_ids: workshopIds,
  });
}
