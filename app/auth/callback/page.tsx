"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import { useAuth } from "@/lib/auth-provider";

type UserRole = "customer" | "workshop";

type ProfileRow = {
  role: string[] | null;
};

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

      const pendingRole = localStorage.getItem(
        "pendingRegisterRole",
      ) as UserRole | null;

      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .maybeSingle<ProfileRow>();

      if (profileError) {
        alert(profileError.message);
        router.push("/login");
        return;
      }

      let roles = Array.isArray(profile?.role) ? profile.role : [];

      if (roles.length === 0) {
        const selectedRole: UserRole = pendingRole || "customer";

        const fullName =
          user.user_metadata?.full_name ||
          user.user_metadata?.name ||
          user.email ||
          "Client";

        const profilePayload =
          selectedRole === "workshop"
            ? {
                id: user.id,
                email: user.email,
                role: ["workshop"],
                full_name: fullName,
                display_name: fullName,
                workshop_name: fullName,
                gdpr_accepted: true,
                gdpr_accepted_at: new Date().toISOString(),
              }
            : {
                id: user.id,
                email: user.email,
                role: ["customer"],
                full_name: fullName,
                display_name: fullName,
                gdpr_accepted: true,
                gdpr_accepted_at: new Date().toISOString(),
              };

        const { error: insertError } = await supabase
          .from("profiles")
          .upsert(profilePayload);

        if (insertError) {
          alert(insertError.message);
          router.push("/login");
          return;
        }

        roles = [selectedRole];
      }

      localStorage.removeItem("pendingRegisterRole");

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
