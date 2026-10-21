import type { SupabaseClient, User } from "@supabase/supabase-js";

export type RegistrationRole = "customer" | "workshop";

export const PENDING_REGISTER_ROLE_KEY = "pendingRegisterRole";

export type PendingRegistrationIntent = {
  role: RegistrationRole;
  userId?: string;
  oauthFlowId?: string;
};

export function parseRegistrationRole(
  value: unknown,
): RegistrationRole | null {
  return value === "customer" || value === "workshop" ? value : null;
}

export function mergeRegistrationRole(
  existingRoles: string[] | null | undefined,
  requestedRole: RegistrationRole,
) {
  return Array.from(new Set([...(existingRoles ?? []), requestedRole]));
}

export function serializePendingRegistrationIntent(
  intent: PendingRegistrationIntent,
) {
  return JSON.stringify(intent);
}

export function parsePendingRegistrationIntent(
  value: string | null,
): PendingRegistrationIntent | null {
  if (!value) return null;

  try {
    const parsed: unknown = JSON.parse(value);

    if (!parsed || typeof parsed !== "object") return null;

    const candidate = parsed as Record<string, unknown>;
    const role = parseRegistrationRole(candidate.role);
    const userId =
      typeof candidate.userId === "string" && candidate.userId.length > 0
        ? candidate.userId
        : undefined;
    const oauthFlowId =
      typeof candidate.oauthFlowId === "string" &&
      candidate.oauthFlowId.length > 0
        ? candidate.oauthFlowId
        : undefined;

    if (!role || (userId ? Boolean(oauthFlowId) : !oauthFlowId)) return null;

    return { role, ...(userId ? { userId } : { oauthFlowId }) };
  } catch {
    return null;
  }
}

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

export async function finalizeAuthenticatedRegistration(
  supabase: SupabaseClient,
  user: User,
  requestedRole: RegistrationRole | null,
) {
  const { data: profile, error: profileError } = await getOwnProfile(supabase);

  if (profileError) {
    return { roles: [] as string[], error: profileError };
  }

  const existingRoles = Array.isArray(profile?.role) ? profile.role : [];
  const needsProfileUpdate =
    !profile ||
    existingRoles.length === 0 ||
    Boolean(requestedRole && !existingRoles.includes(requestedRole));

  if (!needsProfileUpdate) {
    return { roles: existingRoles, error: null };
  }

  const selectedRole = requestedRole ?? "customer";
  const roles = mergeRegistrationRole(existingRoles, selectedRole);
  const metadataFullName = user.user_metadata?.full_name;
  const metadataName = user.user_metadata?.name;
  const fullName =
    (typeof metadataFullName === "string" && metadataFullName) ||
    (typeof metadataName === "string" && metadataName) ||
    user.email ||
    "Client";
  const metadataCity = user.user_metadata?.city;
  const city = typeof metadataCity === "string" ? metadataCity : undefined;
  const profilePayload = profile
    ? { id: user.id, role: roles }
    : selectedRole === "workshop"
      ? {
          id: user.id,
          email: user.email,
          role: roles,
          full_name: fullName,
          display_name: fullName,
          ...(city ? { city, workshop_city: city } : {}),
          workshop_name: fullName,
          gdpr_accepted: true,
          gdpr_accepted_at: new Date().toISOString(),
        }
      : {
          id: user.id,
          email: user.email,
          role: roles,
          full_name: fullName,
          display_name: fullName,
          ...(city ? { city } : {}),
          gdpr_accepted: true,
          gdpr_accepted_at: new Date().toISOString(),
        };
  const { error } = await supabase.from("profiles").upsert(profilePayload);

  return { roles, error };
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
