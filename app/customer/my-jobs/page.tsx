"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import {
  getOwnRepairRequests,
  type RepairRequestRow,
} from "@/lib/supabase/repair-requests";
import {
  getOffersForCustomerRequests,
  type RepairOfferRow,
} from "@/lib/supabase/repair-offers";
type LatestProgress = {
  status: string | null;
  created_at: string;
};

export default function MyJobsPage() {
  const router = useRouter();

  const [requests, setRequests] = useState<RepairRequestRow[]>([]);
  const [offers, setOffers] = useState<RepairOfferRow[]>([]);
  const [progressByRequestId, setProgressByRequestId] = useState<
    Record<string, { latestStatus: string | null; count: number }>
  >({});
  const [loading, setLoading] = useState(true);
  const [unreadByRequestId, setUnreadByRequestId] = useState<
    Record<string, number>
  >({});
  const [activeTab, setActiveTab] = useState<"active" | "completed">("active");
  const [reviewedRequestIds, setReviewedRequestIds] = useState<string[]>([]);

  const loadJobs = async () => {
    try {
      const { data: authData } = await supabase.auth.getUser();

      if (!authData.user) {
        router.push("/login");
        return;
      }

      const { data: reviewsData } = await supabase
        .from("reviews")
        .select("request_id")
        .eq("customer_user_id", authData.user.id);

      setReviewedRequestIds(
        (reviewsData || []).map((review) => review.request_id).filter(Boolean),
      );

      const [requestRows, offerRows] = await Promise.all([
        getOwnRepairRequests(authData.user.id),
        getOffersForCustomerRequests(authData.user.id),
      ]);

      setRequests(requestRows);
      setOffers(offerRows);

      const progressMap: Record<
        string,
        { latestStatus: string | null; count: number }
      > = {};

      const { data: unreadData } = await supabase.rpc(
        "get_unread_progress_updates_by_request",
      );

      const unreadMap: Record<string, number> = {};

      (unreadData || []).forEach((row: any) => {
        unreadMap[row.request_id] = row.unread_count;
      });

      setUnreadByRequestId(unreadMap);

      await Promise.all(
        requestRows.map(async (request) => {
          const { data } = await supabase
            .from("work_progress_updates")
            .select("status, created_at")
            .eq("request_id", request.id)
            .order("created_at", { ascending: false });

          progressMap[request.id] = {
            latestStatus: data?.[0]?.status || null,
            count: data?.length || 0,
          };
        }),
      );

      setProgressByRequestId(progressMap);
    } catch (error) {
      console.error("Failed to load jobs:", error);
      alert("Nu am putut încărca programările.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadJobs();
  }, []);

  useEffect(() => {
    const handleFocus = () => {
      loadJobs();
    };

    window.addEventListener("focus", handleFocus);

    return () => {
      window.removeEventListener("focus", handleFocus);
    };
  }, []);

  const jobs = useMemo(() => {
    return requests
      .filter((request) => {
        const status = request.status || "";

        return ["matched", "in_progress", "completed"].includes(status);
      })
      .map((request) => {
        const acceptedOffer = offers.find(
          (offer) =>
            offer.id === request.accepted_offer_id ||
            (offer.request_id === request.id && offer.status === "accepted"),
        );

        return {
          request,
          acceptedOffer,
        };
      });
  }, [requests, offers]);

  const completedJobs = jobs.filter(
    ({ request }) => request.status === "completed",
  );

  const activeJobs = jobs.filter(
    ({ request }) => request.status !== "completed",
  );

  const visibleJobs = activeTab === "active" ? activeJobs : completedJobs;

  return (
    <main className="min-h-screen bg-[#111111] px-4 py-5 text-white">
      <div className="mx-auto max-w-5xl">
        <div className="mb-5 flex items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.25em] text-orange-400">
              Client
            </p>
            <h1 className="mt-1 text-2xl font-bold">Programări</h1>
          </div>

          <button
            onClick={() => router.push("/customer/dashboard")}
            className="rounded-full border border-white/15 px-4 py-2 text-sm font-semibold text-white"
          >
            Dashboard
          </button>
        </div>

        <div className="mb-5 flex gap-3">
          <button
            onClick={() => setActiveTab("active")}
            className={`rounded-full px-5 py-2 font-semibold transition ${
              activeTab === "active"
                ? "bg-orange-500 text-black"
                : "bg-white/10 text-white"
            }`}
          >
            Active ({activeJobs.length})
          </button>

          <button
            onClick={() => setActiveTab("completed")}
            className={`rounded-full px-5 py-2 font-semibold transition ${
              activeTab === "completed"
                ? "bg-orange-500 text-black"
                : "bg-white/10 text-white"
            }`}
          >
            Finalizate ({completedJobs.length})
          </button>
        </div>

        {loading ? (
          <p className="text-white/60">Se încarcă programările...</p>
        ) : jobs.length === 0 ? (
          <div className="rounded-[22px] bg-white p-6 text-center text-black">
            <h2 className="text-xl font-bold">Nu ai programări încă</h2>
            <p className="mt-2 text-sm text-black/60">
              Când accepți o ofertă, lucrarea programată va apărea aici.
            </p>

            <button
              onClick={() => router.push("/offers")}
              className="mt-5 rounded-full bg-black px-5 py-3 text-sm font-semibold text-white"
            >
              Vezi ofertele
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            {visibleJobs.map(({ request, acceptedOffer }) => {
              const image =
                request.images?.[0]?.url || request.images?.[0]?.dataUrl || "";

              const latestProgress = progressByRequestId[request.id];
              const displayStatus =
                latestProgress?.latestStatus || request.status;

              return (
                <div
                  key={request.id}
                  onClick={() => router.push(`/customer/my-jobs/${request.id}`)}
                  className="overflow-hidden rounded-[26px] bg-white text-black shadow-lg transition active:scale-[0.99]"
                >
                  <div className="flex gap-4 p-4">
                    <div className="h-24 w-24 shrink-0 overflow-hidden rounded-3xl bg-black/10">
                      {image ? (
                        <img
                          src={image}
                          alt={`${request.car_brand} ${request.car_model}`}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-xs text-black/40">
                          No photo
                        </div>
                      )}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="flex items-center gap-2">
                            <h2 className="text-xl font-black leading-tight">
                              {request.car_brand} {request.car_model}
                            </h2>

                            {(unreadByRequestId[request.id] || 0) > 0 && (
                              <span className="rounded-full bg-orange-500 px-2 py-1 text-[10px] font-black text-white">
                                NOU
                              </span>
                            )}
                          </div>
                          <p className="mt-1 text-sm text-black/55">
                            {request.car_year} • {request.city}
                          </p>
                        </div>

                        <span
                          className={`shrink-0 rounded-full px-3 py-1 text-xs font-bold ${getStatusClass(
                            progressByRequestId[request.id]?.latestStatus ||
                              request.status,
                          )}`}
                        >
                          {formatJobStatus(
                            progressByRequestId[request.id]?.latestStatus ||
                              request.status,
                          )}
                        </span>
                      </div>

                      {acceptedOffer && (
                        <div className="mt-3 rounded-2xl bg-black/[0.04] p-3">
                          <p className="text-xs text-black/45">Service</p>
                          <p className="font-semibold">
                            {acceptedOffer.workshop_name}
                          </p>

                          <div className="mt-2 flex items-center justify-between text-sm">
                            <span className="text-black/55">
                              {acceptedOffer.days}{" "}
                              {String(acceptedOffer.days) === "1"
                                ? "zi"
                                : "zile"}
                            </span>
                            <span className="font-bold">
                              €{acceptedOffer.price}
                            </span>
                          </div>
                        </div>
                      )}

                      {progressByRequestId[request.id] && (
                        <div className="mt-3 flex flex-wrap gap-2">
                          <span className="rounded-full bg-orange-100 px-3 py-1 text-[11px] font-bold text-orange-700">
                            {progressByRequestId[request.id].latestStatus ||
                              "Waiting"}
                          </span>

                          <span className="rounded-full bg-black px-3 py-1 text-[11px] font-bold text-white">
                            {progressByRequestId[request.id].count} update-uri
                          </span>
                        </div>
                      )}

                      <p className="mt-3 line-clamp-2 text-sm text-black/65">
                        {request.description || "Fără descriere."}
                      </p>

                      <div className="mt-4">
                        <button
                          type="button"
                          disabled={!acceptedOffer}
                          onClick={(event) => {
                            event.stopPropagation();

                            if (!acceptedOffer) {
                              alert("Oferta acceptată nu a fost găsită.");
                              return;
                            }

                            router.push(
                              `/chat/${request.id}?offerId=${acceptedOffer.id}`,
                            );
                          }}
                          className="rounded-2xl bg-black px-4 py-3 text-sm font-bold text-white disabled:opacity-40"
                        >
                          Chat cu service-ul
                        </button>

                        {request.status === "completed" &&
                          (reviewedRequestIds.includes(request.id) ? (
                            <button
                              type="button"
                              disabled
                              className="mt-3 rounded-2xl bg-emerald-100 px-4 py-3 text-sm font-bold text-emerald-700"
                            >
                              ✓ Review trimis
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                router.push(`/review?id=${request.id}`);
                              }}
                              className="mt-3 rounded-2xl bg-orange-500 px-4 py-3 text-sm font-bold text-white"
                            >
                              ⭐ Lasă review
                            </button>
                          ))}
                      </div>
                    </div>
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

function formatJobStatus(status?: string | null) {
  switch (status) {
    case "Received":
    case "received":
      return "Primită";

    case "Diagnosis":
    case "diagnosis":
      return "Diagnoză";

    case "Parts ordered":
    case "parts_ordered":
      return "Piese comandate";

    case "In repair":
    case "in repair":
    case "in_repair":
      return "În reparație";

    case "Testing":
    case "testing":
      return "Testare";

    case "Ready":
    case "ready":
    case "Gata":
      return "Gata";

    case "in_progress":
      return "În lucru";

    case "painting":
      return "La vopsit";

    case "polishing":
      return "La polish";

    case "completed":
      return "Finalizată";

    case "matched":
      return "Programată";

    default:
      return "Programată";
  }
}

function getStatusClass(status?: string | null) {
  switch (status) {
    case "Received":
    case "received":
      return "bg-gray-100 text-gray-700";

    case "Diagnosis":
    case "diagnosis":
      return "bg-yellow-100 text-yellow-700";

    case "Parts ordered":
    case "parts_ordered":
      return "bg-indigo-100 text-indigo-700";

    case "In repair":
    case "in repair":
    case "in_repair":
      return "bg-orange-100 text-orange-700";

    case "Testing":
    case "testing":
      return "bg-blue-100 text-blue-700";

    case "Ready":
    case "ready":
    case "Gata":
      return "bg-green-100 text-green-700";

    case "in_progress":
      return "bg-blue-100 text-blue-700";

    case "painting":
      return "bg-orange-100 text-orange-700";

    case "polishing":
      return "bg-purple-100 text-purple-700";

    case "completed":
      return "bg-green-100 text-green-700";

    case "matched":
      return "bg-orange-100 text-orange-700";

    default:
      return "bg-orange-100 text-orange-700";
  }
}
