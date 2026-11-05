"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import type { RepairRequestRow } from "@/lib/supabase/repair-requests";
import { getCustomerRequestsByActivity } from "@/lib/supabase/customer-request-activity";
import { createCustomerActivityLive, CUSTOMER_ACTIVITY_TOPIC, isCustomerActivityInvalidation } from "@/lib/customer/request-activity-live";
import { useSafeNavigation } from "@/lib/hooks/useSafeNavigation";
import RepairRequestCard from "@/app/components/RepairRequestCard";
import RequestCategoryFilter, {
  type RequestCategoryCounts,
  type RequestCategoryFilter as RequestCategory,
} from "@/app/components/RequestCategoryFilter";
import { resolveRepairServiceType } from "@/lib/repair-requests/service-types";
import { deleteEditableRepairRequest } from "@/lib/supabase/edit-repair-request";

type MyRequestsTab = "waiting" | "with_offer" | "archive";

const INITIAL_CATEGORY_BY_TAB: Record<MyRequestsTab, RequestCategory> = {
  waiting: "all",
  with_offer: "all",
  archive: "all",
};

const MY_REQUESTS_PAGE_TITLES: Record<RequestCategory, string> = {
  all: "CERERILE MELE",
  bodywork: "DAUNE ESTETICE",
  mechanical: "DAUNE MECANICE",
  wheels: "ROȚI ȘI ANVELOPE",
  towing: "TRACTĂRI AUTO",
};

export default function MyRequestsPage() {
  /*
   * Acest router rămâne numai pentru redirectul automat
   * de autentificare.
   */
  const router = useRouter();

  /*
   * Navigările pornite prin apăsarea utilizatorului trec
   * prin hook-ul comun.
   */
  const { navigate, isNavigating } = useSafeNavigation({
    timeoutMs: 2500,
  });

  const [requests, setRequests] = useState<RepairRequestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const activeOwnerRef = useRef<string | null>(null);
  const [activeTab, setActiveTab] = useState<MyRequestsTab>("waiting");
  const [activeCategoryByTab, setActiveCategoryByTab] = useState<
    Record<MyRequestsTab, RequestCategory>
  >(INITIAL_CATEGORY_BY_TAB);

  const closingRequestIdsRef = useRef(new Set<string>());

  /*
   * Restaurăm tabul ales anterior de utilizator.
   */
  useEffect(() => {
    const savedTab = sessionStorage.getItem("my-requests-active-tab");

    if (
      savedTab === "waiting" ||
      savedTab === "with_offer" ||
      savedTab === "archive"
    ) {
      setActiveTab(savedTab);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    let authRevision = 0;
    const live = createCustomerActivityLive<RepairRequestRow>({
      read: getCustomerRequestsByActivity,
      publish: (rows, busy, failed) => {
        if (cancelled) return;
        setRequests(rows); setLoading(busy); setLoadError(failed);
      },
      connect: (userId, events) => {
        if (process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "") !== "https://bstjobvvxxfqqwyjoimx.supabase.co" ||
          process.env.NEXT_PUBLIC_AUTOREPAIR_SUPABASE_PROJECT_REF !== "bstjobvvxxfqqwyjoimx") throw new Error("CUSTOMER_ACTIVITY_TEST_ONLY");
        const channels: ReturnType<typeof supabase.channel>[] = [];
        let disposed = false;
        const cleanup = () => { disposed = true; for (const channel of channels) void supabase.removeChannel(channel).catch(() => {}); };
        void (async () => {
          // Supabase reuses channels by topic. Finish leaving an old private
          // channel before subscribing again (CLOSED, token change, Strict Mode).
          const previous = supabase.getChannels().filter(channel => channel.topic === `realtime:${CUSTOMER_ACTIVITY_TOPIC}${userId}`);
          await Promise.all(previous.map(channel => supabase.removeChannel(channel)));
          if (disposed) return;
          const changes = supabase.channel(`customer-my-requests-${userId}-${crypto.randomUUID()}`);
          channels.push(changes);
          changes.on("postgres_changes", {
            event: "INSERT", schema: "public", table: "notifications", filter: `recipient_id=eq.${userId}`,
          }, payload => {
            const role = payload.new.recipient_role;
            if (!role || role === "customer") events.invalidate();
          }).on("postgres_changes", {
            event: "*", schema: "public", table: "repair_offers",
          }, events.invalidate).on("postgres_changes", {
            event: "*", schema: "public", table: "repair_requests", filter: `user_id=eq.${userId}`,
          }, events.invalidate).subscribe(events.status);
          const activity = supabase.channel(`${CUSTOMER_ACTIVITY_TOPIC}${userId}`, { config: { private: true } });
          channels.push(activity);
          activity.on("broadcast", { event: "invalidate" }, message => {
            if (isCustomerActivityInvalidation(message.payload)) events.invalidate();
          }).subscribe(events.status);
        })().catch(() => { if (!disposed) { cleanup(); events.status("CLOSED"); } });
        return cleanup;
      },
    });
    const setSession = (session: { user: { id: string }; access_token: string } | null) => {
      if (cancelled) return;
      activeOwnerRef.current = session?.user.id ?? null;
      live.session(session ? `${session.user.id}:${session.access_token}` : null, session?.user.id ?? null);
      if (!session) router.replace("/login");
    };
    // The callback does not await Auth APIs; async reads start in a microtask.
    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      authRevision++; setSession(session);
    });
    const revision = authRevision;
    void supabase.auth.getSession().then(({ data, error }) => {
      if (cancelled || authRevision !== revision) return;
      if (error) { live.session(null, null); setLoadError(true); return; }
      setSession(data.session);
    }).catch(() => { if (!cancelled && authRevision === revision) { live.session(null, null); setLoadError(true); } });
    const foreground = () => { if (document.visibilityState === "visible") live.foreground(); };
    document.addEventListener("visibilitychange", foreground);
    window.addEventListener("focus", foreground);
    window.addEventListener("pageshow", foreground);
    return () => {
      cancelled = true; activeOwnerRef.current = null;
      subscription.subscription.unsubscribe(); live.dispose();
      document.removeEventListener("visibilitychange", foreground);
      window.removeEventListener("focus", foreground);
      window.removeEventListener("pageshow", foreground);
    };
  }, [router]);

  // Filtering preserves the authoritative RPC order within every tab/category.
  const waitingRequests = requests.filter((request) => {
    const offersCount = request.offers_count ?? 0;

    return (
      request.status === "open" &&
      !request.accepted_offer_id &&
      offersCount === 0
    );
  });

  const withOfferRequests = requests.filter((request) => {
    const offersCount = request.offers_count ?? 0;

    return (
      request.status === "open" && !request.accepted_offer_id && offersCount > 0
    );
  });

  const archiveRequests = requests.filter((request) => {
    return request.status !== "open" || Boolean(request.accepted_offer_id);
  });

  const visibleRequests =
    activeTab === "waiting"
      ? waitingRequests
      : activeTab === "with_offer"
        ? withOfferRequests
        : archiveRequests;

  const getCategoryCounts = (
    tabRequests: RepairRequestRow[],
  ): RequestCategoryCounts => {
    const counts: RequestCategoryCounts = {
      all: tabRequests.length,
      bodywork: 0,
      mechanical: 0,
      wheels: 0,
      towing: 0,
    };

    tabRequests.forEach((request) => {
      const serviceType = resolveRepairServiceType(request.service_type);

      if (serviceType) {
        counts[serviceType] += 1;
      }
    });

    return counts;
  };

  const categoryCountsByTab: Record<MyRequestsTab, RequestCategoryCounts> = {
    waiting: getCategoryCounts(waitingRequests),
    with_offer: getCategoryCounts(withOfferRequests),
    archive: getCategoryCounts(archiveRequests),
  };
  const activeCategory = activeCategoryByTab[activeTab];
  const filteredVisibleRequests =
    activeCategory === "all"
      ? visibleRequests
      : visibleRequests.filter(
          (request) =>
            resolveRepairServiceType(request.service_type) === activeCategory,
        );

  const changeTab = (tab: MyRequestsTab) => {
    setActiveTab(tab);
    sessionStorage.setItem("my-requests-active-tab", tab);
  };

  const goToPostChoice = () => {
    navigate("/post-choice");
  };

  const goToRequest = (requestId: string) => {
    navigate(`/customer/my-requests/${requestId}`);
  };

  const handleViewRequest = (requestId: string) => {
    if (activeTab === "with_offer") {
      navigate("/offers");
      return;
    }

    navigate(`/customer/my-requests/${requestId}`);
  };

  const handleCloseRequest = async (request: RepairRequestRow) => {
    if (activeOwnerRef.current !== request.user_id || closingRequestIdsRef.current.has(request.id)) return;

    const confirmed = confirm(
      "Această cerere are deja oferte. Vrei să o închizi? Service-urile nu o vor mai vedea.",
    );

    if (!confirmed) return;

    closingRequestIdsRef.current.add(request.id);

    try {
      await deleteEditableRepairRequest({
        requestId: request.id,
        userId: request.user_id,
        hasOffers: true,
      });

      if (activeOwnerRef.current !== request.user_id) return;
      setRequests((currentRequests) =>
        currentRequests.filter(
          (currentRequest) => currentRequest.id !== request.id,
        ),
      );
    } catch (error) {
      console.error("Failed to close repair request:", error);
      window.alert("Nu am putut închide cererea.");
    } finally {
      closingRequestIdsRef.current.delete(request.id);
    }
  };

  return (
    <main className="min-h-[calc(100svh-236px)] bg-[#111111] px-4 pb-[calc(24px+env(safe-area-inset-bottom))] pt-4 text-white">
      <div className="mx-auto max-w-5xl">
        <section className="mb-5 text-center">
          <p className="text-[11px] uppercase tracking-[0.26em] text-white/70">
            {MY_REQUESTS_PAGE_TITLES[activeCategory]}
          </p>
        </section>

        <div className="mb-5 flex gap-2 overflow-x-auto">
          <button
            type="button"
            onClick={() => changeTab("waiting")}
            disabled={isNavigating}
            className={`rounded-full px-4 py-2 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-60 ${
              activeTab === "waiting"
                ? "bg-orange-500 text-black"
                : "bg-white/10 text-white"
            }`}
          >
            În așteptare ({waitingRequests.length})
          </button>

          <button
            type="button"
            onClick={() => changeTab("with_offer")}
            disabled={isNavigating}
            className={`rounded-full px-4 py-2 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-60 ${
              activeTab === "with_offer"
                ? "bg-orange-500 text-black"
                : "bg-white/10 text-white"
            }`}
          >
            Cu ofertă ({withOfferRequests.length})
          </button>

          <button
            type="button"
            onClick={() => changeTab("archive")}
            disabled={isNavigating}
            className={`rounded-full px-4 py-2 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-60 ${
              activeTab === "archive"
                ? "bg-orange-500 text-black"
                : "bg-white/10 text-white"
            }`}
          >
            Istoric ({archiveRequests.length})
          </button>
        </div>

        <div className="mb-5">
          <RequestCategoryFilter
            activeCategory={activeCategory}
            counts={categoryCountsByTab[activeTab]}
            onChange={(category) => {
              setActiveCategoryByTab((current) => ({
                ...current,
                [activeTab]: category,
              }));
            }}
          />
        </div>

        {loadError && <p role="alert" className="mb-4 text-amber-300">Nu am putut actualiza cererile. Lista poate fi neactualizată.</p>}
        {loading ? (
          <p className="text-white/60">Se încarcă cererile...</p>
        ) : loadError && requests.length === 0 ? (
          <p className="text-white/60">Lista nu este disponibilă momentan.</p>
        ) : filteredVisibleRequests.length === 0 ? (
          <div className="rounded-[22px] bg-white p-6 text-center text-black">
            <h2 className="text-xl font-bold">
              {activeTab === "waiting"
                ? "Nu ai cereri în așteptare"
                : activeTab === "with_offer"
                  ? "Nu ai cereri cu ofertă"
                  : "Nu ai cereri în istoric"}
            </h2>

            <p className="mt-2 text-sm text-black/60">
              {activeTab === "archive"
                ? "Cererile programate, în lucru sau finalizate vor apărea aici."
                : "Postează o daună ca să primești oferte de la service-uri."}
            </p>

            <button
              type="button"
              onClick={goToPostChoice}
              disabled={isNavigating}
              className="mt-5 rounded-full bg-black px-5 py-3 text-sm font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-50"
            >
              Postează daună
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredVisibleRequests.map((request) => (
              <RepairRequestCard
                key={request.id}
                request={request}
                actionLabel={
                  activeTab === "with_offer" ? "Șterge cererea" : undefined
                }
                onAction={
                  activeTab === "with_offer"
                    ? () => void handleCloseRequest(request)
                    : undefined
                }
                onEdit={() => goToRequest(request.id)}
                onView={() => handleViewRequest(request.id)}
              />
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
