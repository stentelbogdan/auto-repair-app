"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import CarHeader from "@/app/components/CarHeader";
import RepairRequestMetrics from "@/app/components/RepairRequestMetrics";
import RequestClientName from "@/app/components/RequestClientName";
import { AsyncTimeoutError, withTimeout } from "@/lib/async/with-timeout";
import { checkWorkshopAccess } from "@/lib/auth/workshop-access";
import { getRequestTypeBadgeLabel } from "@/lib/displayLabels";
import { formatPostedTime } from "@/lib/formatters";
import { supabase } from "@/lib/supabase/client";
import {
  getWorkshopRepairRequests,
  type RepairRequestRow,
} from "@/lib/supabase/repair-requests";
import { getWorkshopRequestClientNames } from "@/lib/supabase/workshop-client-names";
import { getWorkshopRequestMetrics } from "@/lib/supabase/repair-request-metrics";
import { recordWorkshopRequestView } from "@/lib/supabase/repair-request-views";
import { getWheelsDisplaySummary } from "@/lib/wheels/wheels-display";

type WorkshopRequest = {
  id: string;
  carBrand: string;
  carModel: string;
  carYear: string;
  city: string;
  licensePlate: string | null;
  serviceDetails: RepairRequestRow["service_details"];
  description: string;
  images: {
    name: string;
    url?: string;
    dataUrl?: string;
  }[];
  status: string;
  postedAt: string;
  viewCount: number;
  offerCount: number;
  clientName: string | null;
};

const ENRICHMENT_TIMEOUT_MS = 8_000;

export default function WorkshopWheelsPage() {
  const router = useRouter();
  const [requests, setRequests] = useState<WorkshopRequest[]>([]);
  const [authorized, setAuthorized] = useState(false);
  const [currentWorkshopUserId, setCurrentWorkshopUserId] = useState<
    string | null
  >(null);
  const [checkingAccess, setCheckingAccess] = useState(true);
  const [accessError, setAccessError] = useState(false);
  const [accessCheckVersion, setAccessCheckVersion] = useState(0);
  const [loadingRequests, setLoadingRequests] = useState(false);
  const [dataError, setDataError] = useState(false);
  const accessAttemptRef = useRef(0);
  const loadAttemptRef = useRef(0);
  const hasLoadedRequestsRef = useRef(false);
  const workshopUserIdRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const attemptId = ++accessAttemptRef.current;
    const isCurrentAttempt = () =>
      !cancelled && attemptId === accessAttemptRef.current;

    const markDirectRequestsRead = async (workshopUserId: string) => {
      const { error } = await supabase
        .from("repair_requests")
        .update({ target_workshop_read_at: new Date().toISOString() })
        .eq("target_workshop_id", workshopUserId)
        .eq("service_type", "wheels")
        .eq("request_type", "direct_request")
        .is("target_workshop_read_at", null);

      if (error) {
        if (process.env.NODE_ENV === "development") {
          console.error("Failed to mark direct requests as read:", error);
        }
        return;
      }

      if (isCurrentAttempt()) {
        window.dispatchEvent(new Event("direct-requests-read-updated"));
      }
    };

    const checkUserAndLoad = async () => {
      const result = await checkWorkshopAccess();

      if (!isCurrentAttempt()) return;

      if (result.status === "authorized") {
        workshopUserIdRef.current = result.userId;
        setCurrentWorkshopUserId(result.userId);
        setLoadingRequests(true);
        setAuthorized(true);
        setAccessError(false);
        setCheckingAccess(false);
        void loadRequests();
        void markDirectRequestsRead(result.userId);
        return;
      }

      workshopUserIdRef.current = null;
      setCurrentWorkshopUserId(null);
      setAuthorized(false);
      setCheckingAccess(false);

      if (result.status === "unauthenticated") {
        router.push("/login");
        return;
      }

      if (result.status === "forbidden") {
        router.push("/");
        return;
      }

      setAccessError(true);
    };

    void checkUserAndLoad();

    return () => {
      cancelled = true;
      if (attemptId === accessAttemptRef.current) {
        accessAttemptRef.current += 1;
      }
    };
  }, [accessCheckVersion, router]);

  useEffect(
    () => () => {
      loadAttemptRef.current += 1;
    },
    [],
  );

  const loadRequests = async (
    { silent = false }: { silent?: boolean } = {},
  ) => {
    const attemptId = ++loadAttemptRef.current;
    const isCurrentAttempt = () => attemptId === loadAttemptRef.current;

    if (!silent) {
      setLoadingRequests(true);
      setDataError(false);
    }

    let wheelsRows: RepairRequestRow[];

    try {
      const rows = await getWorkshopRepairRequests();
      const workshopUserId = workshopUserIdRef.current;

      if (!workshopUserId) {
        throw new Error("Workshop user is unavailable for request loading.");
      }

      const { data: existingOffers, error: existingOffersError } =
        await supabase
          .from("repair_offers")
          .select("request_id")
          .eq("workshop_user_id", workshopUserId);

      if (existingOffersError) throw existingOffersError;

      const offeredRequestIds = new Set(
        (existingOffers ?? [])
          .map((offer) => offer.request_id)
          .filter(Boolean),
      );

      wheelsRows = rows.filter((request) => {
        const requestType = request.request_type ?? "repair";
        const isVisibleToWorkshop =
          requestType === "repair" ||
          (requestType === "direct_request" &&
            request.target_workshop_id === workshopUserId);

        return (
          request.service_type === "wheels" &&
          request.status === "open" &&
          !request.accepted_offer_id &&
          isVisibleToWorkshop &&
          !offeredRequestIds.has(request.id)
        );
      });

      const mapped: WorkshopRequest[] = wheelsRows.map((request) => ({
        id: request.id,
        carBrand: request.car_brand || "Marcă necunoscută",
        carModel: request.car_model || "Model necunoscut",
        carYear: request.car_year || "-",
        city: request.city || "-",
        licensePlate: request.license_plate,
        serviceDetails: request.service_details,
        description: request.description || "Fără descriere.",
        images: Array.isArray(request.images) ? request.images : [],
        status: request.status || "open",
        postedAt: formatPostedAt(request.created_at),
        viewCount: 0,
        offerCount: 0,
        clientName: null,
      }));

      if (!isCurrentAttempt()) return;

      setRequests((current) => {
        if (!silent) return mapped;

        const currentById = new Map(
          current.map((request) => [request.id, request]),
        );

        return mapped.map((request) => {
          const existing = currentById.get(request.id);

          return existing
            ? {
                ...request,
                viewCount: existing.viewCount,
                offerCount: existing.offerCount,
                clientName: existing.clientName,
              }
            : request;
        });
      });
      setDataError(false);
      hasLoadedRequestsRef.current = true;
      setLoadingRequests(false);
    } catch (error) {
      if (!isCurrentAttempt()) return;

      if (process.env.NODE_ENV === "development") {
        console.error("[DATA] critical:error", error);
      }

      if (!silent || !hasLoadedRequestsRef.current) {
        hasLoadedRequestsRef.current = false;
        setRequests([]);
        setDataError(true);
      }

      setLoadingRequests(false);
      return;
    }

    const requestIds = wheelsRows.map((request) => request.id);
    const [metricsResult, clientNamesResult] = await Promise.allSettled([
      withTimeout(
        getWorkshopRequestMetrics(requestIds),
        ENRICHMENT_TIMEOUT_MS,
        "Workshop request metrics",
      ),
      withTimeout(
        getWorkshopRequestClientNames(requestIds),
        ENRICHMENT_TIMEOUT_MS,
        "Workshop request client names",
      ),
    ]);

    if (!isCurrentAttempt()) return;

    if (metricsResult.status === "rejected") {
      logEnrichmentFailure("metrics", metricsResult.reason);
    }
    if (clientNamesResult.status === "rejected") {
      logEnrichmentFailure("clientNames", clientNamesResult.reason);
    }

    const requestIdSet = new Set(requestIds);

    setRequests((current) =>
      current.map((request) => {
        if (!requestIdSet.has(request.id)) return request;

        const metrics =
          metricsResult.status === "fulfilled"
            ? metricsResult.value.get(request.id)
            : null;
        const clientName =
          clientNamesResult.status === "fulfilled"
            ? (clientNamesResult.value.get(request.id) ?? null)
            : request.clientName;

        return {
          ...request,
          viewCount: metrics
            ? Math.max(request.viewCount, metrics.viewCount)
            : request.viewCount,
          offerCount: metrics
            ? Math.max(request.offerCount, metrics.offerCount)
            : request.offerCount,
          clientName,
        };
      }),
    );
  };

  const refreshRequestsFromRealtime = useEffectEvent(() => {
    void loadRequests({ silent: true });
  });

  const recordEngagedView = (requestId: string) => {
    void recordWorkshopRequestView(requestId).then((created) => {
      if (!created) return;

      setRequests((current) =>
        current.map((request) =>
          request.id === requestId
            ? { ...request, viewCount: request.viewCount + 1 }
            : request,
        ),
      );
    });
  };

  useEffect(() => {
    if (!authorized || !currentWorkshopUserId) return;

    let hasSubscribed = false;
    const channel = supabase
      .channel("workshop-wheels-repair-request-updates")
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "repair_requests",
        },
        () => refreshRequestsFromRealtime(),
      )
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "repair_offers",
          filter: `workshop_user_id=eq.${currentWorkshopUserId}`,
        },
        () => refreshRequestsFromRealtime(),
      )
      .subscribe((status, error) => {
        if (process.env.NODE_ENV === "development" && error) {
          console.error("Wheels requests Realtime error:", status, error);
        }

        if (status === "SUBSCRIBED") {
          if (hasSubscribed) refreshRequestsFromRealtime();
          hasSubscribed = true;
        }
      });

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [authorized, currentWorkshopUserId]);

  if (checkingAccess) {
    return (
      <main className="min-h-screen bg-black px-6 py-10 text-white">
        <div className="mx-auto flex min-h-[60vh] max-w-7xl items-center justify-center">
          <p className="text-white/70">Checking access...</p>
        </div>
      </main>
    );
  }

  if (accessError) {
    return (
      <main className="min-h-screen bg-black px-6 py-10 text-white">
        <div className="mx-auto flex min-h-[60vh] max-w-7xl items-center justify-center">
          <div className="max-w-md rounded-2xl border border-white/10 bg-white/5 p-8 text-center">
            <h1 className="text-2xl font-semibold">
              Nu am putut verifica accesul
            </h1>
            <p className="mt-3 text-white/70">
              Serviciul de autentificare răspunde greu. Verifică conexiunea și
              încearcă din nou.
            </p>
            <button
              type="button"
              onClick={() => {
                setAccessError(false);
                setCheckingAccess(true);
                setAccessCheckVersion((current) => current + 1);
              }}
              className="mt-6 rounded-xl bg-white px-5 py-3 font-semibold text-black"
            >
              Încearcă din nou
            </button>
          </div>
        </div>
      </main>
    );
  }

  if (!authorized) return null;

  return (
    <main className="min-h-screen bg-black px-6 py-10 text-white">
      <div className="mx-auto max-w-7xl">
        <div className="mb-8 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-sm uppercase tracking-[0.2em] text-white/40">
              Service auto
            </p>
            <h1 className="mt-2 text-3xl font-bold md:text-4xl">
              Roți și anvelope disponibile
            </h1>
            <p className="mt-3 max-w-2xl text-white/70">
              Verifică serviciile solicitate și trimite oferta ta clientului.
            </p>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white/70">
            {requests.length} lucrări
          </div>
        </div>

        {loadingRequests ? (
          <div className="rounded-2xl border border-white/10 bg-white/5 p-10 text-center">
            <p className="text-white/70">Se încarcă lucrările...</p>
          </div>
        ) : dataError ? (
          <div className="rounded-2xl border border-white/10 bg-white/5 p-10 text-center">
            <h2 className="text-2xl font-semibold">
              Nu am putut încărca lucrările
            </h2>
            <p className="mt-3 text-white/70">
              Verifică conexiunea și încearcă din nou.
            </p>
            <button
              type="button"
              onClick={() => void loadRequests()}
              className="mt-6 rounded-lg bg-white px-6 py-3 font-semibold text-black"
            >
              Încearcă din nou
            </button>
          </div>
        ) : requests.length === 0 ? (
          <div className="rounded-2xl border border-white/10 bg-white/5 p-10 text-center">
            <h2 className="text-2xl font-semibold">
              Nu există lucrări disponibile
            </h2>
            <p className="mt-3 text-white/70">
              Când un client postează o cerere pentru roți, aceasta va apărea
              aici.
            </p>
            <button
              type="button"
              onClick={() => router.push("/workshops/dashboard")}
              className="mt-6 rounded-lg bg-white px-6 py-3 font-semibold text-black"
            >
              Înapoi la panou
            </button>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {requests.map((request) => {
              const wheelsSummary = getWheelsDisplaySummary(
                request.serviceDetails,
              );

              return (
                <div
                  key={request.id}
                  className="w-full overflow-hidden rounded-[30px] bg-white p-4 text-black shadow-xl"
                >
                  <CarHeader
                    images={request.images}
                    plate={request.licensePlate}
                    platePosition="bottom"
                    brand={request.carBrand}
                    model={request.carModel}
                    year={request.carYear}
                    city={request.city}
                    variant="listLarge"
                    wheelsSummary={wheelsSummary}
                    onActiveInteraction={() => recordEngagedView(request.id)}
                    details={[
                      { text: "Deschisă", color: "yellow" },
                      {
                        text: getRequestTypeBadgeLabel("wheels"),
                        color: "orange",
                      },
                      {
                        text: formatPostedTime(request.postedAt),
                        color: "gray",
                      },
                    ]}
                  />

                  <RequestClientName name={request.clientName} />
                  <RepairRequestMetrics
                    viewCount={request.viewCount}
                    offerCount={request.offerCount}
                  />

                  <div className="mt-4 rounded-2xl border border-black/10 bg-black/[0.03] p-3">
                    <p className="mb-2 text-xs font-semibold text-black/45">
                      📝 Descriere
                    </p>
                    <p className="text-sm leading-6 text-black/70">
                      {request.description || "Nu există descriere."}
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      recordEngagedView(request.id);
                      router.push(`/workshops/${request.id}`);
                    }}
                    className="mt-4 w-full rounded-2xl bg-orange-500 px-4 py-3 text-sm font-bold text-white transition hover:bg-orange-600"
                  >
                    Vezi detalii și trimite ofertă
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}

function formatPostedAt(value: string) {
  const createdAt = new Date(value);
  const now = new Date();
  const diffMinutes = Math.floor(
    (now.getTime() - createdAt.getTime()) / 1000 / 60,
  );
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (Number.isNaN(createdAt.getTime())) return "Recent";
  if (diffMinutes < 1) return "Acum";
  if (diffMinutes < 60) return `${diffMinutes}min`;
  if (diffHours < 24) return `${diffHours}h`;
  if (diffDays < 7) return `${diffDays}zile`;
  return createdAt.toLocaleDateString();
}

function logEnrichmentFailure(
  enrichment: "metrics" | "clientNames",
  error: unknown,
) {
  if (process.env.NODE_ENV !== "development") return;

  if (error instanceof AsyncTimeoutError) {
    console.warn(`[ENRICH] ${enrichment}:timeout`);
    return;
  }

  console.error(`[ENRICH] ${enrichment}:error`, error);
}
