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
    title: string;
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
      <main className="min-h-screen bg-black flex items-center justify-center text-white">
        Checking access...
      </main>
    );
  }

  if (!authorized) return null;

  return (
    <main className="min-h-screen bg-black px-6 py-10 text-white">
      <div className="mx-auto max-w-6xl space-y-6">

        {items.map(({ offer, request }) => (
          <div key={offer.id} className="rounded-2xl border border-white/10 bg-white/5 overflow-hidden">

            <img
              src={request.images[0]?.url || request.images[0]?.dataUrl || ""}
              className="w-full h-56 object-cover"
            />

            <div className="p-6 space-y-4">

              <div className="flex justify-between items-start">
                <div>
                  <h2 className="text-2xl font-bold">
                    {request.carBrand} {request.carModel}
                  </h2>
                  <p className="text-white/60">
                    {request.carYear} • {request.city}
                  </p>
                </div>

                <span className="text-sm">
                  {formatOfferStatus(offer.status || "pending")}
                </span>
              </div>

              <div className="text-3xl font-bold">€{offer.price}</div>

              <button
                onClick={() => handleAcceptOffer(offer.id, request.id)}
                disabled={
                  acceptingOfferId === offer.id ||
                  offer.status === "accepted" ||
                  request.status === "matched"
                }
                className="w-full rounded-lg bg-white py-3 text-black font-semibold disabled:opacity-50"
              >
                {acceptingOfferId === offer.id
                  ? "Se acceptă..."
                  : offer.status === "accepted"
                  ? "Lucrare confirmată"
                  : request.status === "matched"
                  ? "Job deja ales"
                  : "Acceptă oferta"}
              </button>

            </div>
          </div>
        ))}

      </div>

      <Lightbox
        open={!!selectedGallery}
        close={() => setSelectedGallery(null)}
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