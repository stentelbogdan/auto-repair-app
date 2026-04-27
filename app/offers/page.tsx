"use client";

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

        if (!roles.includes("customer")) {
          router.push("/workshops/dashboard");
          return;
        }

        setAuthorized(true);
        await loadData(authData.user.id);
      } catch (error) {
        console.error("Access check failed:", error);
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

        if (!matchingRequest) {
          return;
        }

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
    } catch (error) {
      console.error("Failed to load offers:", error);
      setItems([]);
    } finally {
      setLoadingOffers(false);
    }
  };

  const handleAcceptOffer = async (offerId: string, requestId: string) => {
    try {
      setAcceptingOfferId(offerId);

      await acceptRepairOffer({
        offerId,
        requestId,
      });

      await loadData();
    } catch (error: any) {
      console.error("Failed to accept offer:", error);
      alert(error?.message || "Failed to accept offer.");
    } finally {
      setAcceptingOfferId(null);
    }
  };

  if (checkingAccess) {
    return (
      <main className="min-h-screen bg-black px-6 py-10 text-white">
        <div className="mx-auto flex min-h-[60vh] max-w-6xl items-center justify-center">
          <p className="text-white/70">Checking access...</p>
        </div>
      </main>
    );
  }

  if (!authorized) {
    return null;
  }

  return (
    <main className="min-h-screen bg-black px-6 py-10 text-white">
      <div className="mx-auto max-w-6xl">
        <div className="mb-8 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-sm uppercase tracking-[0.2em] text-white/40">
              Customer offers
            </p>
            <h1 className="mt-2 text-3xl font-bold md:text-4xl">Your offers</h1>
            <p className="mt-3 max-w-2xl text-white/70">
              Compare prices from workshops and choose the best deal.
            </p>
          </div>

          <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white/70">
            {items.length} offer{items.length !== 1 ? "s" : ""}
          </div>
        </div>

        {loadingOffers ? (
          <div className="rounded-2xl border border-white/10 bg-white/5 p-10 text-center">
            <p className="text-white/70">Loading offers...</p>
          </div>
        ) : items.length === 0 ? (
          <div className="rounded-2xl border border-white/10 bg-white/5 p-10 text-center">
            <h2 className="text-2xl font-semibold">No offers yet</h2>
            <p className="mt-3 text-white/70">
              When workshops submit offers, they will appear here.
            </p>

            <div className="mt-6 flex flex-col gap-3 md:flex-row md:justify-center">
              <button
                onClick={() => router.push("/")}
                className="rounded-lg bg-white px-6 py-3 font-semibold text-black"
              >
                Post a job
              </button>

              <button
                onClick={() => router.push("/workshops")}
                className="rounded-lg border border-white/20 px-6 py-3 font-semibold text-white"
              >
                Find jobs
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            {items.map(({ offer, request }) => (
              <div
                key={offer.id}
                className="overflow-hidden rounded-2xl border border-white/10 bg-white/5"
              >
                <div className="grid gap-0 md:grid-cols-[320px_1fr]">
                  <div className="bg-black/30">
                    {request.images.length > 0 ? (
                      <img
                        src={request.images[0].dataUrl}
                        alt={`${request.carBrand} ${request.carModel}`}
                        className="h-full min-h-[240px] w-full object-cover"
                      />
                    ) : (
                      <div className="flex min-h-[240px] items-center justify-center text-white/40">
                        No photo uploaded
                      </div>
                    )}
                  </div>

                  <div className="p-6">
                    <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                      <div>
                        <h2 className="text-3xl font-bold">
                          {request.carBrand} {request.carModel}
                        </h2>
                        <p className="mt-2 text-white/60">
                          {request.carYear} • {request.city} •{" "}
                          {formatDamageType(request.damageType)}
                        </p>
                      </div>

                      <div className="flex flex-col items-end gap-2">
                        <div className="rounded-xl border border-green-500/20 bg-green-500/10 px-4 py-3 text-right">
                          <p className="text-sm text-white/60">Offer price</p>
                          <p className="text-3xl font-bold">€{offer.price}</p>
                        </div>

                        <span className={getOfferStatusClass(offer.status || "pending")}>
                          {formatOfferStatus(offer.status || "pending")}
                        </span>
                      </div>
                    </div>

                    <div className="mt-6 grid gap-4 md:grid-cols-3">
                      <div className="rounded-xl border border-white/10 bg-black/30 p-4">
                        <p className="text-sm text-white/50">Workshop</p>
                        <p className="mt-1 text-lg font-semibold">
                          {offer.workshopName}
                        </p>
                      </div>

                      <div className="rounded-xl border border-white/10 bg-black/30 p-4">
                        <p className="text-sm text-white/50">Estimated days</p>
                        <p className="mt-1 text-lg font-semibold">
                          {offer.days} day{offer.days !== "1" ? "s" : ""}
                        </p>
                      </div>

                      <div className="rounded-xl border border-white/10 bg-black/30 p-4">
                        <p className="text-sm text-white/50">Request status</p>
                        <p className="mt-1 text-lg font-semibold">
                          {request.status === "matched" ? "Matched" : "Open"}
                        </p>
                      </div>
                    </div>

                    <div className="mt-4 rounded-xl border border-white/10 bg-black/30 p-4">
                      <p className="text-sm text-white/50">Customer request</p>
                      <p className="mt-1 text-white/85">
                        {request.description || "No description provided."}
                      </p>
                    </div>

                    <div className="mt-4 rounded-xl border border-white/10 bg-black/30 p-4">
                      <p className="text-sm text-white/50">Workshop message</p>
                      <p className="mt-1 text-white/85">
                        {offer.message || "No message provided."}
                      </p>
                    </div>

                    <div className="mt-6 flex flex-col gap-3 md:flex-row">
                      <button
                        onClick={() => router.push("/workshops")}
                        className="rounded-lg border border-white/20 px-6 py-3 font-semibold text-white"
                      >
                        View workshop dashboard
                      </button>

                      <button
                        onClick={() => handleAcceptOffer(offer.id, request.id)}
                        disabled={
                          acceptingOfferId === offer.id ||
                          offer.status === "accepted" ||
                          request.status === "matched"
                        }
                        className="rounded-lg bg-white px-6 py-3 font-semibold text-black disabled:opacity-50"
                      >
                        {acceptingOfferId === offer.id
                          ? "Accepting..."
                          : offer.status === "accepted"
                          ? "Accepted"
                          : request.status === "matched"
                          ? "Job booked"
                          : "Accept & book repair"}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}

function formatDamageType(value: string) {
  switch (value) {
    case "scratch":
    case "Scratch":
      return "Scratch";
    case "dent":
    case "Dent":
      return "Dent";
    case "bumper":
    case "Bumper damage":
      return "Bumper damage";
    case "paint":
    case "Paint damage":
      return "Paint damage";
    case "cracked_part":
    case "Cracked part":
      return "Cracked part";
    default:
      return "Other";
  }
}

function formatOfferStatus(value: string) {
  switch (value) {
    case "accepted":
      return "Accepted";
    case "rejected":
      return "Rejected";
    default:
      return "Pending";
  }
}

function getOfferStatusClass(value: string) {
  switch (value) {
    case "accepted":
      return "rounded-full border border-green-500/20 bg-green-500/15 px-3 py-1 text-xs font-medium text-green-300";
    case "rejected":
      return "rounded-full border border-red-500/20 bg-red-500/15 px-3 py-1 text-xs font-medium text-red-300";
    default:
      return "rounded-full border border-yellow-500/20 bg-yellow-500/15 px-3 py-1 text-xs font-medium text-yellow-300";
  }
}