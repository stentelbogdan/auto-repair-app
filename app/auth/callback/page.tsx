"use client";

import {
  finalizeAuthenticatedRegistration,
  parsePendingRegistrationIntent,
  parseRegistrationRole,
  PENDING_REGISTER_ROLE_KEY,
  type RegistrationRole,
} from "@/lib/supabase/profiles";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import { useAuth } from "@/lib/auth-provider";
import { ensureAuthenticatedWorkshopSlug } from "@/lib/workshops/workshop-slug";

type UserRole = RegistrationRole;

export default function AuthCallbackPage() {
  const router = useRouter();
  const { setActiveRole } = useAuth();

  useEffect(() => {
    const finishLogin = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.user) {
        router.push("/login");
        return;
      }

      const user = session.user;

      const pendingIntent = parsePendingRegistrationIntent(
        localStorage.getItem(PENDING_REGISTER_ROLE_KEY),
      );
      const callbackFlowId = new URL(
        window.location.href,
      ).searchParams.get("registration_flow");
      const pendingRole =
        pendingIntent?.userId === user.id ||
        (Boolean(callbackFlowId) &&
          pendingIntent?.oauthFlowId === callbackFlowId)
          ? pendingIntent.role
          : null;
      const metadataRole = parseRegistrationRole(
        user.user_metadata?.requested_role,
      );
      const requestedRole = pendingRole ?? metadataRole;

      const { roles, error: profileError } =
        await finalizeAuthenticatedRegistration(
          supabase,
          user,
          requestedRole,
        );

      if (profileError) {
        alert(profileError.message);
        router.push("/login");
        return;
      }

      if (roles.includes("workshop")) {
        try {
          await ensureAuthenticatedWorkshopSlug(user.id);
        } catch (error) {
          console.error("Failed to initialize workshop public profile:", error);
        }
      }

      localStorage.removeItem(PENDING_REGISTER_ROLE_KEY);

      if (roles.includes("admin")) {
        router.push("/admin");
        return;
      }

      const savedRole = localStorage.getItem("activeRole") as UserRole | null;

      if (savedRole === "workshop" && roles.includes("workshop")) {
        setActiveRole("workshop");
        localStorage.setItem("activeRole", "workshop");
        router.push("/workshops/dashboard");
        return;
      }

      if (roles.includes("workshop") && !roles.includes("customer")) {
        setActiveRole("workshop");
        localStorage.setItem("activeRole", "workshop");
        router.push("/workshops/dashboard");
        return;
      }

      setActiveRole("customer");
      localStorage.setItem("activeRole", "customer");
      router.push("/customer/dashboard");
    };

    finishLogin();
  }, [router, setActiveRole]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#101010] px-4 text-white">
      <div className="rounded-3xl bg-white p-6 text-center text-black shadow-2xl">
        <div className="text-3xl">🚗</div>
        <p className="mt-4 font-bold">Te autentificăm...</p>
      </div>
    </main>
  );
}
