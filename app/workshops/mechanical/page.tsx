"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import {
  getWorkshopRepairRequests,
  type RepairRequestRow,
} from "@/lib/supabase/repair-requests";
import CarHeader from "@/app/components/CarHeader";
import { formatPostedTime } from "@/lib/formatters";
import { getRequestTypeBadgeLabel } from "@/lib/displayLabels";
import { getMechanicalServiceDetailGroups } from "@/lib/mechanical/mechanical-service-details";
import { getWorkshopRequestMetrics } from "@/lib/supabase/repair-request-metrics";
import RepairRequestMetrics from "@/app/components/RepairRequestMetrics";
import { recordWorkshopRequestView } from "@/lib/supabase/repair-request-views";
import { getWorkshopRequestClientNames } from "@/lib/supabase/workshop-client-names";
import RequestClientName from "@/app/components/RequestClientName";
import { checkWorkshopAccess } from "@/lib/auth/workshop-access";

type WorkshopRequest = {
  id: string;
  carBrand: string;
  carModel: string;
  carYear: string;
  city: string;
  licensePlate: string | null;
  damageType: string;
  serviceDetails: RepairRequestRow["service_details"];
  description: string;
  images: {
    name: string;
    url?: string;
    dataUrl?: string;
  }[];
  status: string;
  accepted_offer_id?: string | null;
  postedAt: string;
  viewCount: number;
  offerCount: number;
  clientName: string | null;
};

const filters = [
  { id: "all", label: "Toate", icon: "📋" },
  { id: "engine", label: "Motor", icon: "🚗" },
  { id: "gearbox", label: "Cutie", icon: "⚙️" },
  { id: "brakes", label: "Frâne", icon: "🛑" },
  { id: "suspension", label: "Suspensie", icon: "🚙" },
  { id: "steering", label: "Direcție", icon: "🛞" },
  { id: "electrical", label: "Electrică", icon: "🔋" },
  { id: "ac", label: "AC", icon: "❄️" },
  { id: "diagnostic", label: "Diagnoză", icon: "💻" },
  { id: "service", label: "Revizie", icon: "🛠️" },
];

export default function WorkshopsPage() {
  const router = useRouter();
  const [requests, setRequests] = useState<WorkshopRequest[]>([]);
  const [authorized, setAuthorized] = useState(false);
  const [currentWorkshopUserId, setCurrentWorkshopUserId] = useState<
    string | null
  >(null);
  const [checkingAccess, setCheckingAccess] = useState(true);
  const [accessError, setAccessError] = useState(false);
  const [accessCheckVersion, setAccessCheckVersion] = useState(0);
  const accessAttemptRef = useRef(0);
  const [loadingRequests, setLoadingRequests] = useState(false);
  const [dataError, setDataError] = useState(false);
  const [activeFilter, setActiveFilter] = useState("all");

  useEffect(() => {
    let cancelled = false;
    const attemptId = ++accessAttemptRef.current;

    const isCurrentAttempt = () =>
      !cancelled && attemptId === accessAttemptRef.current;

    const markDirectRequestsRead = async (workshopUserId: string) => {
      const { error } = await supabase
        .from("repair_requests")
        .update({
          target_workshop_read_at: new Date().toISOString(),
        })
        .eq("target_workshop_id", workshopUserId)
        .eq("service_type", "mechanical")
        .eq("request_type", "direct_request")
        .is("target_workshop_read_at", null)
        .select(
          "id, service_type, request_type, target_workshop_id, target_workshop_read_at",
        );

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
        setCurrentWorkshopUserId(result.userId);
        setLoadingRequests(true);
        setAuthorized(true);
        setAccessError(false);
        setCheckingAccess(false);
        void loadRequests();
        void markDirectRequestsRead(result.userId);
        return;
      }

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

  const loadRequests = async (
    { silent = false }: { silent?: boolean } = {},
  ) => {
    if (!silent) {
      setLoadingRequests(true);
      setDataError(false);
    }

    try {
      const rows = await getWorkshopRepairRequests();

      const { data: authData } = await supabase.auth.getUser();
      const workshopUserId = authData.user?.id;

      let offeredRequestIds: string[] = [];

      if (workshopUserId) {
        const { data: existingOffers, error: existingOffersError } =
          await supabase
            .from("repair_offers")
            .select("request_id")
            .eq("workshop_user_id", workshopUserId);

        if (existingOffersError) {
          console.error("Failed to load existing offers:", existingOffersError);
        }

        offeredRequestIds = (existingOffers || [])
          .map((offer) => offer.request_id)
          .filter(Boolean);
      }

      const mechanicalRows = rows.filter((req) => {
        const requestType = req.request_type ?? "repair";

        const isVisibleToWorkshop =
          requestType === "repair" ||
          (requestType === "direct_request" &&
            req.target_workshop_id === workshopUserId);

        return (
          req.service_type === "mechanical" &&
          req.status === "open" &&
          !req.accepted_offer_id &&
          isVisibleToWorkshop &&
          !offeredRequestIds.includes(req.id)
        );
      });

      let metricsByRequestId: Awaited<
        ReturnType<typeof getWorkshopRequestMetrics>
      > = new Map();

      try {
        metricsByRequestId = await getWorkshopRequestMetrics(
          mechanicalRows.map((request) => request.id),
        );
      } catch (metricsError) {
        console.error("Failed to load repair request metrics:", metricsError);
      }

      const clientNamesByRequestId = await getWorkshopRequestClientNames(
        mechanicalRows.map((request) => request.id),
      );

      const mapped: WorkshopRequest[] = mechanicalRows.map(
        (req: RepairRequestRow) => {
          const metrics = metricsByRequestId.get(req.id);

          return {
            id: req.id,
            carBrand: req.car_brand || "Unknown brand",
            carModel: req.car_model || "Unknown model",
            carYear: req.car_year || "-",
            city: req.city || "-",
            licensePlate: req.license_plate,
            damageType: req.damage_type || "other",
            serviceDetails: req.service_details,
            description: req.description || "No description provided.",
            images: Array.isArray(req.images) ? req.images : [],
            status: req.status || "open",
            accepted_offer_id: req.accepted_offer_id,
            postedAt: formatPostedAt(req.created_at),
            viewCount: metrics?.viewCount ?? 0,
            offerCount: metrics?.offerCount ?? 0,
            clientName: clientNamesByRequestId.get(req.id) ?? null,
          };
        },
      );

      setRequests(mapped);
      setDataError(false);
    } catch (error) {
      if (process.env.NODE_ENV === "development") {
        console.error("[DATA] loadRequests:error", error);
      }
      if (!silent) {
        setRequests([]);
        setDataError(true);
      }
    } finally {
      if (!silent) {
        setLoadingRequests(false);
      }
    }
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
    if (!authorized || !currentWorkshopUserId) {
      return;
    }

    let hasSubscribed = false;

    const channel = supabase
      .channel("workshop-mechanical-repair-request-updates")
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "repair_requests",
        },
        () => {
          refreshRequestsFromRealtime();
        },
      )
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "repair_offers",
          filter: `workshop_user_id=eq.${currentWorkshopUserId}`,
        },
        () => {
          refreshRequestsFromRealtime();
        },
      )
      .subscribe((status, error) => {
        if (process.env.NODE_ENV === "development" && error) {
          console.error("Mechanical requests Realtime error:", status, error);
        }

        if (status === "SUBSCRIBED") {
          if (hasSubscribed) {
            refreshRequestsFromRealtime();
          }

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

  if (!authorized) {
    return null;
  }

  const filterGroups: Record<string, string[]> = {
    all: [],
    engine: ["engine"],
    gearbox: ["gearbox"],
    brakes: ["brakes"],
    suspension: ["suspension"],
    steering: ["steering"],
    electrical: ["electrical"],
    ac: ["ac"],
    diagnostic: ["diagnostic"],
    service: ["service"],
  };

  const filteredRequests =
    activeFilter === "all"
      ? requests
      : requests.filter((request) =>
          filterGroups[activeFilter]?.includes(request.damageType),
        );

  return (
    <main className="min-h-screen bg-black px-6 py-10 text-white">
      <div className="mx-auto max-w-7xl">
        <div className="mb-8 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-sm uppercase tracking-[0.2em] text-white/40">
              Service auto
            </p>
            <h1 className="mt-2 text-3xl font-bold md:text-4xl">
              Daune mecanice disponibile
            </h1>
            <p className="mt-3 max-w-2xl text-white/70">
              Alege o problemă mecanică și trimite oferta ta clientului.
            </p>
          </div>

          <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white/70">
            {filteredRequests.length} lucrări
          </div>
        </div>

        <div className="mb-6 flex gap-3 overflow-x-auto pb-2">
          {filters.map((filter) => (
            <button
              key={filter.id}
              onClick={() => setActiveFilter(filter.id)}
              className={`flex shrink-0 items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition ${
                activeFilter === filter.id
                  ? "bg-orange-500 text-white"
                  : "bg-white/5 text-white/70 hover:bg-white/10"
              }`}
            >
              <span>{filter.icon}</span>
              {filter.label}
            </button>
          ))}
        </div>

        {loadingRequests ? (
          <div className="rounded-2xl border border-white/10 bg-white/5 p-10 text-center">
            <p className="text-white/70">Se încarcă daunele...</p>
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
        ) : filteredRequests.length === 0 ? (
          <div className="rounded-2xl border border-white/10 bg-white/5 p-10 text-center">
            <h2 className="text-2xl font-semibold">
              Nu există lucrări pentru acest filtru
            </h2>
            <p className="mt-3 text-white/70">
              Când un client postează o lucrare potrivită, aceasta va apărea
              aici.
            </p>

            <button
              onClick={() => router.push("/workshops/dashboard")}
              className="mt-6 rounded-lg bg-white px-6 py-3 font-semibold text-black"
            >
              Înapoi la panou
            </button>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {filteredRequests.map((request) => {
              const isAcceptata = request.status === "matched";
              const mechanicalDetails = getMechanicalServiceDetailGroups(
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
                    mechanicalDetails={mechanicalDetails}
                    onActiveInteraction={() => recordEngagedView(request.id)}
                    details={[
                      {
                        text: isAcceptata ? "Acceptată" : "Deschisă",
                        color: isAcceptata ? "green" : "yellow",
                      },
                      {
                        text: getRequestTypeBadgeLabel("mechanical"),
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

function formatDamageType(value: string) {
  switch (value) {
    case "scratch":
      return "Zgârietură";
    case "dent":
      return "Îndoitură";
    case "bumper":
      return "Bară avariată";
    case "paint":
      return "Problemă vopsea";
    case "cracked_part":
      return "Element crăpat";
    default:
      return "Altă daună";
  }
}

function formatPostedAt(value: string) {
  const createdAt = new Date(value);
  const now = new Date();

  const diffMs = now.getTime() - createdAt.getTime();
  const diffMinutes = Math.floor(diffMs / 1000 / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (Number.isNaN(createdAt.getTime())) {
    return "Recent";
  }

  if (diffMinutes < 1) {
    return "Acum";
  }

  if (diffMinutes < 60) {
    return `${diffMinutes}min`;
  }

  if (diffHours < 24) {
    return `${diffHours}h`;
  }

  if (diffDays < 7) {
    return `${diffDays}zile`;
  }

  return createdAt.toLocaleDateString();
}
