"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import {
  getWorkshopRepairRequests,
  type RepairRequestRow,
} from "@/lib/supabase/repair-requests";

type WorkshopRequest = {
  id: string;
  carBrand: string;
  carModel: string;
  carYear: string;
  city: string;
  damageType: string;
  description: string;
  images: {
    name: string;
    url?: string;
    dataUrl?: string;
  }[];
  status: string;
  accepted_offer_id?: string | null;
  postedAt: string;
};

type ProfileRow = {
  role: string[] | null;
};

const serviceMeta: Record<string, { label: string; icon: string }> = {
  engine: { label: "Motor", icon: "🚗" },
  gearbox: { label: "Cutie viteze", icon: "⚙️" },
  brakes: { label: "Frâne", icon: "🛑" },
  suspension: { label: "Suspensie", icon: "🚙" },
  steering: { label: "Direcție", icon: "🛞" },
  electrical: { label: "Electrică", icon: "🔋" },
  ac: { label: "Aer condiționat", icon: "❄️" },
  diagnostic: { label: "Diagnoză", icon: "💻" },
  service: { label: "Revizie", icon: "🛠️" },
  other: { label: "Altă problemă", icon: "❓" },
};

function getServiceMeta(value: string) {
  return serviceMeta[value] || { label: value, icon: "🔧" };
}

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

  const loadRequests = async () => {
    setLoadingRequests(true);

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

      const mapped: WorkshopRequest[] = mechanicalRows.map(
        (req: RepairRequestRow) => ({
          id: req.id,
          carBrand: req.car_brand || "Unknown brand",
          carModel: req.car_model || "Unknown model",
          carYear: req.car_year || "-",
          city: req.city || "-",
          damageType: req.damage_type || "other",
          description: req.description || "No description provided.",
          images: Array.isArray(req.images) ? req.images : [],
          status: req.status || "open",
          accepted_offer_id: req.accepted_offer_id,
          postedAt: formatPostedAt(req.created_at),
        }),
      );

      setRequests(mapped);
    } catch (error) {
      console.error("Failed to load repair requests:", error);
      setRequests([]);
    } finally {
      setLoadingRequests(false);
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
          <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
            {filteredRequests.map((request) => {
              const isAcceptata = request.status === "matched";
              const service = getServiceMeta(request.damageType);

              return (
                <div
                  key={request.id}
                  className="overflow-hidden rounded-2xl border border-white/10 bg-white/5"
                >
                  {request.images.length > 0 ? (
                    <button
                      type="button"
                      onClick={() => router.push(`/workshops/${request.id}`)}
                      className="block w-full overflow-hidden"
                    >
                      <img
                        src={
                          request.images[0].url ||
                          request.images[0].dataUrl ||
                          ""
                        }
                        alt={`${request.carBrand} ${request.carModel}`}
                        className="h-56 w-full object-cover"
                      />
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => router.push(`/workshops/${request.id}`)}
                      className="flex h-56 w-full items-center justify-center bg-white/5 text-white/40"
                    >
                      Fără poză
                    </button>
                  )}

                  <div className="p-5">
                    <div className="mb-4 flex items-start justify-between gap-3">
                      <div>
                        <h2 className="text-2xl font-semibold">
                          {request.carBrand} {request.carModel}
                        </h2>
                        <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-orange-500/10 px-3 py-1 text-sm font-bold text-orange-400">
                          <span>{service.icon}</span>

                          <span>{service.label}</span>
                        </div>
                        <p className="mt-1 text-sm text-white/50">
                          {request.carYear} • {request.city}
                        </p>
                      </div>

                      <span className="rounded-full border border-white/10 bg-black/30 px-3 py-1 text-xs text-white/70">
                        {request.postedAt}
                      </span>
                    </div>

                    <div className="mb-4 flex flex-wrap gap-2">
                      <span
                        className={`inline-block rounded-full border px-3 py-1 text-xs font-medium ${
                          isAcceptata
                            ? "border-green-500/20 bg-green-500/15 text-green-300"
                            : "border-yellow-500/20 bg-yellow-500/15 text-yellow-300"
                        }`}
                      >
                        {isAcceptata ? "Acceptată" : "Deschisă"}
                      </span>
                    </div>

                    <p className="min-h-[72px] text-sm leading-6 text-white/75">
                      {request.description}
                    </p>
                  </div>
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
