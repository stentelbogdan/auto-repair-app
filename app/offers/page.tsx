"use client";

import { formatOfferStatus } from "@/lib/utils/status";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import {
  acceptRepairOffer,
  getOffersForCustomerRequests,
  type RepairOfferRow,
} from "@/lib/supabase/repair-offers";
import {
  getOwnRepairRequests,
  type RepairRequestRow,
} from "@/lib/supabase/repair-requests";
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

      const [requestRows, offerRows] = await Promise.all([
        getOwnRepairRequests(currentUserId),
        getOffersForCustomerRequests(currentUserId),
      ]);

      const requestMap = new Map<string, RepairRequest>();

      requestRows.forEach((request: RepairRequestRow) => {
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

      offerRows.forEach((offer: RepairOfferRow) => {
        const matchingRequest = requestMap.get(offer.request_id);
        if (!matchingRequest) return;

        merged.push({
          offer: {
            id: offer.id,
            requestId: offer.request_id,
            price: offer.price,
            days: offer.days,
            message: offer.message || "",
            workshopName: offer.workshop_name,
            createdAt: offer.created_at,
            status: offer.status,
          },
          request: matchingRequest,
        });
      });

      setItems(merged);
    } catch {
      setItems([]);
    } finally {
      setLoadingOffers(false);
    }
  };

  const handleAcceptOffer = async (offerId: string, requestId: string) => {
    try {
      setAcceptingOfferId(offerId);
      await acceptRepairOffer({ offerId, requestId });
      await loadData();
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
    <main className="min-h-screen bg-black px-6 py-10 text-white">
      <div className="mx-auto max-w-6xl space-y-6">
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
          items.map(({ offer, request }) => {
            const status = offer.status || "pending";
            const isAccepted = status === "accepted";
            const isRejected = status === "rejected";
            const isMatched = request.status === "matched";

            return (
              <div
                key={offer.id}
                className={`overflow-hidden rounded-[28px] border bg-white/[0.04] ${
                  isAccepted
                    ? "border-green-500/30 shadow-[0_0_40px_rgba(34,197,94,0.12)]"
                    : "border-white/10"
                }`}
              >
                {request.images[0]?.url || request.images[0]?.dataUrl ? (
                  <button
                    type="button"
                    onClick={() =>
                      setSelectedGallery({
                        images: request.images,
                        index: 0,
                      })
                    }
                    className="block w-full"
                  >
                    <img
                      src={request.images[0].url || request.images[0].dataUrl}
                      alt={`${request.carBrand} ${request.carModel}`}
                      className="h-72 w-full object-cover"
                    />
                  </button>
                ) : (
                  <div className="flex h-56 items-center justify-center bg-white/5 text-white/40">
                    Fără poză
                  </div>
                )}

                <div className="space-y-5 p-6">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h2 className="text-3xl font-black leading-tight">
                        {request.carBrand} {request.carModel}
                      </h2>
                      <p className="mt-2 text-lg text-white/50">
                        {request.carYear} • {request.city}
                      </p>
                    </div>

                    <span
                      className={`shrink-0 rounded-full border px-3 py-1 text-xs font-semibold ${getOfferStatusClass(
                        status,
                      )}`}
                    >
                      {formatOfferStatus(status)}
                    </span>
                  </div>

                  {isAccepted && (
                    <div className="rounded-2xl border border-green-500/20 bg-green-500/10 px-4 py-3 text-sm font-semibold text-green-300">
                      Oferta aleasă
                    </div>
                  )}

                  <div>
                    <p className="text-sm text-white/45">Preț ofertă</p>
                    <p className="mt-1 text-5xl font-black tracking-tight">
                      €{offer.price}
                    </p>
                  </div>

                  <div className="grid gap-3">
                    <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
                      <p className="text-sm text-white/45">Service</p>
                      <p className="mt-1 text-xl font-bold">
                        {offer.workshopName}
                      </p>
                    </div>

                    <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
                      <p className="text-sm text-white/45">Durată estimată</p>
                      <p className="mt-1 text-xl font-bold">
                        {offer.days} zile
                      </p>
                    </div>

                    {offer.message && (
                      <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
                        <p className="text-sm text-white/45">Mesaj service</p>
                        <p className="mt-2 text-white/80">{offer.message}</p>
                      </div>
                    )}
                  </div>

                  {!isRejected && !isAccepted && !isMatched && (
                    <button
                      onClick={() => handleAcceptOffer(offer.id, request.id)}
                      disabled={acceptingOfferId === offer.id}
                      className="w-full rounded-2xl bg-white px-6 py-4 text-base font-bold text-black transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-70"
                    >
                      {acceptingOfferId === offer.id
                        ? "Se confirmă..."
                        : "Acceptă oferta"}
                    </button>
                  )}
                  
                </div>
              </div>
            );
          })
        )}
      </div>

      <Lightbox
        open={!!selectedGallery}
        close={() => setSelectedGallery(null)}
        index={selectedGallery?.index || 0}
        slides={
          selectedGallery?.images.map((img) => ({
            src: img.url || img.dataUrl || "",
          })) || []
        }
        plugins={[Zoom]}
      />
    </main>
  );
}

function getOfferStatusClass(value: string) {
  switch (value) {
    case "accepted":
      return "border-green-500/20 bg-green-500/15 text-green-300";
    case "rejected":
      return "border-red-500/20 bg-red-500/15 text-red-300";
    default:
      return "border-yellow-500/20 bg-yellow-500/15 text-yellow-300";
  }
}
