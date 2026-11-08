"use client";

import { getOwnProfile } from "@/lib/supabase/profiles";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import { fetchWorkshopDiscoveryCounts, type WorkshopDiscoveryCounts } from "@/lib/supabase/workshop-discovery";
import { fetchWorkshopActiveJobsCount } from "@/lib/supabase/workshop-active-jobs";
import { createWorkshopDiscoveryRefresh, isWorkshopDiscoveryInvalidation, WORKSHOP_DISCOVERY_TOPIC } from "@/lib/supabase/workshop-discovery-live";

type DashboardStats = {
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
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [statsError, setStatsError] = useState(false);
  const statsLoadVersion = useRef(0);
  const [discoveryCounts, setDiscoveryCounts] = useState<WorkshopDiscoveryCounts | null>(null);
  const [discoveryError, setDiscoveryError] = useState(false);
  const [discoveryLiveError, setDiscoveryLiveError] = useState(false);
  const discoveryRemoval = useRef<Promise<boolean>>(Promise.resolve(true));

  const loadStats = useCallback(async (userId: string) => {
    const version = ++statsLoadVersion.current;
    const isStale = () => version !== statsLoadVersion.current;
    try {
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

      const [myOffersResult, wonCount] = await Promise.all([
        supabase
          .from("repair_offers")
          .select("id", { count: "exact", head: true })
          .eq("workshop_user_id", userId)
          .eq("status", "pending"),
        fetchWorkshopActiveJobsCount(userId),
      ]);
      for (const result of [directBodyworkUnreadResult, directMechanicalUnreadResult, myOffersResult]) {
        if (result.error) throw result.error;
        if (result.count === null || !Number.isSafeInteger(result.count) || result.count < 0) {
          throw new Error("WORKSHOP_DASHBOARD_COUNTS_UNAVAILABLE");
        }
      }
      if (isStale()) return;
      setStats({
        myOffers: myOffersResult.count!,
        wonJobs: wonCount,
        directBodyworkUnread: directBodyworkUnreadResult.count!,
        directMechanicalUnread: directMechanicalUnreadResult.count!,
      });
      setStatsError(false);
    } catch {
      if (isStale()) return;
      setStats(null);
      setStatsError(true);
    }
  }, []);

  useEffect(() => {
    let active = true;
    localStorage.setItem("activeRole", "workshop");
    const checkUserAndLoad = async () => {
      try {
        const { data: authData } = await supabase.auth.getUser();

        if (!active) return;
        if (!authData.user) {
          router.push("/login");
          return;
        }

        const { data: profile } = await getOwnProfile(supabase);
        if (!active) return;

        const roles = Array.isArray(profile?.role) ? profile.role : [];

        if (!roles.includes("workshop")) {
          router.push("/");
          return;
        }

        setCurrentWorkshopUserId(authData.user.id);
        setAuthorized(true);
        await loadStats(authData.user.id);
      } catch {
        if (active) router.push("/login");
      } finally {
        if (active) setCheckingAccess(false);
      }
    };

    checkUserAndLoad();
    return () => {
      active = false;
      statsLoadVersion.current += 1;
    };
  }, [router, loadStats]);

  useEffect(() => {
    if (!authorized || !currentWorkshopUserId) return;

    let active = true;

    const discovery = createWorkshopDiscoveryRefresh({
      read: fetchWorkshopDiscoveryCounts,
      publish: (counts, error) => { setDiscoveryCounts(counts); setDiscoveryError(error); },
    });
    discovery.invalidate();
    let discoveryChannel: ReturnType<typeof supabase.channel> | null = null;
    let connection = 0;
    let reconnecting = false;
    const connectDiscovery = () => {
      const generation = ++connection;
      discoveryChannel = supabase.channel(WORKSHOP_DISCOVERY_TOPIC, { config: { private: true } })
        .on("broadcast", { event: "invalidate" }, ({ payload }) => {
          if (active && generation === connection && isWorkshopDiscoveryInvalidation(payload)) discovery.invalidate();
        })
        .subscribe(status => {
          if (!active || generation !== connection) return;
          if (status === "SUBSCRIBED") { setDiscoveryLiveError(false); discovery.invalidate(); }
          else if (["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].includes(status)) setDiscoveryLiveError(true);
        });
    };
    // Supabase reuses a channel with the same topic until removal completes.
    // Wait for the previous effect/account's channel, including Strict Mode cleanup.
    void discoveryRemoval.current.then(removed => {
      if (!active) return;
      if (removed) connectDiscovery(); else setDiscoveryLiveError(true);
    });

    const refreshStats = async () => {
      if (!active) return;
      discovery.invalidate();
      await loadStats(currentWorkshopUserId);
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
          event: "*",
          schema: "public",
          table: "repair_offers",
          filter: `workshop_user_id=eq.${currentWorkshopUserId}`,
        },
        refreshStats,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "repair_appointments", filter: `workshop_id=eq.${currentWorkshopUserId}` },
        refreshStats,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "work_progress_updates", filter: `sender_id=eq.${currentWorkshopUserId}` },
        refreshStats,
      )
      .subscribe(status => {
        if (status === "SUBSCRIBED") void refreshStats();
      });

    const onForeground = () => {
      if (!active || document.visibilityState !== "visible") return;
      if (discoveryChannel && !reconnecting &&
        (discoveryChannel.state === "closed" || discoveryChannel.state === "errored")) {
        reconnecting = true;
        const generation = ++connection;
        discoveryRemoval.current = supabase.removeChannel(discoveryChannel).then(status => status === "ok", () => false);
        void discoveryRemoval.current.then(removed => {
          reconnecting = false;
          if (!active || generation !== connection) return;
          if (removed) connectDiscovery(); else setDiscoveryLiveError(true);
        });
      }
      void refreshStats();
    };
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user.id === currentWorkshopUserId) { discovery.invalidate(); return; }
      active = false;
      discovery.dispose();
      setDiscoveryCounts(null);
      statsLoadVersion.current += 1;
      setStats(null);
      setAuthorized(false);
      router.replace("/login");
    });

    window.addEventListener("direct-requests-read-updated", refreshStats);
    window.addEventListener("focus", onForeground);
    document.addEventListener("visibilitychange", onForeground);

    return () => {
      active = false;
      discovery.dispose();
      connection += 1;
      statsLoadVersion.current += 1;
      window.removeEventListener("direct-requests-read-updated", refreshStats);
      window.removeEventListener("focus", onForeground);
      document.removeEventListener("visibilitychange", onForeground);
      subscription.unsubscribe();
      supabase.removeChannel(channel);
      if (discoveryChannel && !reconnecting) {
        discoveryRemoval.current = supabase.removeChannel(discoveryChannel).then(status => status === "ok", () => false);
      }
    };
  }, [authorized, currentWorkshopUserId, loadStats, router]);

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

        {(statsError || discoveryError) && (
          <p role="alert" className="mt-4 text-center text-sm text-orange-300">
            Contoarele nu au putut fi actualizate. Reîncearcă la revenirea în pagină.
          </p>
        )}
        {discoveryLiveError && (
          <p role="status" className="mt-4 text-center text-sm text-orange-300">
            Actualizarea în timp real a cererilor este temporar indisponibilă.
          </p>
        )}

        <section className="mt-10 grid grid-cols-2 gap-3 md:mx-auto md:max-w-3xl md:gap-6">
          <DashboardCard
            href="/workshops"
            icon="🚗"
            title="Daune estetice"
            description="Cererile clienților"
            value={discoveryCounts?.bodywork}
            badge={stats?.directBodyworkUnread}
          />

          <DashboardCard
            href="/workshops/mechanical"
            icon="⚙️"
            title="Daune mecanice"
            description="Cererile clienților"
            value={discoveryCounts?.mechanical}
            badge={stats?.directMechanicalUnread}
          />

          <DashboardCard
            href="/workshops/wheels"
            icon="🛞"
            title="Roți și anvelope"
            description="Cererile clienților"
            value={discoveryCounts?.wheels}
          />

          <DashboardCard
            href="/workshops/towing"
            icon="🚚"
            title="Tractări auto"
            description="Cererile clienților"
            value={discoveryCounts?.towing}
          />

          <DashboardCard
            href="/workshops/my-offers"
            icon="€"
            title="Ofertele tale"
            description="Oferte trimise"
            value={stats?.myOffers}
          />

          <DashboardCard
            href="/workshops/won-jobs?tab=appointments"
            icon="📅"
            title="Programări"
            description="Lucrări acceptate"
            value={stats?.wonJobs}
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
  value?: number;
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
        {typeof value === "number" && value > 0 && (
          <div className="absolute right-4 top-4 rounded-full bg-black px-2.5 py-1 text-xs font-semibold text-white shadow-md">
            {value}
          </div>
        )}

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
