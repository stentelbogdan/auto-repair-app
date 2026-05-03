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
            { count: "exact", head: false },
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
          <p className="text-white/60">Se verifică accesul...</p>
        </div>
      </main>
    );
  }

  if (!authorized) {
    return null;
  }

  return (
  <main className="min-h-screen bg-black px-4 py-8 text-white">
    <div className="mx-auto max-w-7xl">
      <section className="mb-6 text-center">
        <p className="text-[11px] uppercase tracking-[0.26em] text-orange-400">
          PANOU SERVICE
        </p>

        <div className="mt-6 grid grid-cols-3 gap-3">
          <MiniStat
            label="Daune"
            value={loadingStats ? "..." : stats.openRequests}
          />
          <MiniStat
            label="Oferte"
            value={loadingStats ? "..." : stats.myOffers}
          />
          <MiniStat
            label="Câștigate"
            value={loadingStats ? "..." : stats.wonJobs}
          />
        </div>
      </section>

      <section className="grid grid-cols-2 gap-4">
        <DashboardCard
          href="/workshops"
          icon="🔎"
          title="DAUNE DISPONIBILE"
          description="Cererile clienților"
          value={loadingStats ? "..." : stats.openRequests}
        />

        <DashboardCard
          href="/workshops/my-offers"
          icon="€"
          title="OFERTELE TALE"
          description="Oferte trimise"
          value={loadingStats ? "..." : stats.myOffers}
        />

        <DashboardCard
          href="/workshops/won-jobs"
          icon="✓"
          title="LUCRĂRI CÂȘTIGATE"
          description="Joburi acceptate"
          value={loadingStats ? "..." : stats.wonJobs}
        />
      </section>
    </div>
  </main>
);
}

function MiniStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/40 px-4 py-4 text-center">
      <p className="text-2xl font-bold text-white">{value}</p>
      <p className="mt-1 text-[11px] text-white/45">{label}</p>
    </div>
  );
}

function DashboardCard({
  href,
  icon,
  title,
  description,
  value,
}: {
  href: string;
  icon: string;
  title: string;
  description: string;
  value: string | number;
}) {
  return (
    <Link
      href={href}
      className="relative flex min-h-[128px] flex-col items-center justify-center rounded-[1.7rem] bg-white px-3 py-5 text-center text-black shadow-xl transition active:scale-[0.98]"
    >
      <div className="absolute right-4 top-4 flex h-7 min-w-7 items-center justify-center rounded-full bg-black px-2 text-xs font-bold text-white">
        {value}
      </div>

      <div className="flex h-16 w-16 items-center justify-center rounded-3xl bg-orange-100 text-3xl font-bold">
        {icon}
      </div>

      <h2 className="mt-4 text-[18px] font-black leading-tight tracking-tight">
        {title}
      </h2>

      <p className="mt-2 text-[13px] leading-tight text-black/50">
        {description}
      </p>
    </Link>
  );
}
