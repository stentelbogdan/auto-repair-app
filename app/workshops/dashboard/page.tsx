"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import { getWorkshopRepairRequests } from "@/lib/supabase/repair-requests";

type ProfileRow = {
  role: string[] | null;
};

type DashboardStats = {
  bodyworkRequests: number;
  mechanicalRequests: number;
  wheelsRequests: number;
  towingRequests: number;
  myOffers: number;
  wonJobs: number;
  directBodyworkUnread: number;
  directMechanicalUnread: number;
};

export default function WorkshopDashboardPage() {
  return (
    <Suspense fallback={null}>
      <WorkshopDashboardContent />
    </Suspense>
  );
}

function WorkshopDashboardContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const showSuccessToast = searchParams.get("offerSent") === "1";

  useEffect(() => {
    if (!showSuccessToast) return;

    const timer = setTimeout(() => {
      router.replace("/workshops/dashboard");
    }, 1500);

    return () => clearTimeout(timer);
  }, [showSuccessToast, router]);

  const [authorized, setAuthorized] = useState(false);
  const [currentWorkshopUserId, setCurrentWorkshopUserId] = useState<
    string | null
  >(null);
  const [checkingAccess, setCheckingAccess] = useState(true);
  const [stats, setStats] = useState<DashboardStats>({
    bodyworkRequests: 0,
    mechanicalRequests: 0,
    wheelsRequests: 0,
    towingRequests: 0,
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

        setCurrentWorkshopUserId(authData.user.id);
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

  useEffect(() => {
    if (!authorized || !currentWorkshopUserId) return;

    let active = true;

    const refreshStats = async () => {
      const { data: authData } = await supabase.auth.getUser();

      if (!active || !authData.user) return;

      await loadStats(authData.user.id);
    };

    const channel = supabase
      .channel("workshop-dashboard-live")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "repair_requests",
        },
        refreshStats,
      )
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "repair_offers",
          filter: `workshop_user_id=eq.${currentWorkshopUserId}`,
        },
        refreshStats,
      )
      .subscribe();

    window.addEventListener("direct-requests-read-updated", refreshStats);
    window.addEventListener("focus", refreshStats);

    return () => {
      active = false;
      window.removeEventListener("direct-requests-read-updated", refreshStats);
      window.removeEventListener("focus", refreshStats);
      supabase.removeChannel(channel);
    };
  }, [authorized, currentWorkshopUserId]);

  const loadStats = async (userId: string) => {
    try {
      const rows = await getWorkshopRepairRequests();

      const { data: existingOffers, error: existingOffersError } =
        await supabase
          .from("repair_offers")
          .select("request_id")
          .eq("workshop_user_id", userId);

      if (existingOffersError) {
        console.error("Failed to load existing offers:", existingOffersError);
      }

      const offeredRequestIds = (existingOffers || [])
        .map((offer) => offer.request_id)
        .filter(Boolean);

      const visibleBodyworkRows = rows.filter((req) => {
        const requestType = req.request_type ?? "repair";

        const isVisible =
          requestType === "repair" ||
          (requestType === "direct_request" &&
            req.target_workshop_id === userId);

        return (
          (req.service_type ?? "bodywork") === "bodywork" &&
          req.status === "open" &&
          isVisible &&
          !offeredRequestIds.includes(req.id)
        );
      });

      const bodyworkRequestsCount = visibleBodyworkRows.length;

      const visibleMechanicalRows = rows.filter((req) => {
        const requestType = req.request_type ?? "repair";

        const isVisible =
          requestType === "repair" ||
          (requestType === "direct_request" &&
            req.target_workshop_id === userId);

        return (
          req.service_type === "mechanical" &&
          req.status === "open" &&
          !req.accepted_offer_id &&
          isVisible &&
          !offeredRequestIds.includes(req.id)
        );
      });

      const mechanicalRequestsCount = visibleMechanicalRows.length;

      const visibleWheelsRows = rows.filter((req) => {
        const requestType = req.request_type ?? "repair";

        const isVisible =
          requestType === "repair" ||
          (requestType === "direct_request" &&
            req.target_workshop_id === userId);

        return (
          req.service_type === "wheels" &&
          req.status === "open" &&
          !req.accepted_offer_id &&
          isVisible &&
          !offeredRequestIds.includes(req.id)
        );
      });

      const wheelsRequestsCount = visibleWheelsRows.length;

      const visibleTowingRows = rows.filter((req) => {
        const requestType = req.request_type ?? "repair";

        const isVisible =
          requestType === "repair" ||
          (requestType === "direct_request" &&
            req.target_workshop_id === userId);

        return (
          req.service_type === "towing" &&
          req.status === "open" &&
          !req.accepted_offer_id &&
          isVisible &&
          !offeredRequestIds.includes(req.id)
        );
      });

      const towingRequestsCount = visibleTowingRows.length;

      const directBodyworkUnreadResult = await supabase
        .from("repair_requests")
        .select("id", { count: "exact", head: true })
        .eq("status", "open")
        .eq("service_type", "bodywork")
        .eq("request_type", "direct_request")
        .eq("target_workshop_id", userId)
        .is("target_workshop_read_at", null);

      const directMechanicalUnreadResult = await supabase
        .from("repair_requests")
        .select("id", { count: "exact", head: true })
        .eq("status", "open")
        .eq("service_type", "mechanical")
        .eq("target_workshop_id", userId)
        .is("target_workshop_read_at", null)
        .eq("request_type", "direct_request");

      const [myOffersResult, wonJobsResult] = await Promise.all([
        supabase
          .from("repair_offers")
          .select("id", { count: "exact", head: true })
          .eq("workshop_user_id", userId)
          .eq("status", "pending"),

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
        wonJobsResult.data?.filter((row) => {
          const request = Array.isArray(row.repair_requests)
            ? row.repair_requests[0]
            : row.repair_requests;

          return (request?.status || "matched") !== "completed";
        }).length || 0;

      setStats({
        bodyworkRequests: bodyworkRequestsCount,
        mechanicalRequests: mechanicalRequestsCount,
        wheelsRequests: wheelsRequestsCount,
        towingRequests: towingRequestsCount,
        myOffers: myOffersResult.count || 0,
        wonJobs: wonCount,
        directBodyworkUnread: directBodyworkUnreadResult.count || 0,
        directMechanicalUnread: directMechanicalUnreadResult.count || 0,
      });
    } catch {
      setStats({
        bodyworkRequests: 0,
        mechanicalRequests: 0,
        wheelsRequests: 0,
        towingRequests: 0,
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
      {showSuccessToast && (
        <div className="mx-auto mb-4 max-w-md rounded-2xl border border-green-500/30 bg-green-500/10 p-4">
          <p className="text-sm font-bold text-green-300">
            ✅ Oferta a fost trimisă cu succes.
          </p>

          <p className="mt-1 text-xs font-normal text-green-100/80">
            Clientul a fost notificat și îți va putea răspunde în scurt timp.
          </p>
        </div>
      )}
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
            href="/workshops/wheels"
            icon="🛞"
            title="Roți și anvelope"
            description="Cererile clienților"
            value={stats.wheelsRequests}
          />

          <DashboardCard
            href="/workshops/towing"
            icon="🚚"
            title="Tractări auto"
            description="Cererile clienților"
            value={stats.towingRequests}
          />

          <DashboardCard
            href="/workshops/my-offers"
            icon="€"
            title="Ofertele tale"
            description="Oferte trimise"
            value={stats.myOffers}
          />

          <DashboardCard
            href="/workshops/won-jobs?tab=appointments"
            icon="📅"
            title="Programări"
            description="Lucrări acceptate"
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
  href?: string;
  icon: string;
  title: string;
  description: string;
  value: string | number;
  badge?: number;
}) {
  const card = (
    <div
      className={`relative w-full rounded-[20px] bg-white p-4 text-center text-black shadow-lg transition duration-200 md:p-6 ${
        href
          ? "active:scale-[0.98] hover:scale-[1.02] md:hover:shadow-2xl"
          : "cursor-default"
      }`}
    >
        <div className="absolute right-4 top-4 rounded-full bg-black px-2.5 py-1 text-xs font-semibold text-white shadow-md">
          {value}
        </div>

        {typeof badge === "number" && badge > 0 && (
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
  );

  if (!href) {
    return (
      <div className="w-full" aria-disabled="true">
        {card}
      </div>
    );
  }

  return (
    <Link href={href} className="w-full">
      {card}
    </Link>
  );
}
