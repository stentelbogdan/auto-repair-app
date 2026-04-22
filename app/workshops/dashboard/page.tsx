"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";

type ProfileRow = {
  role: string[] | null;
};

type DashboardStats = {
  openRequests: number;
  myOffers: number;
  wonJobs: number;
  pendingOffers: number;
};

export default function WorkshopDashboardPage() {
  const router = useRouter();

  const [authorized, setAuthorized] = useState(false);
  const [checkingAccess, setCheckingAccess] = useState(true);
  const [loadingStats, setLoadingStats] = useState(false);
  const [stats, setStats] = useState<DashboardStats>({
    openRequests: 0,
    myOffers: 0,
    wonJobs: 0,
    pendingOffers: 0,
  });

  useEffect(() => {
    const checkUserAndLoad = async () => {
      try {
        const { data: authData } = await supabase.auth.getUser();

        if (!authData.user) {
          router.push("/login");
          return;
        }

        const { data: profile, error: profileError } = await supabase
          .from("profiles")
          .select("role")
          .eq("id", authData.user.id)
          .single<ProfileRow>();

        if (profileError) {
          console.error("Failed to load profile:", profileError);
          router.push("/");
          return;
        }

        const roles = Array.isArray(profile?.role) ? profile.role : [];

        if (!roles.includes("workshop")) {
          router.push("/");
          return;
        }

        setAuthorized(true);
        await loadStats(authData.user.id);
      } catch (error) {
        console.error("Access check failed:", error);
        router.push("/login");
      } finally {
        setCheckingAccess(false);
      }
    };

    checkUserAndLoad();
  }, [router]);

  const loadStats = async (userId: string) => {
    setLoadingStats(true);

    try {
      const [
        openRequestsResult,
        myOffersResult,
        pendingOffersResult,
        wonJobsResult,
      ] = await Promise.all([
        supabase
          .from("repair_requests")
          .select("id", { count: "exact", head: true })
          .neq("status", "matched"),

        supabase
          .from("repair_offers")
          .select("id", { count: "exact", head: true })
          .eq("workshop_id", userId),

        supabase
          .from("repair_offers")
          .select("id", { count: "exact", head: true })
          .eq("workshop_id", userId)
          .or("status.is.null,status.eq.pending"),

        supabase
          .from("repair_offers")
          .select(
            `
            id,
            repair_requests!inner (
              id,
              status,
              accepted_offer_id
            )
          `,
            { count: "exact", head: false }
          )
          .eq("workshop_id", userId)
          .eq("repair_requests.status", "matched"),
      ]);

      const wonCount =
        wonJobsResult.data?.filter((row: any) => {
          const request = Array.isArray(row.repair_requests)
            ? row.repair_requests[0]
            : row.repair_requests;

          return request?.accepted_offer_id === row.id;
        }).length || 0;

      setStats({
        openRequests: openRequestsResult.count || 0,
        myOffers: myOffersResult.count || 0,
        pendingOffers: pendingOffersResult.count || 0,
        wonJobs: wonCount,
      });
    } catch (error) {
      console.error("Failed to load workshop stats:", error);
      setStats({
        openRequests: 0,
        myOffers: 0,
        wonJobs: 0,
        pendingOffers: 0,
      });
    } finally {
      setLoadingStats(false);
    }
  };

  if (checkingAccess) {
    return (
      <main className="min-h-screen bg-black px-6 py-10 text-white">
        <div className="mx-auto flex min-h-[60vh] max-w-7xl items-center justify-center">
          <p className="text-white/70">Checking access...</p>
        </div>
      </main>
    );
  }

  if (!authorized) {
    return null;
  }

  return (
    <main className="min-h-screen bg-black px-6 py-10 text-white">
      <div className="mx-auto max-w-7xl">
        <div className="mb-6 flex flex-wrap gap-3">
          <Link
            href="/workshops/dashboard"
            className="rounded-lg bg-white px-4 py-2 text-sm font-semibold text-black"
          >
            Dashboard
          </Link>
          <Link
            href="/workshops"
            className="rounded-lg border border-white/15 bg-white/5 px-4 py-2 text-sm font-medium text-white/80 transition hover:bg-white/10"
          >
            Browse requests
          </Link>
          <Link
            href="/workshops/my-offers"
            className="rounded-lg border border-white/15 bg-white/5 px-4 py-2 text-sm font-medium text-white/80 transition hover:bg-white/10"
          >
            My offers
          </Link>
          <Link
            href="/workshops/won-jobs"
            className="rounded-lg border border-white/15 bg-white/5 px-4 py-2 text-sm font-medium text-white/80 transition hover:bg-white/10"
          >
            Won jobs
          </Link>
        </div>

        <div className="mb-10">
          <p className="text-sm uppercase tracking-[0.2em] text-white/40">
            Workshop dashboard
          </p>
          <h1 className="mt-2 text-3xl font-bold md:text-4xl">
            Manage your workshop
          </h1>
          <p className="mt-3 max-w-2xl text-white/70">
            Browse jobs, track offers, and manage the work you win.
          </p>
        </div>

        <div className="mb-8 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label="Open requests"
            value={loadingStats ? "..." : stats.openRequests}
          />
          <StatCard
            label="My offers"
            value={loadingStats ? "..." : stats.myOffers}
          />
          <StatCard
            label="Pending offers"
            value={loadingStats ? "..." : stats.pendingOffers}
          />
          <StatCard
            label="Won jobs"
            value={loadingStats ? "..." : stats.wonJobs}
          />
        </div>

        <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
          <Link
            href="/workshops"
            className="rounded-2xl border border-white/10 bg-white/5 p-6 transition hover:bg-white/10"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-2xl font-semibold">Browse requests</h2>
                <p className="mt-3 text-sm leading-6 text-white/70">
                  View all open repair requests and send offers to customers.
                </p>
              </div>
              <span className="rounded-xl bg-white px-3 py-2 text-sm font-bold text-black">
                {loadingStats ? "..." : stats.openRequests}
              </span>
            </div>
          </Link>

          <Link
            href="/workshops/my-offers"
            className="rounded-2xl border border-white/10 bg-white/5 p-6 transition hover:bg-white/10"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-2xl font-semibold">My offers</h2>
                <p className="mt-3 text-sm leading-6 text-white/70">
                  Track pending offers and see all offers sent by your workshop.
                </p>
              </div>
              <span className="rounded-xl bg-white px-3 py-2 text-sm font-bold text-black">
                {loadingStats ? "..." : stats.myOffers}
              </span>
            </div>
          </Link>

          <Link
            href="/workshops/won-jobs"
            className="rounded-2xl border border-white/10 bg-white/5 p-6 transition hover:bg-white/10"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-2xl font-semibold">Won jobs</h2>
                <p className="mt-3 text-sm leading-6 text-white/70">
                  Open accepted jobs and continue the repair workflow.
                </p>
              </div>
              <span className="rounded-xl bg-white px-3 py-2 text-sm font-bold text-black">
                {loadingStats ? "..." : stats.wonJobs}
              </span>
            </div>
          </Link>
        </div>
      </div>
    </main>
  );
}

function StatCard({
  label,
  value,
}: {
  label: string;
  value: string | number;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
      <p className="text-sm text-white/50">{label}</p>
      <p className="mt-2 text-3xl font-bold text-white">{value}</p>
    </div>
  );
}