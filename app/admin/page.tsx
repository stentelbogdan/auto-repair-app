"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";

type AdminOverview = {
  total_users: number;
  total_customers: number;
  total_workshops: number;
  open_requests: number;
  in_progress_jobs: number;
  completed_jobs: number;
  closed_requests: number;
  total_reviews: number;
};

type LoadState =
  | { status: "loading" }
  | { status: "ready"; overview: AdminOverview }
  | { status: "error" };

const KPI_LABELS: Array<{
  key: keyof AdminOverview;
  label: string;
}> = [
  { key: "total_users", label: "Utilizatori" },
  { key: "total_customers", label: "Clienți" },
  { key: "total_workshops", label: "Service-uri" },
  { key: "open_requests", label: "Cereri active" },
  { key: "in_progress_jobs", label: "În lucru" },
  { key: "completed_jobs", label: "Finalizate" },
  { key: "closed_requests", label: "Închise" },
  { key: "total_reviews", label: "Review-uri" },
];

function isUnauthorizedError(error: { code?: string } | null): boolean {
  return error?.code === "42501";
}

export default function AdminPage() {
  const router = useRouter();
  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });

  const loadOverview = useCallback(async () => {
    setLoadState({ status: "loading" });

    try {
      const {
        data: { session },
        error: sessionError,
      } = await supabase.auth.getSession();

      if (sessionError) {
        throw sessionError;
      }

      if (!session) {
        router.replace("/login");
        return;
      }

      const { data, error } = await supabase
        .rpc("get_admin_overview")
        .single<AdminOverview>();

      if (isUnauthorizedError(error)) {
        router.replace("/");
        return;
      }

      if (error || !data) {
        throw error ?? new Error("Admin overview is unavailable.");
      }

      setLoadState({ status: "ready", overview: data });
    } catch (error) {
      console.error("Failed to load admin overview:", error);
      setLoadState({ status: "error" });
    }
  }, [router]);

  useEffect(() => {
    void loadOverview();
  }, [loadOverview]);

  if (loadState.status === "loading") {
    return (
      <main className="flex min-h-screen items-center justify-center bg-black px-6 text-white">
        <p className="text-white/70">Se verifică accesul...</p>
      </main>
    );
  }

  if (loadState.status === "error") {
    return (
      <main className="flex min-h-screen items-center justify-center bg-black px-6 text-white">
        <div className="w-full max-w-md rounded-2xl border border-white/10 bg-white/5 p-6 text-center">
          <h1 className="text-xl font-semibold">Dashboard indisponibil</h1>
          <p className="mt-2 text-sm text-white/60">
            Datele nu au putut fi încărcate. Încearcă din nou.
          </p>
          <button
            type="button"
            onClick={() => void loadOverview()}
            className="mt-5 rounded-xl bg-white px-5 py-3 text-sm font-semibold text-black transition hover:bg-white/90"
          >
            Reîncearcă
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-black px-6 py-10 text-white">
      <div className="mx-auto max-w-7xl">
        <div className="mb-8">
          <p className="text-sm uppercase tracking-[0.2em] text-white/40">
            Admin dashboard
          </p>
          <h1 className="mt-2 text-3xl font-bold md:text-4xl">
            Marketplace overview
          </h1>
          <p className="mt-3 max-w-3xl text-white/70">
            O vedere de ansamblu a activității din marketplace.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {KPI_LABELS.map(({ key, label }) => (
            <KpiCard
              key={key}
              label={label}
              value={loadState.overview[key]}
            />
          ))}
        </div>
      </div>
    </main>
  );
}

function KpiCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-6 shadow-lg">
      <p className="text-sm text-white/50">{label}</p>
      <p className="mt-2 text-4xl font-bold text-white">
        {value.toLocaleString("ro-RO")}
      </p>
    </div>
  );
}
