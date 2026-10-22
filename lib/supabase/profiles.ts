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

export function getAuthenticatedProfileDestination(
  roles: string[],
  savedRole: RegistrationRole | null,
) {
  if (roles.includes("admin")) return "/admin";
  if (savedRole === "workshop" && roles.includes("workshop")) {
    return "/workshops/dashboard";
  }
  if (roles.includes("workshop") && !roles.includes("customer")) {
    return "/workshops/dashboard";
  }
  if (roles.includes("customer")) return "/customer/dashboard";
  return null;
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

  if (profile && profile.id !== user.id) {
    return {
      roles: [] as string[],
      error: new Error("Profilul autentificat nu aparține utilizatorului curent."),
    };
  }

  const existingRoles = Array.isArray(profile?.role) ? profile.role : [];
  const publicRequestedRole = parseRegistrationRole(requestedRole);
  const needsProfileUpdate =
    !profile ||
    existingRoles.length === 0 ||
    Boolean(
      publicRequestedRole && !existingRoles.includes(publicRequestedRole),
    );

  if (!needsProfileUpdate) {
    return { roles: existingRoles, error: null };
  }

  const selectedRole = publicRequestedRole ?? "customer";
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
  if (profile) {
    const { error } = await supabase
      .from("profiles")
      .update({ role: roles })
      .eq("id", user.id);

    return { roles, error };
  }

  const profilePayload =
    selectedRole === "workshop"
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

  const { error } = await supabase.from("profiles").insert(profilePayload);

  if (!error) {
    return { roles, error: null };
  }

  if (error.code !== "23505") {
    return { roles: [] as string[], error };
  }

  // A callback and an explicit login can finish concurrently. The winner
  // inserts the profile; the loser must validate that exact authenticated
  // profile before treating the unique conflict as success.
  const { data: concurrentProfile, error: concurrentReadError } =
    await getOwnProfile(supabase);

  if (concurrentReadError) {
    return { roles: [] as string[], error: concurrentReadError };
  }

  if (!concurrentProfile || concurrentProfile.id !== user.id) {
    return { roles: [] as string[], error };
  }

  const concurrentRoles = Array.isArray(concurrentProfile.role)
    ? concurrentProfile.role
    : [];

  if (concurrentRoles.includes(selectedRole)) {
    return { roles: concurrentRoles, error: null };
  }

  const mergedConcurrentRoles = mergeRegistrationRole(
    concurrentRoles,
    selectedRole,
  );
  const { error: concurrentUpdateError } = await supabase
    .from("profiles")
    .update({ role: mergedConcurrentRoles })
    .eq("id", user.id);

  return {
    roles: concurrentUpdateError ? [] : mergedConcurrentRoles,
    error: concurrentUpdateError,
  };
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
