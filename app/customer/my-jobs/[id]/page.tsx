"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { Home } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import type { RepairRequestRow } from "@/lib/supabase/repair-requests";
import ImageGallery from "@/app/components/ImageGallery";
import {
  formatProgressStatus,
  normalizeProgressStatus,
} from "@/lib/work-progress/workflows";
import { useTowingLiveLocation } from "@/lib/hooks/useTowingLiveLocation";
import {
  formatTowingLiveEta,
  isValidTowingCoordinate,
} from "@/lib/towing/towing-live-tracking";

const TowingLiveTrackingMap = dynamic(
  () => import("@/app/components/towing/TowingLiveTrackingMap"),
  { ssr: false },
);

type WorkProgressUpdate = {
  id: string;
  status: string | null;
  message: string | null;
  images: string[] | null;
  created_at: string;
};

type AcceptedOffer = {
  id: string;
  workshop_user_id: string;
  workshop_name: string | null;
  price: number | string | null;
  days: number | string | null;
  message: string | null;
};

export default function CustomerJobDetailPage() {
  const router = useRouter();
  const params = useParams();

  const requestId = params.id as string;

  const [request, setRequest] = useState<RepairRequestRow | null>(null);
  const [offer, setOffer] = useState<AcceptedOffer | null>(null);
  const [progressUpdates, setProgressUpdates] = useState<WorkProgressUpdate[]>(
    [],
  );
  const [loading, setLoading] = useState(true);
  const [rating, setRating] = useState(0);
  const [reviewText, setReviewText] = useState("");
  const [existingReview, setExistingReview] = useState(false);

  const latestStatus =
    progressUpdates.length > 0 ? progressUpdates[0].status : null;

  const isCompleted =
    request?.status === "completed" ||
    latestStatus === "Ready" ||
    latestStatus === "Gata";
  const normalizedLatestStatus = normalizeProgressStatus(latestStatus);
  const liveTrackingEnabled =
    request?.service_type === "towing" &&
    normalizedLatestStatus === "Dispatch";
  const liveTracking = useTowingLiveLocation({
    requestId,
    enabled: liveTrackingEnabled,
  });
  const liveEta =
    liveTracking.state === "live"
      ? formatTowingLiveEta(liveTracking.row, liveTracking.now)
      : null;

  const getStatusColor = (status?: string | null) => {
    switch (status?.toLowerCase()) {
      case "received":
        return "bg-blue-500";
      case "disassembly":
        return "bg-orange-500";
      case "body repair":
        return "bg-purple-500";
      case "paint preparation":
      case "paint_preparation":
        return "bg-red-500";
      case "painting":
        return "bg-red-500";
      case "polishing":
        return "bg-lime-500";
      case "ready":
        return "bg-emerald-500";
      default:
        return "bg-orange-500";
    }
  };

  useEffect(() => {
    const loadJob = async () => {
      try {
        setLoading(true);

        if (!requestId) {
          router.push("/customer/my-jobs");
          return;
        }

        const { data: authData } = await supabase.auth.getUser();

        if (!authData.user) {
          router.push("/login");
          return;
        }

        const { data: requestData, error: requestError } = await supabase
          .from("repair_requests")
          .select("*")
          .eq("id", requestId)
          .single<RepairRequestRow>();

        if (requestError) {
          console.error(requestError);
          router.push("/customer/my-jobs");
          return;
        }

        setRequest(requestData);

        if (requestData.accepted_offer_id) {
          const { data: offerData } = await supabase
            .from("repair_offers")
            .select("id, workshop_name, price, days, message")
            .eq("id", requestData.accepted_offer_id)
            .single<AcceptedOffer>();

          setOffer(offerData || null);
        }

        const { data: progressData, error: progressError } = await supabase
          .from("work_progress_updates")
          .select("*")
          .eq("request_id", requestId)
          .order("created_at", { ascending: false });

        if (progressError) {
          console.error(progressError);
        } else {
          setProgressUpdates(progressData || []);

          const unreadUpdates =
            progressData?.map((update) => ({
              update_id: update.id,
              user_id: authData.user.id,
            })) || [];

          if (unreadUpdates.length > 0) {
            await supabase.rpc("mark_progress_updates_read", {
              p_request_id: requestId,
            });

            window.dispatchEvent(new Event("progress-read-updated"));
          }
        }
      } catch (error) {
        console.error(error);
      } finally {
        setLoading(false);
      }
    };

    loadJob();
    let hasReconciledOnSubscribe = false;

    const channel = supabase
      .channel(`customer-job-progress-${requestId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "work_progress_updates",
          filter: `request_id=eq.${requestId}`,
        },
        async () => {
          await loadJob();
        },
      )
      .subscribe((status, error) => {
        if (process.env.NODE_ENV === "development") {
          if (status === "SUBSCRIBED") {
            console.info("[WORK-PROGRESS-RT] SUBSCRIBED");
          } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
            console.warn(`[WORK-PROGRESS-RT] ${status}`, error ?? undefined);
          }
        }

        if (status === "SUBSCRIBED" && !hasReconciledOnSubscribe) {
          hasReconciledOnSubscribe = true;
          void loadJob();
        }
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [requestId, router]);

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#101010] text-white">
        Se încarcă lucrarea...
      </main>
    );
  }

  if (!request) return null;

  const pickupCoordinateCandidate = {
    lat: request.pickup_lat,
    lng: request.pickup_lng,
  };
  const pickupCoordinate = isValidTowingCoordinate(
    pickupCoordinateCandidate,
  )
    ? pickupCoordinateCandidate
    : null;

  const submitReview = async () => {
    if (!request || !offer || rating === 0 || existingReview) return;

    const { data: authData } = await supabase.auth.getUser();
    const customerUserId = authData.user?.id;

    if (!customerUserId) return;

    const { error } = await supabase.from("workshop_reviews").insert({
      request_id: request.id,
      workshop_user_id: offer.workshop_user_id,
      customer_user_id: customerUserId,
      rating,
      review_text: reviewText.trim() || null,
    });

    if (error) {
      console.error("Failed to submit review:", error);
      return;
    }

    setExistingReview(true);
  };

  return (
    <main className="min-h-screen bg-[#101010] px-4 py-5 text-white">
      <div className="mx-auto max-w-4xl">
        <div className="mb-5 flex items-center justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.25em] text-orange-400">
              Programare service
            </p>
            <h1 className="mt-2 text-2xl font-bold">Urmărește lucrarea</h1>
            <p className="mt-2 text-sm text-white/55">
              Aici vezi service-ul, prețul și progresul live al reparației.
            </p>
          </div>

          <button
            type="button"
            onClick={() => router.push("/customer/dashboard")}
            className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full border border-white/20 bg-black/40 text-white"
          >
            <Home size={24} />
          </button>
        </div>

        <div className="rounded-[24px] bg-white p-5 text-black shadow-xl">
          <div className="rounded-3xl bg-black p-5 text-white">
            <p className="text-xs uppercase tracking-[0.22em] text-orange-400">
              Service programat
            </p>

            <h2 className="mt-2 text-2xl font-black">
              {offer?.workshop_name || "Service auto"}
            </h2>

            <div className="mt-4 grid grid-cols-2 gap-3">
              <div className="rounded-2xl bg-white/10 p-4">
                <p className="text-xs text-white/50">Preț</p>
                <p className="mt-1 text-lg font-black">
                  {offer?.price ? `${offer.price} €` : "—"}
                </p>
              </div>

              {request.service_type !== "towing" && (
                <div className="rounded-2xl bg-white/10 p-4">
                  <p className="text-xs text-white/50">Durată</p>
                  <p className="mt-1 text-lg font-black">
                    {offer?.days ? `${offer.days} zile` : "—"}
                  </p>
                </div>
              )}
            </div>

            {offer?.message && (
              <p className="mt-4 text-sm text-white/70">{offer.message}</p>
            )}
          </div>

          <div className="mt-6 grid gap-3 md:grid-cols-2">
            <InfoCard label="Marcă" value={request.car_brand} />
            <InfoCard label="Model" value={request.car_model} />
            <InfoCard label="An fabricație" value={request.car_year} />
            <InfoCard label="Localitate" value={request.city} />
          </div>

          {liveTrackingEnabled && (
            <section className="mt-6 rounded-3xl bg-black p-5 text-white">
              {liveTracking.loading && !liveTracking.row ? (
                <>
                  <p className="text-xs font-bold uppercase tracking-[0.2em] text-orange-400">
                    Tracking platformă
                  </p>
                  <p className="mt-2 text-sm text-white/55">
                    Se verifică locația platformei...
                  </p>
                </>
              ) : liveTracking.state === "live" ? (
                <>
                  <div className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-emerald-400" />
                    <h2 className="text-lg font-black">
                      Platforma este în drum
                    </h2>
                  </div>
                  <p className="mt-1 text-sm text-white/55">
                    Locația se actualizează în timp real
                  </p>
                  {liveEta && (
                    <p className="mt-2 text-base font-bold text-white/85">
                      {liveEta}
                    </p>
                  )}
                </>
              ) : liveTracking.state === "stale" ? (
                <>
                  <h2 className="text-lg font-black">
                    Locația platformei este momentan indisponibilă
                  </h2>
                  <p className="mt-1 text-sm text-amber-300">
                    {formatTrackingAge(
                      liveTracking.row?.position_updated_at,
                      liveTracking.now,
                      true,
                    )}
                  </p>
                </>
              ) : liveTracking.state === "stopped" ? (
                <>
                  <h2 className="text-lg font-black">
                    Trackingul locației este oprit
                  </h2>
                  <p className="mt-1 text-sm text-white/55">
                    Service-ul nu transmite locația în acest moment.
                  </p>
                </>
              ) : liveTracking.state === "error" ? (
                <>
                  <h2 className="text-lg font-black">
                    Locația platformei nu este disponibilă
                  </h2>
                  <p className="mt-1 text-sm text-red-300" role="alert">
                    {liveTracking.error}
                  </p>
                </>
              ) : (
                <>
                  <h2 className="text-lg font-black">
                    Trackingul nu a început încă
                  </h2>
                  <p className="mt-1 text-sm text-white/55">
                    Locația va apărea după ce service-ul pornește trackingul.
                  </p>
                </>
              )}

              {pickupCoordinate &&
                (liveTracking.state === "live" ||
                  liveTracking.state === "stale") && (
                  <TowingLiveTrackingMap
                    pickup={pickupCoordinate}
                    platform={
                      liveTracking.state === "live"
                        ? liveTracking.coordinate
                        : null
                    }
                  />
                )}

              {liveTracking.state === "live" && (
                <p className="mt-3 text-xs font-semibold text-white/50">
                  {formatTrackingAge(
                    liveTracking.row?.position_updated_at,
                    liveTracking.now,
                    false,
                  )}
                </p>
              )}

              {liveTracking.state === "stale" && (
                <p className="mt-3 text-xs font-semibold uppercase tracking-[0.12em] text-white/40">
                  Harta afișează doar locația de preluare
                </p>
              )}
            </section>
          )}

          <div className="mt-8">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.25em] text-orange-500">
                  Service updates
                </p>

                <h2 className="mt-1 text-2xl font-black text-black">
                  Status lucrare
                </h2>
              </div>

              <div className="rounded-full bg-orange-100 px-4 py-2 text-xs font-bold text-orange-600">
                {progressUpdates.length} update-uri
              </div>
            </div>

            {request.status === "Ready" && (
              <div className="mt-6 rounded-3xl border border-emerald-500/25 bg-emerald-500/10 p-5">
                <p className="text-3xl">🎉</p>

                <h2 className="mt-3 text-2xl font-black text-emerald-700">
                  Mașina este gata
                </h2>

                <p className="mt-2 text-sm font-medium text-emerald-700/80">
                  Finalizată pe{" "}
                  {new Date(progressUpdates[0]?.created_at).toLocaleDateString(
                    "ro-RO",
                    {
                      day: "2-digit",
                      month: "long",
                      year: "numeric",
                    },
                  )}
                  {" • "}
                  {new Date(progressUpdates[0]?.created_at).toLocaleTimeString(
                    "ro-RO",
                    {
                      hour: "2-digit",
                      minute: "2-digit",
                    },
                  )}
                </p>

                <p className="mt-2 text-sm leading-relaxed text-black/60">
                  Service-ul a finalizat lucrarea. Poți contacta atelierul
                  pentru ridicarea mașinii sau pentru ultimele detalii.
                </p>

                <button
                  type="button"
                  onClick={() => router.push(`/chat/${request.id}`)}
                  className="mt-4 w-full rounded-2xl bg-black px-5 py-3 text-sm font-bold text-white"
                >
                  Contactează service-ul
                </button>
              </div>
            )}

            <div className="h-8" />

            {progressUpdates.length === 0 ? (
              <div className="rounded-3xl bg-black/[0.04] p-6 text-center text-sm text-black/50">
                Service-ul nu a trimis încă update-uri.
              </div>
            ) : (
              <div className="relative ml-6 border-l-2 border-black/10 pl-8">
                {progressUpdates.map((update, index) => (
                  <div key={update.id} className="relative mb-7">
                    <div
                      className={`absolute -left-[43px] top-6 h-5 w-5 rounded-full border-4 border-white shadow-md ${getStatusColor(
                        update.status,
                      )}`}
                    />

                    <div
                      className={`overflow-hidden rounded-3xl border bg-white shadow-sm ${
                        index === 0
                          ? "border-emerald-300 ring-2 ring-emerald-100"
                          : "border-black/10"
                      }`}
                    >
                      <div className="border-b border-black/5 bg-orange-50 px-5 py-4">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <p className="text-xs font-bold uppercase tracking-[0.2em] text-orange-500">
                              {formatProgressStatus(update.status) || "Update"}
                            </p>

                            <div className="mt-1 flex items-center gap-2 text-xs text-black/45">
                              <span>#{progressUpdates.length - index}</span>
                              <span>•</span>

                              <span>
                                {new Date(update.created_at).toLocaleDateString(
                                  "ro-RO",
                                  {
                                    day: "2-digit",
                                    month: "short",
                                    year: "numeric",
                                  },
                                )}
                              </span>

                              <span>•</span>

                              <span>
                                {new Date(update.created_at).toLocaleTimeString(
                                  "ro-RO",
                                  {
                                    hour: "2-digit",
                                    minute: "2-digit",
                                  },
                                )}
                              </span>
                            </div>
                          </div>

                          <div className="flex items-center gap-2">
                            {Array.isArray(update.images) &&
                              update.images.length > 0 && (
                                <div className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-black/70">
                                  📸 {update.images.length}{" "}
                                  {update.images.length === 1 ? "poză" : "poze"}
                                </div>
                              )}

                            <div className="rounded-full bg-black px-4 py-2 text-xs font-bold text-white">
                              Service
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="p-5">
                        <p className="text-sm leading-relaxed text-black/75">
                          {update.message || "Fără mesaj."}
                        </p>

                        {Array.isArray(update.images) &&
                          update.images.length > 0 && (
                            <div className="mt-4 overflow-hidden rounded-2xl">
                              <ImageGallery
                                images={update.images.map(
                                  (url, imageIndex) => ({
                                    name: `progress-${update.id}-${imageIndex}`,
                                    url,
                                  }),
                                )}
                                alt="Poze progres lucrare"
                                className="h-44 w-full object-cover"
                                wrapperClassName="block w-full overflow-hidden rounded-2xl"
                              />
                            </div>
                          )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={() => router.push("/customer/my-jobs")}
            className="mt-6 w-full rounded-2xl bg-black px-6 py-4 font-semibold text-white"
          >
            Înapoi la programări
          </button>
        </div>
      </div>

      {isCompleted && !existingReview && (
        <div className="mt-6 rounded-3xl border border-orange-500/20 bg-black/40 p-5">
          <h3 className="text-lg font-bold text-white">
            Lasă un review pentru service
          </h3>

          <div className="mt-4 flex gap-2">
            {[1, 2, 3, 4, 5].map((star) => (
              <button
                key={star}
                type="button"
                onClick={() => setRating(star)}
                className={`text-3xl transition ${
                  rating >= star ? "text-yellow-400" : "text-white/20"
                }`}
              >
                ★
              </button>
            ))}
          </div>

          <textarea
            value={reviewText}
            onChange={(e) => setReviewText(e.target.value)}
            placeholder="Cum a fost experiența cu acest service?"
            className="mt-4 w-full rounded-2xl border border-white/10 bg-black/40 p-3 text-white"
            rows={4}
          />

          <button
            type="button"
            onClick={submitReview}
            disabled={rating === 0}
            className="mt-4 rounded-2xl bg-orange-500 px-5 py-3 font-bold text-black disabled:opacity-50"
          >
            Trimite review
          </button>
        </div>
      )}
    </main>
  );
}

function formatTrackingAge(
  updatedAt: string | null | undefined,
  now: number,
  stale: boolean,
) {
  if (!updatedAt) {
    return stale
      ? "Ultima actualizare nu este disponibilă"
      : "Actualizat acum";
  }

  const timestamp = Date.parse(updatedAt);
  if (!Number.isFinite(timestamp)) {
    return stale
      ? "Ultima actualizare nu este disponibilă"
      : "Actualizat acum";
  }

  const elapsedSeconds = Math.max(0, Math.floor((now - timestamp) / 1_000));
  const prefix = stale ? "Ultima actualizare acum" : "Actualizat acum";

  if (elapsedSeconds < 5) return stale ? `${prefix} câteva secunde` : prefix;
  if (elapsedSeconds < 60) return `${prefix} ${elapsedSeconds} secunde`;

  const elapsedMinutes = Math.floor(elapsedSeconds / 60);
  return `${prefix} ${elapsedMinutes} ${elapsedMinutes === 1 ? "minut" : "minute"}`;
}

function InfoCard({
  label,
  value,
}: {
  label: string;
  value?: string | number | null;
}) {
  return (
    <div className="rounded-2xl bg-black/[0.04] p-4">
      <p className="text-xs font-medium uppercase tracking-[0.12em] text-black/40">
        {label}
      </p>
      <p className="mt-1 font-semibold text-black">{value || "—"}</p>
    </div>
  );
}
