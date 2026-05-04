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
};

export default function WorkshopDashboardPage() {
  const router = useRouter();

  const [authorized, setAuthorized] = useState(false);
  const [checkingAccess, setCheckingAccess] = useState(true);
  const [stats, setStats] = useState<DashboardStats>({
    openRequests: 0,
    myOffers: 0,
    wonJobs: 0,
  });

  useEffect(() => {
    const checkUserAndLoad = async () => {
      try {
        const { data: authData } = await supabase.auth.getUser();

        if (!authData.user) {
          router.push("/login");
          return;
        }

        const { data: profile } = await supabase
          .from("profiles")
          .select("role")
          .eq("id", authData.user.id)
          .single<ProfileRow>();

        const roles = Array.isArray(profile?.role) ? profile.role : [];

        if (!roles.includes("workshop")) {
          router.push("/");
          return;
        }

        setAuthorized(true);
        await loadStats(authData.user.id);
      } catch {
        router.push("/login");
      } finally {
        setCheckingAccess(false);
      }
    };

    checkUserAndLoad();
  }, [router]);

  const loadStats = async (userId: string) => {
    try {
      const [openRequestsResult, myOffersResult, wonJobsResult] =
        await Promise.all([
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
            .select(
              `
              id,
              repair_requests!inner (
                id,
                status,
                accepted_offer_id
              )
            `,
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
        wonJobs: wonCount,
      });
    } catch {
      setStats({
        openRequests: 0,
        myOffers: 0,
        wonJobs: 0,
      });
    }
  };

  if (checkingAccess) {
    return (
      <main className="min-h-screen bg-black flex items-center justify-center text-white">
        Se verifică accesul...
      </main>
    );
  }

  if (!authorized) return null;

  return (
    <main className="h-[calc(100svh-236px)] overflow-hidden bg-black px-4 pb-4 pt-4 text-white">
      <div className="mx-auto max-w-md">
        <section className="mb-5 text-center">
          <p className="text-[11px] uppercase tracking-[0.26em] text-orange-400">
            PANOU SERVICE
          </p>
        </section>

        <section className="grid grid-cols-2 gap-4">
          <DashboardCard
            href="/workshops"
            icon="🔎"
            title="DAUNE DISPONIBILE"
            description="Cererile clienților"
            value={stats.openRequests}
          />

          <DashboardCard
            href="/workshops/my-offers"
            icon="€"
            title="OFERTELE TALE"
            description="Oferte trimise"
            value={stats.myOffers}
          />

          <DashboardCard
            href="/workshops/won-jobs"
            icon="✓"
            title="LUCRĂRI CÂȘTIGATE"
            description="Joburi acceptate"
            value={stats.wonJobs}
            full
          />
        </section>
      </div>
    </main>
  );
}

function DashboardCard({
  href,
  icon,
  title,
  description,
  value,
  full,
}: {
  href: string;
  icon: string;
  title: string;
  description: string;
  value: string | number;
  full?: boolean;
}) {
  return (
    <Link
      href={href}
      className={`relative flex min-h-[128px] flex-col items-center justify-center rounded-[1.7rem] bg-white px-4 py-6 text-center text-black shadow-xl transition duration-200 active:scale-[0.97] ${
        full ? "col-span-2" : ""
      }`}
    >
      <div className="absolute right-4 top-4 rounded-full bg-black px-2.5 py-1 text-xs font-semibold text-white shadow-md">
        {value}
      </div>

      <div className="flex h-14 w-14 items-center justify-center rounded-3xl bg-[#EAD7B7] text-3xl">
        {icon}
      </div>

      <h2 className="mt-4 text-[17px] font-extrabold leading-tight tracking-tight">
        {title}
      </h2>

      <p className="mt-2 text-[13px] text-black/50">{description}</p>
    </Link>
  );
}
