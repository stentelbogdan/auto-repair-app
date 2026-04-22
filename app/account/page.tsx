"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";

type ProfileRow = {
  email: string | null;
  role: string[] | null;
};

export default function AccountPage() {
  const router = useRouter();

  const [email, setEmail] = useState<string>("");
  const [roles, setRoles] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const loadAccount = async () => {
      try {
        const { data: authData } = await supabase.auth.getUser();

        if (!authData.user) {
          router.push("/login");
          return;
        }

        const { data: profile, error } = await supabase
          .from("profiles")
          .select("email, role")
          .eq("id", authData.user.id)
          .single<ProfileRow>();

        if (error) {
          alert(error.message);
          router.push("/");
          return;
        }

        setEmail(profile?.email || authData.user.email || "");
        setRoles(Array.isArray(profile?.role) ? profile.role : []);
      } catch (error) {
        console.error("Failed to load account:", error);
        router.push("/");
      } finally {
        setLoading(false);
      }
    };

    loadAccount();
  }, [router]);

  const toggleRole = (role: "customer" | "workshop") => {
    setRoles((prev) => {
      if (prev.includes(role)) {
        const next = prev.filter((r) => r !== role);
        return next.length ? next : ["customer"];
      }

      return Array.from(new Set([...prev, role]));
    });
  };

  const handleSave = async () => {
    setSaving(true);

    try {
      const { data: authData } = await supabase.auth.getUser();

      if (!authData.user) {
        router.push("/login");
        return;
      }

      const safeRoles = roles.length ? roles : ["customer"];

      const { error } = await supabase
        .from("profiles")
        .update({ role: safeRoles })
        .eq("id", authData.user.id);

      if (error) {
        alert(error.message);
        return;
      }

      alert("Account roles updated successfully.");
      router.refresh();
    } catch (error) {
      console.error("Failed to save roles:", error);
      alert("Something went wrong while saving roles.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <main className="min-h-screen bg-black px-6 py-10 text-white">
        <div className="mx-auto flex min-h-[60vh] max-w-3xl items-center justify-center">
          <p className="text-white/70">Loading account...</p>
        </div>
      </main>
    );
  }

  const hasCustomer = roles.includes("customer");
  const hasWorkshop = roles.includes("workshop");
  const hasAdmin = roles.includes("admin");

  return (
    <main className="min-h-screen bg-black px-6 py-10 text-white">
      <div className="mx-auto max-w-3xl">
        <div className="mb-8">
          <p className="text-sm uppercase tracking-[0.2em] text-white/40">
            Account
          </p>
          <h1 className="mt-2 text-3xl font-bold md:text-4xl">
            Manage your access
          </h1>
          <p className="mt-3 max-w-2xl text-white/70">
            Enable customer and workshop access on the same account and jump
            directly into the area you want to use.
          </p>
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
          <div className="rounded-xl border border-white/10 bg-black/20 p-4">
            <p className="text-sm text-white/50">Email</p>
            <p className="mt-1 text-lg font-semibold text-white">{email}</p>
          </div>

          <div className="mt-4 rounded-xl border border-white/10 bg-black/20 p-4">
            <p className="text-sm text-white/50">Current roles</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {roles.length > 0 ? (
                roles.map((role) => (
                  <span
                    key={role}
                    className="rounded-full border border-white/10 bg-white/10 px-3 py-1 text-sm text-white"
                  >
                    {role}
                  </span>
                ))
              ) : (
                <span className="text-white/60">No roles assigned</span>
              )}
            </div>
          </div>

          <div className="mt-6 space-y-4">
            <div className="rounded-xl border border-white/10 bg-black/20 p-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="font-semibold text-white">Customer access</p>
                  <p className="mt-1 text-sm text-white/60">
                    Post repair jobs and review offers.
                  </p>
                </div>

                <button
                  onClick={() => toggleRole("customer")}
                  className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                    hasCustomer
                      ? "bg-white text-black"
                      : "bg-white/10 text-white hover:bg-white/20"
                  }`}
                >
                  {hasCustomer ? "Enabled" : "Enable"}
                </button>
              </div>
            </div>

            <div className="rounded-xl border border-white/10 bg-black/20 p-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="font-semibold text-white">Workshop access</p>
                  <p className="mt-1 text-sm text-white/60">
                    Browse jobs and send repair offers.
                  </p>
                </div>

                <button
                  onClick={() => toggleRole("workshop")}
                  className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                    hasWorkshop
                      ? "bg-white text-black"
                      : "bg-white/10 text-white hover:bg-white/20"
                  }`}
                >
                  {hasWorkshop ? "Enabled" : "Enable"}
                </button>
              </div>
            </div>

            <div className="rounded-xl border border-white/10 bg-black/20 p-4">
              <p className="font-semibold text-white">Admin access</p>
              <p className="mt-1 text-sm text-white/60">
                Admin remains managed manually in Supabase.
              </p>

              <div className="mt-3">
                <span
                  className={`rounded-full px-3 py-1 text-xs font-medium ${
                    hasAdmin
                      ? "border border-green-500/20 bg-green-500/15 text-green-300"
                      : "border border-white/10 bg-white/10 text-white/70"
                  }`}
                >
                  {hasAdmin ? "Admin enabled" : "Admin not enabled"}
                </span>
              </div>
            </div>
          </div>

          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <button
              onClick={handleSave}
              disabled={saving}
              className="rounded-lg bg-white px-6 py-3 font-semibold text-black disabled:opacity-60"
            >
              {saving ? "Saving..." : "Save access"}
            </button>

            <button
              onClick={() => router.push("/")}
              className="rounded-lg border border-white/20 px-6 py-3 font-semibold text-white"
            >
              Back to app
            </button>
          </div>

          <div className="mt-8 border-t border-white/10 pt-6">
            <p className="text-sm uppercase tracking-[0.2em] text-white/40">
              Quick access
            </p>

            <div className="mt-4 grid gap-3 md:grid-cols-3">
              <button
                onClick={() => router.push("/")}
                disabled={!hasCustomer}
                className="rounded-lg border border-white/20 px-4 py-3 font-semibold text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Go to customer area
              </button>

              <button
                onClick={() => router.push("/workshops")}
                disabled={!hasWorkshop}
                className="rounded-lg border border-white/20 px-4 py-3 font-semibold text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Go to workshop area
              </button>

              <button
                onClick={() => router.push("/admin")}
                disabled={!hasAdmin}
                className="rounded-lg border border-white/20 px-4 py-3 font-semibold text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Go to admin area
              </button>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}