import { supabase } from "@/lib/supabase/client";
import { AsyncTimeoutError, withTimeout } from "@/lib/async/with-timeout";

type WorkshopAccessStage = "getUser" | "profile";

export type WorkshopAccessResult =
  | { status: "authorized"; userId: string }
  | { status: "unauthenticated" }
  | { status: "forbidden" }
  | { status: "timeout"; stage: WorkshopAccessStage }
  | { status: "error"; stage: WorkshopAccessStage; error: unknown };

type ProfileRow = {
  role: string[] | null;
};

const GET_USER_TIMEOUT_MS = 12_000;
const PROFILE_TIMEOUT_MS = 10_000;

export async function checkWorkshopAccess(): Promise<WorkshopAccessResult> {
  if (process.env.NODE_ENV === "development") {
    console.log("[ACCESS] check:start");
  }

  let authResult: Awaited<ReturnType<typeof supabase.auth.getUser>>;

  try {
    authResult = await withTimeout(
      supabase.auth.getUser(),
      GET_USER_TIMEOUT_MS,
      "Workshop access user check",
    );
  } catch (error) {
    if (error instanceof AsyncTimeoutError) {
      logTimeout();
      return { status: "timeout", stage: "getUser" };
    }

    return { status: "error", stage: "getUser", error };
  }

  if (authResult.error) {
    if (
      authResult.error.name === "AuthSessionMissingError" ||
      authResult.error.status === 401
    ) {
      return { status: "unauthenticated" };
    }

    return { status: "error", stage: "getUser", error: authResult.error };
  }

  const user = authResult.data.user;

  if (!user) {
    return { status: "unauthenticated" };
  }

  const loadProfile = () =>
    withTimeout(
      supabase
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .single<ProfileRow>(),
      PROFILE_TIMEOUT_MS,
      "Workshop access profile check",
    );

  let profileResult: Awaited<ReturnType<typeof loadProfile>>;

  try {
    profileResult = await loadProfile();
  } catch (error) {
    if (error instanceof AsyncTimeoutError) {
      logTimeout();
      return { status: "timeout", stage: "profile" };
    }

    logProfileError(error);
    return { status: "error", stage: "profile", error };
  }

  if (profileResult.error) {
    logProfileError(profileResult.error);
    return { status: "error", stage: "profile", error: profileResult.error };
  }

  const roles = Array.isArray(profileResult.data?.role)
    ? profileResult.data.role
    : [];

  if (!roles.includes("workshop")) {
    return { status: "forbidden" };
  }

  return { status: "authorized", userId: user.id };
}

function logTimeout() {
  if (process.env.NODE_ENV === "development") {
    console.warn("[ACCESS] timeout");
  }
}

function logProfileError(error: unknown) {
  if (process.env.NODE_ENV === "development") {
    console.error("[ACCESS] profile:error", error);
  }
}
