"use client";

import { useEffect, useEffectEvent, useState } from "react";
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
};

type ProfileRow = {
  role: string[] | null;
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
  const [checkingAccess, setCheckingAccess] = useState(true);
  const [loadingRequests, setLoadingRequests] = useState(false);
  const [activeFilter, setActiveFilter] = useState("all");

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

        const { data: readData, error: readError } = await supabase
          .from("repair_requests")
          .update({
            target_workshop_read_at: new Date().toISOString(),
          })
          .eq("target_workshop_id", authData.user.id)
          .eq("service_type", "mechanical")
          .eq("request_type", "direct_request")
          .is("target_workshop_read_at", null)
          .select(
            "id, service_type, request_type, target_workshop_id, target_workshop_read_at",
          );

        window.dispatchEvent(new Event("direct-requests-read-updated"));

        setAuthorized(true);
        await loadRequests();
      } catch (error) {
        console.error("Access check failed:", error);
        router.push("/login");
      } finally {
        setCheckingAccess(false);
      }
    };

    checkUserAndLoad();
  }, [router]);

  const loadRequests = async (
    { silent = false }: { silent?: boolean } = {},
  ) => {
    if (!silent) {
      setLoadingRequests(true);
    }

    try {
      const rows = await getWorkshopRepairRequests();

      const { data: authData } = await supabase.auth.getUser();
      const workshopUserId = authData.user?.id;

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
          isVisibleToWorkshop
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
          };
        },
      );

      setRequests(mapped);
    } catch (error) {
      console.error("Failed to load repair requests:", error);
      if (!silent) {
        setRequests([]);
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
    if (!authorized) {
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
  }, [authorized]);

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
