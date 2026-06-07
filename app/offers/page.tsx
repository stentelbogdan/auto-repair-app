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
        .order("created_at", { ascending: false });

      if (error) {
        console.error("Failed to load offers:", error);
        setItems([]);
        return;
      }

      const workshopUserIds = Array.from(
        new Set(
          (offerRows || [])
            .map((offer) => offer.workshop_user_id)
            .filter(Boolean),
        ),
      );

      let workshopProfileMap = new Map<
        string,
        { workshop_slug: string | null; workshop_name: string | null }
      >();

      if (workshopUserIds.length > 0) {
        const { data: workshopProfiles } = await supabase
          .from("profiles")
          .select("id, workshop_slug, workshop_name")
          .in("id", workshopUserIds);

        workshopProfileMap = new Map(
          (workshopProfiles || []).map((profile) => [
            profile.id,
            {
              workshop_slug: profile.workshop_slug || null,
              workshop_name: profile.workshop_name || null,
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
            <h2 className="text-2xl font-bold">Nu ai oferte încă</h2>
            <p className="mt-3 text-white/60">
              Când un service trimite o ofertă, aceasta va apărea aici.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {items.map(({ offer, request }) => {
              const status = offer.status || "pending";
              const isAccepted = status === "accepted";
              const isRejected = status === "rejected";
              const isMatched = request.status === "matched";
              const image =
                request.images[0]?.url || request.images[0]?.dataUrl || "";

              return (
                <div
                  key={offer.id}
                  className={`rounded-[28px] bg-white p-5 text-black shadow-lg ${
                    isAccepted ? "ring-2 ring-green-500/25" : ""
                  } ${isRejected ? "opacity-70" : ""}`}
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

                        <span
                          className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${
                            isAccepted
                              ? "bg-green-100 text-green-700"
                              : isRejected
                                ? "bg-red-100 text-red-700"
                                : "bg-orange-100 text-orange-700"
                          }`}
                        >
                          {formatOfferStatus(status)}
                        </span>
                      </div>

                      <div className="mt-4 rounded-2xl bg-gray-100 p-4">
                        <p className="text-xs text-black/40">Oferta primită</p>

                        <div className="mt-1 flex items-center justify-between">
                          <span className="text-sm text-black/60">
                            {offer.days} zile
                          </span>

                          <span className="text-xl font-black">
                            €{offer.price}
                          </span>
                        </div>
                      </div>

                      <div className="mt-3 rounded-2xl bg-gray-100 p-4">
                        <p className="text-xs text-black/40">Service</p>

                        {offer.workshopSlug ? (
                          <button
                            type="button"
                            onClick={() =>
                              router.push(
                                `/workshops/profile/${offer.workshopSlug}`,
                              )
                            }
                            className="mt-1 text-left text-base font-bold text-black underline decoration-orange-400/50 underline-offset-4"
                          >
                            {offer.workshopName}
                          </button>
                        ) : (
                          <p className="mt-1 text-base font-bold">
                            {offer.workshopName}
                          </p>
                        )}
                      </div>

                      {offer.message && (
                        <p className="mt-3 line-clamp-2 text-sm text-black/60">
                          {offer.message}
                        </p>
                      )}

                      {!isRejected && !isAccepted && !isMatched && (
                        <button
                          onClick={() =>
                            handleAcceptOffer(offer.id, request.id)
                          }
                          disabled={acceptingOfferId === offer.id}
                          className="mt-4 w-full rounded-2xl bg-black px-6 py-4 text-base font-bold text-white transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-70"
                        >
                          {acceptingOfferId === offer.id
                            ? "Se confirmă..."
                            : "Acceptă oferta"}
                        </button>
                      )}

                      {isAccepted && (
                        <div className="mt-4 rounded-2xl bg-green-100 px-4 py-3 text-sm font-semibold text-green-700">
                          Oferta aleasă
                        </div>
                      )}
                    </div>
                  </div>
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
