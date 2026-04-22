"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";

type UserRole = "customer" | "workshop";

type ProfileRow = {
  role: string[] | null;
};

export default function LoginPage() {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<UserRole>("customer");
  const [loading, setLoading] = useState(false);

  const handleSignUp = async () => {
    if (!email || !password) {
      alert("Please enter email and password.");
      return;
    }

    setLoading(true);

    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
      });

      if (error) {
        alert(error.message);
        return;
      }

      const userId = data.user?.id;

      if (userId) {
        const { data: existingProfile, error: fetchProfileError } = await supabase
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
      }

      if (data.session) {
  alert("Account created and logged in successfully.");

  if (role === "workshop") {
    router.push("/workshops/dashboard");
  } else {
    router.push("/");
  }
} else {
  alert("Account created successfully. You can now log in.");
}
    } catch (err) {
      console.error("Sign up failed:", err);
      alert("Something went wrong during sign up.");
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = async () => {
    if (!email || !password) {
      alert("Please enter email and password.");
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

      const userId = data.user.id;

      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", userId)
        .single<ProfileRow>();

      if (profileError) {
        alert(profileError.message);
        return;
      }

      const roles = Array.isArray(profile?.role) ? profile.role : [];

if (roles.includes("admin")) {
  router.push("/admin");
  return;
}

if (roles.length > 1) {
  router.push("/account");
  return;
}

if (roles.includes("workshop")) {
  router.push("/workshops");
} else {
  router.push("/");
}
    } catch (err) {
      console.error("Login failed:", err);
      alert("Something went wrong during login.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-black px-6 py-10 text-white">
      <div className="mx-auto flex min-h-[70vh] max-w-md items-center justify-center">
        <div className="w-full rounded-2xl border border-white/10 bg-white/5 p-8">
          <div className="mb-8">
            <p className="text-sm uppercase tracking-[0.2em] text-white/40">
              Access
            </p>
            <h1 className="mt-2 text-3xl font-bold md:text-4xl">
              Login / Register
            </h1>
            <p className="mt-3 text-white/70">
              Access the marketplace as customer or workshop.
            </p>
          </div>

          <div className="space-y-4">
            <div>
              <label className="mb-2 block text-sm text-white/70">Email</label>
              <input
                type="email"
                placeholder="you@example.com"
                className="w-full rounded-lg border border-white/20 bg-black px-4 py-3 outline-none focus:border-white/40"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>

            <div>
              <label className="mb-2 block text-sm text-white/70">Password</label>
              <input
                type="password"
                placeholder="Enter password"
                className="w-full rounded-lg border border-white/20 bg-black px-4 py-3 outline-none focus:border-white/40"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>

            <div>
              <label className="mb-2 block text-sm text-white/70">
                Account type
              </label>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as UserRole)}
                className="w-full rounded-lg border border-white/20 bg-black px-4 py-3 outline-none focus:border-white/40"
              >
                <option value="customer">Customer</option>
                <option value="workshop">Workshop</option>
              </select>
            </div>
          </div>

          <div className="mt-6 flex flex-col gap-3">
            <button
              onClick={handleLogin}
              disabled={loading}
              className="rounded-lg bg-white py-3 font-semibold text-black transition hover:opacity-90 disabled:opacity-60"
            >
              {loading ? "Please wait..." : "Login"}
            </button>

            <button
              onClick={handleSignUp}
              disabled={loading}
              className="rounded-lg border border-white/20 py-3 font-semibold text-white transition hover:bg-white/10 disabled:opacity-60"
            >
              {loading ? "Please wait..." : "Create account"}
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}