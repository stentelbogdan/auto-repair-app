"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import { useAuth } from "@/lib/auth-provider";
import { ensureAuthenticatedWorkshopSlug } from "@/lib/workshops/workshop-slug";
import { AsyncTimeoutError, withTimeout } from "@/lib/async/with-timeout";

type UserRole = "customer" | "workshop";

type ProfileRow = {
  role: string[] | null;
};

const AUTH_TIMEOUT_MESSAGE =
  "Serviciul de autentificare răspunde greu. Încearcă din nou.";
const SIGN_IN_TIMEOUT_MS = 15_000;
const PROFILE_TIMEOUT_MS = 10_000;

export default function LoginPage() {
  const router = useRouter();
  const { setActiveRole } = useAuth();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const checkSession = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session) return;

      const { data: profile } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", session.user.id)
        .single<ProfileRow>();

      const roles = Array.isArray(profile?.role) ? profile.role : [];

      if (roles.includes("workshop")) {
        try {
          await ensureAuthenticatedWorkshopSlug(session.user.id);
        } catch (error) {
          console.error("Failed to initialize workshop public profile:", error);
        }
      }

      if (roles.includes("admin")) {
        router.push("/admin");
        return;
      }

      const savedRole = localStorage.getItem("activeRole");

      if (savedRole === "workshop" && roles.includes("workshop")) {
        router.push("/workshops/dashboard");
        return;
      }

      router.push("/customer/dashboard");
    };

    checkSession();
  }, [router]);

  const goToDashboard = (selectedRole: UserRole, roles: string[]) => {
    if (roles.includes("admin")) {
      router.push("/admin");
      return;
    }

    if (selectedRole === "workshop" && !roles.includes("workshop")) {
      alert("Acest cont nu are acces de service auto.");
      return;
    }

    if (selectedRole === "customer" && !roles.includes("customer")) {
      alert("Acest cont nu are acces de client.");
      return;
    }

    setActiveRole(selectedRole);
    localStorage.setItem("activeRole", selectedRole);

    if (selectedRole === "workshop") {
      router.push("/workshops/dashboard");
      return;
    }

    router.push("/customer/dashboard");
  };

  const handleLogin = async () => {
    if (!email || !password) {
      alert("Te rugăm să introduci emailul și parola.");
      return;
    }

    setLoading(true);

    try {
      if (process.env.NODE_ENV === "development") {
        console.log("[AUTH] login:start");
      }

      const { data, error } = await withTimeout(
        supabase.auth.signInWithPassword({
          email,
          password,
        }),
        SIGN_IN_TIMEOUT_MS,
        "Sign in",
      );

      if (error) {
        alert(error.message);
        return;
      }

      const { data: profile, error: profileError } = await withTimeout(
        supabase
          .from("profiles")
          .select("role")
          .eq("id", data.user.id)
          .single<ProfileRow>(),
        PROFILE_TIMEOUT_MS,
        "Profile lookup",
      );

      if (profileError) {
        alert(profileError.message);
        return;
      }

      const roles = Array.isArray(profile?.role) ? profile.role : [];

      if (roles.includes("workshop")) {
        try {
          await withTimeout(
            ensureAuthenticatedWorkshopSlug(data.user.id),
            PROFILE_TIMEOUT_MS,
            "Workshop profile initialization",
          );
        } catch (error) {
          if (error instanceof AsyncTimeoutError) {
            throw error;
          }

          console.error("Failed to initialize workshop public profile:", error);
        }
      }

      const savedRole = localStorage.getItem("activeRole") as UserRole | null;

      if (savedRole === "workshop" && roles.includes("workshop")) {
        goToDashboard("workshop", roles);
        return;
      }

      if (savedRole === "customer" && roles.includes("customer")) {
        goToDashboard("customer", roles);
        return;
      }

      if (roles.includes("workshop") && !roles.includes("customer")) {
        goToDashboard("workshop", roles);
        return;
      }

      if (roles.includes("customer")) {
        goToDashboard("customer", roles);
        return;
      }

      alert("Contul nu are un rol valid.");
    } catch (err) {
      if (err instanceof AsyncTimeoutError) {
        if (process.env.NODE_ENV === "development") {
          console.warn("[AUTH] login:timeout");
        }

        alert(AUTH_TIMEOUT_MESSAGE);
        return;
      }

      console.error("Login failed:", err);
      alert("A apărut o problemă la autentificare.");
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async () => {
    if (!email) {
      alert("Introdu emailul mai întâi.");
      return;
    }

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: "http://localhost:3000/reset-password",
    });

    if (error) {
      alert(error.message);
    } else {
      alert("Verifică emailul pentru resetarea parolei.");
    }
  };

  const handleGoogleLogin = async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    });

    if (error) {
      alert(error.message);
    }
  };

  return (
    <main className="min-h-screen bg-[#101010] px-4 py-6 text-white">
      <div className="mx-auto flex min-h-[85vh] max-w-md items-center justify-center">
        <div className="w-full rounded-[32px] bg-white p-6 text-black shadow-2xl">
          <div className="mb-8 text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-3xl bg-black text-xl shadow-lg">
              🚗
            </div>

            <p className="text-xs font-semibold uppercase tracking-[0.25em] text-orange-500">
              AutoRepair Marketplace
            </p>

            <h1 className="mt-4 text-3xl font-black tracking-tight">
              Autentificare
            </h1>

            <p className="mt-2 text-sm leading-6 text-black/55">
              Intră în contul tău pentru a continua.
            </p>
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleLogin();
            }}
            className="space-y-4"
          >
            <div>
              <label className="mb-2 block text-sm font-semibold text-black/70">
                Email
              </label>
              <input
                type="email"
                name="email"
                autoComplete="username"
                placeholder="email@exemplu.ro"
                required
                className="w-full rounded-2xl border border-black/10 bg-black/[0.03] px-4 py-4 text-base outline-none transition focus:border-orange-400 focus:bg-white"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-semibold text-black/70">
                Parolă
              </label>
              <input
                type="password"
                name="password"
                autoComplete="current-password"
                placeholder="Introdu parola"
                required
                className="w-full rounded-2xl border border-black/10 bg-black/[0.03] px-4 py-4 text-base outline-none transition focus:border-orange-400 focus:bg-white"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="mt-3 w-full rounded-2xl bg-black py-4 font-bold text-white shadow-lg transition active:scale-[0.99] disabled:opacity-60"
            >
              {loading ? "Te rugăm așteaptă..." : "Intră în cont"}
            </button>

            <button
              type="button"
              onClick={handleResetPassword}
              className="w-full pt-1 text-center text-sm font-medium text-black/55 underline underline-offset-4"
            >
              Ai uitat parola?
            </button>

            <div className="flex items-center gap-3 py-3">
              <div className="h-px flex-1 bg-black/10" />
              <span className="text-xs text-black/40">sau</span>
              <div className="h-px flex-1 bg-black/10" />
            </div>

            <button
              type="button"
              onClick={handleGoogleLogin}
              className="flex w-full items-center justify-center gap-3 rounded-2xl border border-black/10 py-3.5 font-semibold text-black transition active:scale-[0.99]"
            >
              <span className="text-xl font-black">G</span>
              Continuă cu Google
            </button>

            <button
              type="button"
              disabled
              className="flex w-full items-center justify-center gap-3 rounded-2xl border border-black/10 py-3.5 font-semibold text-black/35"
            >
              <span className="text-xl"></span>
              Continuă cu Apple
            </button>

            <div className="pt-5 text-center text-sm text-black/55">
              Nu ai un cont?{" "}
              <button
                type="button"
                onClick={() => router.push("/register")}
                className="font-bold text-orange-500"
              >
                Creează cont
              </button>
            </div>
          </form>
        </div>
      </div>
    </main>
  );
}
