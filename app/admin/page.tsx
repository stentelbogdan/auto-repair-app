"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
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

type LoadOverviewOptions = {
  background?: boolean;
};

const KPI_LABELS: Array<{
  key: keyof AdminOverview;
  label: string;
  href?: string;
}> = [
  { key: "total_customers", label: "Clienți", href: "/admin/customers" },
  {
    key: "total_workshops",
    label: "Service-uri",
    href: "/admin/workshops",
  },
  {
    key: "open_requests",
    label: "Cereri active",
    href: "/admin/requests",
  },
  { key: "total_reviews", label: "Review-uri", href: "/admin/reviews" },
];

function isUnauthorizedError(error: { code?: string } | null): boolean {
  return error?.code === "42501";
}

export default function AdminPage() {
  const router = useRouter();
  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });
  const mountedRef = useRef(false);
  const loadGenerationRef = useRef(0);
  const refreshInFlightRef = useRef(false);
  const refreshPendingRef = useRef(false);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadOverview = useCallback(async (options?: LoadOverviewOptions) => {
    const background = options?.background ?? false;
    const generation = loadGenerationRef.current + 1;
    loadGenerationRef.current = generation;
    const isCurrentLoad = () =>
      mountedRef.current && loadGenerationRef.current === generation;

    if (!background) {
      setLoadState({ status: "loading" });
    }

    try {
      const {
        data: { session },
        error: sessionError,
      } = await supabase.auth.getSession();

      if (sessionError) {
        throw sessionError;
      }

      if (!isCurrentLoad()) return;

      if (!session) {
        router.replace("/login");
        return;
      }

      const { data, error } = await supabase
        .rpc("get_admin_overview")
        .single<AdminOverview>();

      if (!isCurrentLoad()) return;

      if (isUnauthorizedError(error)) {
        router.replace("/");
        return;
      }

      if (error || !data) {
        throw error ?? new Error("Admin overview is unavailable.");
      }

      setLoadState({ status: "ready", overview: data });
    } catch (error) {
      if (!isCurrentLoad()) return;

      console.error("Failed to load admin overview:", error);
      if (!background) {
        setLoadState({ status: "error" });
      }
    }
  }, [router]);

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
      loadGenerationRef.current += 1;
    };
  }, []);

  useEffect(() => {
    void loadOverview();
  }, [loadOverview]);

  useEffect(() => {
    if (loadState.status !== "ready") return;

    let active = true;

    const runRefresh = async () => {
      if (!active || refreshInFlightRef.current) return;

      refreshInFlightRef.current = true;

      try {
        do {
          refreshPendingRef.current = false;
          await loadOverview({ background: true });
        } while (active && refreshPendingRef.current);
      } finally {
        refreshInFlightRef.current = false;
      }
    };

    const scheduleRefresh = () => {
      if (!active) return;

      if (refreshTimerRef.current !== null) {
        clearTimeout(refreshTimerRef.current);
      }

      refreshTimerRef.current = setTimeout(() => {
        refreshTimerRef.current = null;

        if (!active) return;

        if (refreshInFlightRef.current) {
          refreshPendingRef.current = true;
          return;
        }

        void runRefresh();
      }, 250);
    };

    const channel = supabase
      .channel("admin-dashboard-overview-live")
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "admin_dashboard_refresh_signal",
        },
        scheduleRefresh,
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          scheduleRefresh();
        }
      });

    return () => {
      active = false;
      refreshPendingRef.current = false;
      loadGenerationRef.current += 1;

      if (refreshTimerRef.current !== null) {
        clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }

      void supabase.removeChannel(channel);
    };
  }, [loadOverview, loadState.status]);

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
          {KPI_LABELS.map(({ key, label, href }) => (
            <KpiCard
              key={key}
              label={label}
              value={loadState.overview[key]}
              href={href}
            />
          ))}
        </div>
      </div>
    </main>
  );
}

function KpiCard({
  label,
  value,
  href,
}: {
  label: string;
  value: number;
  href?: string;
}) {
  const content = (
    <>
      <p className="text-sm text-white/50">{label}</p>
      <p className="mt-2 text-4xl font-bold text-white">
        {value.toLocaleString("ro-RO")}
      </p>
    </>
  );

  if (href) {
    return (
      <Link
        href={href}
        className="rounded-2xl border border-orange-400/30 bg-white/5 p-6 shadow-lg transition hover:border-orange-400/60 hover:bg-white/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400/70"
      >
        {content}
      </Link>
    );
  }

  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-6 shadow-lg">
      {content}
    </div>
  );
}
