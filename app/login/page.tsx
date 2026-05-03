"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import { useAuth } from "@/lib/auth-provider";

type UserRole = "customer" | "workshop";

type ProfileRow = {
  role: string[] | null;
};

export default function LoginPage() {
  const router = useRouter();

  const { setActiveRole } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<UserRole>("customer");
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

      if (roles.includes("admin")) {
        router.push("/admin");
        return;
      }

      router.push("/customer/dashboard");
    };

    checkSession();
  }, [router]);

  const goToDashboard = (selectedRole: UserRole, roles: string[]) => {
    setActiveRole(selectedRole);

    if (roles.includes("admin")) {
      router.push("/admin");
      return;
    }

    router.push("/customer/dashboard");
  };

  const handleSignUp = async () => {
    if (!email || !password) {
      alert("Te rugăm să introduci emailul și parola.");
      return;
    }

    setLoading(true);

    try {
      const { data, error } = await supabase.auth.signUp({ email, password });

      if (error) {
        alert(error.message);
        return;
      }

      const userId = data.user?.id;

      if (userId) {
        const { data: existingProfile, error: fetchProfileError } =
          await supabase
            .from("profiles")
            .select("role")
            .eq("id", userId)
            .maybeSingle<ProfileRow>();

        if (fetchProfileError) {
          alert(fetchProfileError.message);
          return;
        }

        const existingRoles = Array.isArray(existingProfile?.role)
          ? existingProfile.role
          : [];

        const mergedRoles = Array.from(new Set([...existingRoles, role]));

        const { error: profileError } = await supabase.from("profiles").upsert({
          id: userId,
          email,
          role: mergedRoles,
        });

        if (profileError) {
          alert(profileError.message);
          return;
        }

        if (data.session) {
          goToDashboard(role, mergedRoles);
        } else {
          alert("Cont creat cu succes. Te poți autentifica acum.");
        }
      }
    } catch (err) {
      console.error("Sign up failed:", err);
      alert("A apărut o problemă la crearea contului.");
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = async () => {
    if (!email || !password) {
      alert("Te rugăm să introduci emailul și parola.");
      return;
    }

    setLoading(true);

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        alert(error.message);
        return;
      }

      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", data.user.id)
        .single<ProfileRow>();

      if (profileError) {
        alert(profileError.message);
        return;
      }

      const roles = Array.isArray(profile?.role) ? profile.role : [];
      goToDashboard(role, roles);
    } catch (err) {
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

  return (
    <main className="min-h-screen bg-[#101010] px-4 py-6 text-white">
      <div className="mx-auto flex min-h-[85vh] max-w-md items-center justify-center">
        <div className="w-full rounded-[28px] bg-white p-6 text-black shadow-2xl">
          <div className="mb-6 text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-black text-sm font-bold text-white">
              AR
            </div>

            <p className="text-xs uppercase tracking-[0.25em] text-orange-500">
              AutoRepair Marketplace
            </p>

            <h1 className="mt-3 text-2xl font-bold">Autentificare</h1>

            <p className="mt-2 text-sm text-black/55">
              Intră în cont sau creează un cont nou.
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
              <label className="mb-2 block text-sm font-medium text-black/70">
                Email
              </label>
              <input
                type="email"
                name="email"
                autoComplete="username"
                placeholder="email@exemplu.ro"
                required
                className="w-full rounded-2xl border border-black/10 bg-black/[0.03] px-4 py-3 outline-none focus:border-orange-400"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-black/70">
                Parolă
              </label>
              <input
                type="password"
                name="password"
                autoComplete="current-password"
                placeholder="Introdu parola"
                required
                className="w-full rounded-2xl border border-black/10 bg-black/[0.03] px-4 py-3 outline-none focus:border-orange-400"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-black/70">
                Tip cont
              </label>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as UserRole)}
                className="w-full rounded-2xl border border-black/10 bg-black/[0.03] px-4 py-3 outline-none focus:border-orange-400"
              >
                <option value="customer">Client</option>
                <option value="workshop">Service auto</option>
              </select>
            </div>

            <div className="mt-6 flex flex-col gap-3">
              <button
                type="submit"
                disabled={loading}
                className="rounded-2xl bg-black py-4 font-semibold text-white transition active:scale-[0.99] disabled:opacity-60"
              >
                {loading ? "Te rugăm așteaptă..." : "Intră în cont"}
              </button>

              <button
                type="button"
                onClick={handleSignUp}
                disabled={loading}
                className="rounded-2xl border border-black/10 py-4 font-semibold text-black transition active:scale-[0.99] disabled:opacity-60"
              >
                {loading ? "Te rugăm așteaptă..." : "Creează cont"}
              </button>

              <button
                type="button"
                onClick={handleResetPassword}
                className="text-sm text-blue-500 underline"
              >
                Ai uitat parola?
              </button>
            </div>
          </form>
        </div>
      </div>
    </main>
  );
}
