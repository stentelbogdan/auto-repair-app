"use client";

import { formatOfferStatus } from "@/lib/utils/status";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import { acceptRepairOffer } from "@/lib/supabase/repair-offers";
import { getOwnRepairRequests } from "@/lib/supabase/repair-requests";
import Lightbox from "yet-another-react-lightbox";
import Zoom from "yet-another-react-lightbox/plugins/zoom";
import "yet-another-react-lightbox/styles.css";

type RepairRequest = {
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
  status?: string;
  acceptedOfferId?: string | null;
};

type RepairOffer = {
  id: string;
  requestId: string;
  workshopUserId: string;
  workshopSlug: string | null;
  price: string;
  days: string;
  message: string;
  workshopName: string;
  createdAt: string;
  status?: string;
  workshopLogoUrl: string | null;
  availableDate: string | null;
  availableTime: string | null;
};

type WorkshopRating = {
  average: number;
  count: number;
  lastReview?: string;
  completedJobs?: number;
  specialties?: string[];
};

type OfferWithRequest = {
  offer: RepairOffer;
  request: RepairRequest;
};

type ProfileRow = {
  role: string[] | null;
};

export default function OffersPage() {
  const router = useRouter();

  const [items, setItems] = useState<OfferWithRequest[]>([]);
  const [authorized, setAuthorized] = useState(false);
  const [checkingAccess, setCheckingAccess] = useState(true);
  const [loadingOffers, setLoadingOffers] = useState(false);
  const [acceptingOfferId, setAcceptingOfferId] = useState<string | null>(null);
  const [workshopRatings, setWorkshopRatings] = useState<
    Record<string, WorkshopRating>
  >({});

  const [selectedGallery, setSelectedGallery] = useState<{
    images: RepairRequest["images"];
    index: number;
  } | null>(null);

  useEffect(() => {
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

        if (!roles.includes("customer")) {
          router.push("/workshops/my-offers");
          return;
        }

        setAuthorized(true);
        await loadData(authData.user.id);
      } catch {
        router.push("/login");
      } finally {
        setCheckingAccess(false);
      }
    };

    checkUserAndLoad();
  }, [router]);

  const loadData = async (userId?: string) => {
    setLoadingOffers(true);

    try {
      let currentUserId = userId;

      if (!currentUserId) {
        const { data: authData } = await supabase.auth.getUser();
        currentUserId = authData.user?.id;

        if (!currentUserId) {
          setItems([]);
          return;
        }
      }

      const requestRows = await getOwnRepairRequests(currentUserId);

      const activeRequests = requestRows.filter((request) => {
        const status = request.status || "open";
        return status !== "completed";
      });

      const requestIds = activeRequests.map((request) => request.id);

      if (requestIds.length === 0) {
        setItems([]);
        return;
      }

      const { data: offerRows, error } = await supabase
        .from("repair_offers")
        .select("*")
        .in("request_id", requestIds)
        .eq("status", "pending")
        .order("created_at", { ascending: false });

      if (error) {
        console.error("Failed to load offers:", error);
        setItems([]);
        return;
      }

      const unreadOfferIds = (offerRows || [])
        .filter((offer) => !offer.customer_read_at)
        .map((offer) => offer.id);

      if (unreadOfferIds.length > 0) {
        await supabase
          .from("repair_offers")
          .update({ customer_read_at: new Date().toISOString() })
          .in("id", unreadOfferIds);

        window.dispatchEvent(new Event("offers-read-updated"));
      }

      const workshopUserIds = Array.from(
        new Set(
          (offerRows || [])
            .map((offer) => offer.workshop_user_id)
            .filter(Boolean),
        ),
      );

      const ratingsMap: Record<string, WorkshopRating> = {};

      if (workshopUserIds.length > 0) {
        const { data: reviewsData } = await supabase
          .from("reviews")
          .select("workshop_user_id, rating, comment, created_at")
          .in("workshop_user_id", workshopUserIds);

        (reviewsData || []).forEach((review: any) => {
          const workshopId = review.workshop_user_id;
          const ratingValue = Number(review.rating || 0);

          if (!workshopId || ratingValue <= 0) return;

          if (!ratingsMap[workshopId]) {
            ratingsMap[workshopId] = {
              average: 0,
              count: 0,
              lastReview: "",
              completedJobs: 0,
              specialties: [],
            };
          }

          ratingsMap[workshopId].average += ratingValue;
          ratingsMap[workshopId].count += 1;

          if (!ratingsMap[workshopId].lastReview && review.comment) {
            ratingsMap[workshopId].lastReview = review.comment;
          }
        });

        Object.keys(ratingsMap).forEach((workshopId) => {
          ratingsMap[workshopId].average =
            ratingsMap[workshopId].average / ratingsMap[workshopId].count;
        });
      }

      const { data: completedRequests } = await supabase
        .from("repair_requests")
        .select("accepted_offer_id, damage_type, service_type")
        .eq("status", "completed")
        .not("accepted_offer_id", "is", null);

      const completedOfferIds = (completedRequests || [])
        .map((request) => request.accepted_offer_id)
        .filter(Boolean);

      if (completedOfferIds.length > 0) {
        const { data: completedOffers } = await supabase
          .from("repair_offers")
          .select("id, workshop_user_id")
          .in("id", completedOfferIds);

        (completedOffers || []).forEach((offer) => {
          const completedRequest = (completedRequests || []).find(
            (request) => request.accepted_offer_id === offer.id,
          );
          const workshopId = offer.workshop_user_id;
          if (!workshopId) return;

          if (!ratingsMap[workshopId]) {
            ratingsMap[workshopId] = {
              average: 0,
              count: 0,
              lastReview: "",
              completedJobs: 0,
              specialties: [],
            };
          }

          ratingsMap[workshopId].completedJobs =
            (ratingsMap[workshopId].completedJobs || 0) + 1;

          const specialty =
            completedRequest?.damage_type || completedRequest?.service_type;

          if (
            specialty &&
            !ratingsMap[workshopId].specialties?.includes(specialty)
          ) {
            ratingsMap[workshopId].specialties?.push(specialty);
          }
        });
      }

      setWorkshopRatings(ratingsMap);

      let workshopProfileMap = new Map<
        string,
        {
          workshop_slug: string | null;
          workshop_name: string | null;
          workshop_logo_url: string | null;
        }
      >();

      if (workshopUserIds.length > 0) {
        const { data: workshopProfiles } = await supabase
          .from("profiles")
          .select("id, workshop_slug, workshop_name, workshop_logo_url")
          .in("id", workshopUserIds);

        workshopProfileMap = new Map(
          (workshopProfiles || []).map((profile) => [
            profile.id,
            {
              workshop_slug: profile.workshop_slug || null,
              workshop_name: profile.workshop_name || null,
              workshop_logo_url: profile.workshop_logo_url || null,
            },
          ]),
        );
      }

      const requestMap = new Map<string, RepairRequest>();

      activeRequests.forEach((request) => {
        requestMap.set(request.id, {
          id: request.id,
          carBrand: request.car_brand,
          carModel: request.car_model,
          carYear: request.car_year,
          city: request.city,
          damageType: request.damage_type,
          description: request.description || "",
          images: Array.isArray(request.images) ? request.images : [],
          status: request.status,
          acceptedOfferId: request.accepted_offer_id,
        });
      });

      const merged: OfferWithRequest[] = [];

      (offerRows || []).forEach((offer) => {
        const matchingRequest = requestMap.get(offer.request_id);
        if (!matchingRequest) return;

        const workshopProfile = workshopProfileMap.get(offer.workshop_user_id);

        merged.push({
          offer: {
            id: offer.id,
            requestId: offer.request_id,
            workshopUserId: offer.workshop_user_id,
            workshopSlug: workshopProfile?.workshop_slug || null,
            price: String(offer.price),
            days: String(offer.days),
            message: offer.message || "",
            workshopName:
              workshopProfile?.workshop_name ||
              offer.workshop_name ||
              "Service",
            createdAt: offer.created_at,
            status: offer.status,
            workshopLogoUrl: workshopProfile?.workshop_logo_url || null,
            availableDate: offer.available_date || null,
            availableTime: offer.available_time || null,
          },
          request: matchingRequest,
        });
      });

      setItems(merged);
    } catch (error) {
      console.error("Failed to load customer offers:", error);
      setItems([]);
    } finally {
      setLoadingOffers(false);
    }
  };

  const handleAcceptOffer = async (offerId: string, requestId: string) => {
    try {
      setAcceptingOfferId(offerId);
      await acceptRepairOffer({ offerId, requestId });
      router.push("/customer/my-jobs");
    } catch (error) {
      console.error("Failed to accept offer:", error);
      alert("Nu am putut accepta oferta.");
    } finally {
      setAcceptingOfferId(null);
    }
  };

  const formatSpecialty = (value: string) => {
    const labels: Record<string, string> = {
      service: "Service",
      engine: "Motor",
      dent: "Îndreptare",
      scratch: "Zgârieturi",
      steering: "Direcție",
      electrical: "Electrică",
      detailing_exterior: "Detailing exterior",
      bodywork: "Caroserie",
      mechanical: "Mecanică",
    };

    return labels[value] || value;
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
    <main className="min-h-screen bg-black px-4 py-6 text-white md:px-6 md:py-10">
      <div className="mx-auto max-w-5xl space-y-4">
        {loadingOffers ? (
          <div className="rounded-[28px] border border-white/10 bg-white/[0.04] p-10 text-center text-white/60">
            Se încarcă ofertele...
          </div>
        ) : items.length === 0 ? (
          <div className="rounded-[28px] border border-white/10 bg-white/[0.04] p-10 text-center">
            <h2 className="text-2xl font-bold">Nu ai oferte în așteptare</h2>
            <p className="mt-3 text-white/60">
              Ofertele acceptate apar în Programări.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {items.map(({ offer, request }) => {
              const status = offer.status || "pending";
              const image =
                request.images[0]?.url || request.images[0]?.dataUrl || "";
              const workshopRating = workshopRatings[offer.workshopUserId];

              return (
                <div
                  key={offer.id}
                  className="rounded-[28px] bg-white p-5 text-black shadow-lg"
                >
                  <div className="flex gap-4">
                    <button
                      type="button"
                      onClick={() => {
                        if (request.images.length > 0) {
                          setSelectedGallery({
                            images: request.images,
                            index: 0,
                          });
                        }
                      }}
                      className="h-24 w-24 shrink-0 overflow-hidden rounded-2xl bg-gray-100"
                    >
                      {image ? (
                        <img
                          src={image}
                          alt={`${request.carBrand} ${request.carModel}`}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-2xl">
                          🚗
                        </div>
                      )}
                    </button>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <h2 className="truncate text-xl font-black leading-tight">
                            {request.carBrand} {request.carModel}
                          </h2>

                          <p className="mt-1 text-sm text-black/50">
                            {request.carYear} • {request.city}
                          </p>
                        </div>

                        <span className="shrink-0 rounded-full bg-orange-100 px-3 py-1 text-xs font-semibold text-orange-700">
                          În așteptare
                        </span>
                      </div>

                      <div className="mt-4 rounded-2xl bg-gray-100 p-4">
                        <p className="text-xs text-black/40">Oferta primită</p>

                        <div className="mt-1 flex items-center justify-between">
                          <span className="text-sm text-black/60">
                            {offer.days}
                          </span>

                          <span className="text-xl font-black">
                            €{offer.price}
                          </span>
                        </div>

                        {(offer.availableDate || offer.availableTime) && (
                          <div className="mt-3 rounded-xl bg-white px-3 py-2 text-sm text-black/70">
                            {offer.availableDate && (
                              <div>
                                <span className="font-semibold text-black">
                                  Prima dată disponibilă:
                                </span>{" "}
                                {offer.availableDate}
                              </div>
                            )}

                            {offer.availableTime && (
                              <div className="mt-1">
                                <span className="font-semibold text-black">
                                  Ora predării:
                                </span>{" "}
                                {offer.availableTime.slice(0, 5)}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  <div
                    onClick={() =>
                      offer.workshopSlug &&
                      router.push(`/workshops/profile/${offer.workshopSlug}`)
                    }
                    role={offer.workshopSlug ? "button" : undefined}
                    tabIndex={offer.workshopSlug ? 0 : undefined}
                    onKeyDown={(event) => {
                      if (
                        offer.workshopSlug &&
                        (event.key === "Enter" || event.key === " ")
                      ) {
                        router.push(`/workshops/profile/${offer.workshopSlug}`);
                      }
                    }}
                    className={`mt-4 w-full rounded-2xl bg-gray-100 p-4 text-left transition ${
                      offer.workshopSlug
                        ? "cursor-pointer hover:bg-gray-200 active:scale-[0.99]"
                        : ""
                    }`}
                  >
                    <p className="text-xs text-black/40">Service</p>

                    <div className="mt-3 flex items-start gap-4">
                      <div className="h-14 w-14 shrink-0 overflow-hidden rounded-2xl bg-white shadow-sm sm:h-16 sm:w-16">
                        {offer.workshopLogoUrl ? (
                          <img
                            src={offer.workshopLogoUrl}
                            alt={offer.workshopName}
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-sm font-black">
                            AR
                          </div>
                        )}
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex items-center">
                          <p className="max-w-full truncate text-left text-lg font-black text-black underline decoration-orange-300 underline-offset-4">
                            {offer.workshopName}
                          </p>

                          {workshopRating &&
                            workshopRating.average >= 4.8 &&
                            workshopRating.count >= 2 && (
                              <span className="ml-auto bg-orange-100 px-1.5 py-0.5 text-[9px] font-bold text-orange-700">
                                ⭐ {workshopRating.average.toFixed(1)} Rating
                              </span>
                            )}
                        </div>

                        {workshopRating && workshopRating.count > 0 && (
                          <div className="mt-1 flex items-center gap-1 text-xs font-bold">
                            <span className="text-orange-500">★★★★★</span>
                            <span className="text-black/60">
                              {workshopRating.average.toFixed(1)} (
                              {workshopRating.count} review-uri)
                            </span>
                          </div>
                        )}

                        {(workshopRating?.completedJobs || 0) > 0 && (
                          <div className="mt-1 text-xs font-medium text-green-700">
                            ✓ {workshopRating.completedJobs} lucrări finalizate
                          </div>
                        )}

                        {(workshopRating?.specialties?.length || 0) > 0 && (
                          <div className="mt-1 text-xs font-medium text-black/80">
                            <div>Experiență verificată:</div>

                            <div className="mt-0.5">
                              {workshopRating.specialties
                                ?.slice(0, 3)
                                .map(formatSpecialty)
                                .join(" • ")}
                            </div>
                          </div>
                        )}

                        {workshopRating?.lastReview && (
                          <div className="mt-2 rounded-lg bg-white/60 border border-black/5 p-2">
                            <div className="text-[11px] font-semibold text-black/60">
                              💬 Ultimul client
                            </div>

                            <p className="mt-1 text-sm italic text-black/80">
                              “{workshopRating.lastReview}”
                            </p>
                          </div>
                        )}

                        {offer.workshopSlug &&
                          workshopRating &&
                          workshopRating.count > 0 && (
                            <span className="mt-2 block text-sm font-bold text-black underline underline-offset-4">
                              Vezi profilul și review-urile →
                            </span>
                          )}
                      </div>
                    </div>
                  </div>

                  {offer.message && (
                    <p className="mt-3 line-clamp-2 text-sm text-black/60">
                      {offer.message}
                    </p>
                  )}

                  <button
                    onClick={() => handleAcceptOffer(offer.id, request.id)}
                    disabled={acceptingOfferId === offer.id}
                    className="mt-4 w-full rounded-2xl bg-black px-6 py-4 text-base font-bold text-white transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-70"
                  >
                    {acceptingOfferId === offer.id
                      ? "Se confirmă..."
                      : "Acceptă oferta"}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <Lightbox
        open={!!selectedGallery}
        close={() => setSelectedGallery(null)}
        slides={
          selectedGallery?.images.map((img) => ({
            src: img.url || img.dataUrl || "",
          })) || []
        }
        index={selectedGallery?.index || 0}
        plugins={[Zoom]}
        controller={{
          closeOnBackdropClick: true,
          closeOnPullDown: true,
        }}
        animation={{
          fade: 220,
          swipe: 260,
          zoom: 260,
        }}
        zoom={{
          maxZoomPixelRatio: 4,
          scrollToZoom: true,
          doubleTapDelay: 250,
          doubleClickDelay: 250,
        }}
        carousel={{
          finite: true,
          padding: "16px",
          spacing: "16px",
        }}
        styles={{
          button: { display: "none" },
        }}
      />
    </main>
  );
}
