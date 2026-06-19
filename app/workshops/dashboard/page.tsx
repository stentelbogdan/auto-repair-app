"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import { getWorkshopRepairRequests } from "@/lib/supabase/repair-requests";

type ProfileRow = {
  role: string[] | null;
};

type DashboardStats = {
  bodyworkRequests: number;
  mechanicalRequests: number;
  myOffers: number;
  wonJobs: number;
  directBodyworkUnread: number;
  directMechanicalUnread: number;
};

export default function WorkshopDashboardPage() {
  const router = useRouter();

  const [authorized, setAuthorized] = useState(false);
  const [checkingAccess, setCheckingAccess] = useState(true);
  const [stats, setStats] = useState<DashboardStats>({
    bodyworkRequests: 0,
    mechanicalRequests: 0,
    myOffers: 0,
    wonJobs: 0,
    directBodyworkUnread: 0,
    directMechanicalUnread: 0,
  });

  useEffect(() => {
    localStorage.setItem("activeRole", "workshop");
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
      const rows = await getWorkshopRepairRequests();

      const visibleBodyworkRows = rows.filter((req) => {
        const requestType = req.request_type ?? "repair";

        const isVisible =
          requestType === "repair" ||
          (requestType === "direct_request" &&
            req.target_workshop_id === userId);

        return (
          (req.service_type ?? "bodywork") === "bodywork" &&
          req.status === "open" &&
          isVisible
        );
      });

      const bodyworkRequestsCount = visibleBodyworkRows.length;

      const mechanicalRequestsResult = await supabase
        .from("repair_requests")
        .select("id", { count: "exact", head: true })
        .eq("status", "open")
        .eq("service_type", "mechanical")
        .or(
          `request_type.eq.repair,and(request_type.eq.direct_request,target_workshop_id.eq.${userId})`,
        );

      const mechanicalRequestsCount = mechanicalRequestsResult.count || 0;

      const directBodyworkUnreadResult = await supabase
        .from("repair_requests")
        .select("id", { count: "exact", head: true })
        .eq("status", "open")
        .eq("service_type", "bodywork")
        .eq("target_workshop_id", userId)
        .is("target_workshop_read_at", null);

      const directMechanicalUnreadResult = await supabase
        .from("repair_requests")
        .select("id", { count: "exact", head: true })
        .eq("status", "open")
        .eq("service_type", "mechanical")
        .eq("target_workshop_id", userId)
        .is("target_workshop_read_at", null);

      const [myOffersResult, wonJobsResult] = await Promise.all([
        supabase
          .from("repair_offers")
          .select("id", { count: "exact", head: true })
          .eq("workshop_user_id", userId),

        supabase
          .from("repair_offers")
          .select(
            `
    id,
    status,
    repair_requests!inner (
      id,
      status
    )
  `,
          )
          .eq("workshop_user_id", userId)
          .eq("status", "accepted"),
      ]);

      const wonCount =
        wonJobsResult.data?.filter((row: any) => {
          const request = Array.isArray(row.repair_requests)
            ? row.repair_requests[0]
            : row.repair_requests;

          return (request?.status || "matched") !== "completed";
        }).length || 0;

      setStats({
        bodyworkRequests: bodyworkRequestsCount,
        mechanicalRequests: mechanicalRequestsResult.count || 0,
        myOffers: myOffersResult.count || 0,
        wonJobs: wonCount,
        directBodyworkUnread: directBodyworkUnreadResult.count || 0,
        directMechanicalUnread: directMechanicalUnreadResult.count || 0,
      });
    } catch {
      setStats({
        bodyworkRequests: 0,
        mechanicalRequests: 0,
        myOffers: 0,
        wonJobs: 0,
        directBodyworkUnread: 0,
        directMechanicalUnread: 0,
      });
    }
  };

  if (checkingAccess) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-black text-white">
        Se verifică accesul...
      </main>
    );
  }

  if (!authorized) return null;

  return (
    <main className="min-h-[calc(100svh-236px)] overflow-y-auto bg-black px-4 pb-4 pt-4 text-white landscape:overflow-y-auto">
      <div className="mx-auto max-w-md md:max-w-5xl">
        <section className="mb-5 text-center">
          <p className="text-[11px] uppercase tracking-[0.26em] text-orange-400">
            PANOU SERVICE
          </p>
        </section>

        <section className="mt-10 grid grid-cols-2 gap-3 md:mx-auto md:max-w-3xl md:gap-6">
          <DashboardCard
            href="/workshops"
            icon="🚗"
            title="Daune estetice"
            description="Cererile clienților"
            value={stats.bodyworkRequests}
            badge={stats.directBodyworkUnread}
          />

          <DashboardCard
            href="/workshops/mechanical"
            icon="⚙️"
            title="Daune mecanice"
            description="Cererile clienților"
            value={stats.mechanicalRequests}
            badge={stats.directMechanicalUnread}
          />

          <DashboardCard
            href="/workshops/my-offers"
            icon="€"
            title="Ofertele tale"
            description="Oferte trimise"
            value={stats.myOffers}
          />

          <DashboardCard
            href="/workshops/won-jobs"
            icon="✓"
            title="Lucrări câștigate"
            description="Joburi acceptate"
            value={stats.wonJobs}
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
  badge,
}: {
  href: string;
  icon: string;
  title: string;
  description: string;
  value: string | number;
  badge?: number;
}) {
  return (
    <Link href={href} className="w-full">
      <div className="relative w-full rounded-[20px] bg-white p-4 text-center text-black shadow-lg transition duration-200 active:scale-[0.98] hover:scale-[1.02] md:hover:shadow-2xl md:p-6">
        <div className="absolute right-4 top-4 rounded-full bg-black px-2.5 py-1 text-xs font-semibold text-white shadow-md">
          {value}
        </div>

        {badge && badge > 0 && (
          <div className="absolute -right-2 -top-2 flex h-6 min-w-6 items-center justify-center rounded-full bg-red-500 px-2 text-xs font-bold text-white shadow-md">
            {badge > 9 ? "9+" : badge}
          </div>
        )}

        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-orange-100 text-2xl font-bold md:h-14 md:w-14 md:text-3xl">
          {icon}
        </div>

        <h2 className="text-base font-bold leading-tight md:text-lg">
          {title}
        </h2>

        <p className="mt-1 text-xs leading-snug text-black/55 md:text-sm">
          {description}
        </p>
      </div>
    </Link>
  );
}
