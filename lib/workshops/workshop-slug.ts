import { supabase } from "@/lib/supabase/client";

type WorkshopProfileForSlug = {
  role: string[] | null;
  workshop_name: string | null;
  full_name: string | null;
  display_name: string | null;
  workshop_slug: string | null;
};

export function hasWorkshopSlug(
  value: string | null | undefined,
): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function createWorkshopSlug(
  workshopName: string | null | undefined,
  userId: string,
): string {
  const base = (workshopName || "service")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "") || "service";

  const userSuffix = userId
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 8);

  if (!userSuffix) {
    throw new Error("ID-ul utilizatorului nu poate genera un slug stabil.");
  }

  return `${base}-${userSuffix}`;
}

export async function ensureAuthenticatedWorkshopSlug(
  userId: string,
): Promise<string | null> {
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select(
      "role, workshop_name, full_name, display_name, workshop_slug",
    )
    .eq("id", userId)
    .maybeSingle<WorkshopProfileForSlug>();

  if (profileError) {
    throw profileError;
  }

  if (!profile) {
    return null;
  }

  const roles = Array.isArray(profile.role) ? profile.role : [];

  if (!roles.includes("workshop")) {
    return null;
  }

  if (hasWorkshopSlug(profile.workshop_slug)) {
    return profile.workshop_slug;
  }

  const workshopName =
    profile.workshop_name ||
    profile.display_name ||
    profile.full_name ||
    "Service";
  const workshopSlug = createWorkshopSlug(workshopName, userId);

  let updateQuery = supabase
    .from("profiles")
    .update({ workshop_slug: workshopSlug })
    .eq("id", userId);

  updateQuery =
    profile.workshop_slug === null
      ? updateQuery.is("workshop_slug", null)
      : updateQuery.eq("workshop_slug", profile.workshop_slug);

  const { data: updatedProfile, error: updateError } = await updateQuery
    .select("workshop_slug")
    .maybeSingle<{ workshop_slug: string | null }>();

  if (updateError) {
    throw updateError;
  }

  if (hasWorkshopSlug(updatedProfile?.workshop_slug)) {
    return updatedProfile.workshop_slug;
  }

  const { data: currentProfile, error: currentProfileError } = await supabase
    .from("profiles")
    .select("workshop_slug")
    .eq("id", userId)
    .maybeSingle<{ workshop_slug: string | null }>();

  if (currentProfileError) {
    throw currentProfileError;
  }

  if (hasWorkshopSlug(currentProfile?.workshop_slug)) {
    return currentProfile.workshop_slug;
  }

  throw new Error("Slug-ul profilului public nu a putut fi salvat.");
}
