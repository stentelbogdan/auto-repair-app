"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";

import Lightbox from "yet-another-react-lightbox";
import Zoom from "yet-another-react-lightbox/plugins/zoom";
import "yet-another-react-lightbox/styles.css";

type ProfileRow = {
  role: string[] | null;
};

type RepairImage = {
  name?: string;
  url?: string;
  dataUrl?: string;
};

type RepairRequest = {
  id: string;
  car_brand: string | null;
  car_model: string | null;
  car_year: string | null;
  city: string | null;
  damage_type: string | null;
  description: string | null;
  status?: string | null;
  accepted_offer_id?: string | null;
  images?: RepairImage[];
};

type RepairOffer = {
  id: string;
  request_id: string;
  workshop_user_id: string;
  workshop_name: string;
  price: number | string;
  days: number | string;
  message: string | null;
  status?: string | null;
  created_at: string;
  repair_requests?: RepairRequest | null;
};

type DerivedOffer = RepairOffer & {
  derivedStatus: "pending" | "won" | "lost";
};

export default function WorkshopMyOffersPage() {
  const router = useRouter();

  const [authorized, setAuthorized] = useState(false);
  const [checkingAccess, setCheckingAccess] = useState(true);
  const [offers, setOffers] = useState<RepairOffer[]>([]);
  const [loading, setLoading] = useState(true);

  const [selectedImages, setSelectedImages] = useState<string[]>([]);
  const [lightboxIndex, setLightboxIndex] = useState(0);

  useEffect(() => {
    localStorage.setItem("activeRole", "workshop");
    let isMounted = true;

    async function loadPage() {
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

        if (!roles.includes("workshop")) {
          router.push("/");
          return;
        }

        if (!isMounted) return;
        setAuthorized(true);

        const { data, error } = await supabase
          .from("repair_offers")
          .select(
            `
            id,
            request_id,
            workshop_user_id,
            workshop_name,
            price,
            days,
            message,
            status,
            created_at,
            repair_requests (
              id,
              car_brand,
              car_model,
              car_year,
              city,
              damage_type,
              description,
              status,
              accepted_offer_id,
              images
            )
          `,
          )
          .eq("workshop_user_id", authData.user.id)
          .order("created_at", { ascending: false });

        if (error) throw error;

        if (!isMounted) return;

        const mapped: RepairOffer[] = (data ?? []).map((row: any) => ({
          id: String(row.id),
          request_id: String(row.request_id),
          workshop_user_id: String(row.workshop_user_id),
          workshop_name: row.workshop_name || "",
          price: row.price ?? "",
          days: row.days ?? "",
          message: row.message || "",
          status: row.status || "pending",
          created_at: String(row.created_at),
          repair_requests: row.repair_requests
            ? {
                id: String(row.repair_requests.id),
                car_brand: row.repair_requests.car_brand ?? null,
                car_model: row.repair_requests.car_model ?? null,
                car_year: row.repair_requests.car_year ?? null,
                city: row.repair_requests.city ?? null,
                damage_type: row.repair_requests.damage_type ?? null,
                description: row.repair_requests.description ?? null,
                status: row.repair_requests.status ?? null,
                accepted_offer_id:
                  row.repair_requests.accepted_offer_id ?? null,
                images: Array.isArray(row.repair_requests.images)
                  ? row.repair_requests.images
                  : [],
              }
            : null,
        }));

        setOffers(mapped);
      } catch (error) {
        console.error("Failed to load workshop offers:", error);
        setOffers([]);
      } finally {
        if (isMounted) {
          setLoading(false);
          setCheckingAccess(false);
        }
      }
    }

    loadPage();

    return () => {
      isMounted = false;
    };
  }, [router]);

  const normalizedOffers = useMemo<DerivedOffer[]>(() => {
  return offers
    .map((offer) => ({ ...offer, derivedStatus: "pending" as const }))
    .filter((offer) => (offer.status || "pending") === "pending")
    .sort(
      (a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    );
}, [offers]);

  const openGallery = (images: RepairImage[] | undefined, index = 0) => {
    const slides =
      images
        ?.map((image) => image.url || image.dataUrl || "")
        .filter(Boolean) || [];

    if (!slides.length) return;

    setSelectedImages(slides);
    setLightboxIndex(index);
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
      <div className="mx-auto max-w-6xl">
        <div className="mb-8">
          <p className="text-sm uppercase tracking-[0.24em] text-orange-400">
            Service auto
          </p>
          <h1 className="mt-2 text-4xl font-black">
            Oferte trimise
          </h1>
          <p className="mt-3 max-w-2xl text-white/60">
            Urmărește ofertele trimise și vezi rapid ce lucrări ai câștigat.
          </p>
        </div>

        {loading ? (
          <div className="rounded-[28px] border border-white/10 bg-white/[0.04] p-10 text-center text-white/60">
            Se încarcă ofertele...
          </div>
        ) : normalizedOffers.length === 0 ? (
          <div className="rounded-[28px] border border-white/10 bg-white/[0.04] p-10 text-center">
            <h2 className="text-2xl font-bold">Nu ai trimis oferte încă</h2>
            <p className="mt-3 text-white/60">
              Intră la daune disponibile și trimite prima ofertă.
            </p>

            <button
              onClick={() => router.push("/workshops")}
              className="mt-6 rounded-2xl bg-white px-6 py-4 font-bold text-black"
            >
              Vezi daune disponibile
            </button>
          </div>
        ) : (
          <div className="space-y-6">
            {normalizedOffers.map((offer) => {
              const request = offer.repair_requests;
              const image =
                request?.images?.[0]?.url ||
                request?.images?.[0]?.dataUrl ||
                "";

              const isWon = offer.derivedStatus === "won";
              const isLost = offer.derivedStatus === "lost";

              return (
                <article
                  key={offer.id}
                  className={`rounded-[28px] bg-white p-5 text-black shadow-lg transition active:scale-[0.99] ${
                    ""
                  } ${isLost ? "opacity-70" : ""}`}
                >
                  <div className="flex gap-4">
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        if (request?.images?.length) {
                          openGallery(request.images, 0);
                        }
                      }}
                      className="h-24 w-24 shrink-0 overflow-hidden rounded-2xl bg-gray-100"
                    >
                      {image ? (
                        <img
                          src={image}
                          alt={`${request?.car_brand || ""} ${request?.car_model || ""}`}
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
                            {request?.car_brand || "Mașină"}{" "}
                            {request?.car_model || ""}
                          </h2>

                          <p className="mt-1 text-sm text-black/50">
                            {request?.car_year || "-"} • {request?.city || "-"}
                          </p>
                        </div>

                        <span
                          className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${
                            isWon
                              ? "bg-green-100 text-green-700"
                              : isLost
                                ? "bg-red-100 text-red-700"
                                : "bg-orange-100 text-orange-700"
                          }`}
                        >
                          {formatStatus(offer.derivedStatus)}
                        </span>
                      </div>

                      <div className="mt-4 rounded-2xl bg-gray-100 p-4">
                        <p className="text-xs text-black/40">Oferta ta</p>

                        <div className="mt-1 flex items-center justify-between">
                          <span className="text-sm text-black/60">
                            {offer.days}
                          </span>

                          <span className="text-xl font-black">
                            €{offer.price}
                          </span>
                        </div>
                      </div>

                      {offer.message && !isLost && (
                        <p className="mt-3 line-clamp-2 text-sm text-black/60">
                          {offer.message}
                        </p>
                      )}

                      {isWon && (
                        <p className="mt-3 text-xs font-semibold text-green-700">
                          Apasă pe card pentru a deschide lucrarea →
                        </p>
                      )}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>

      <Lightbox
        open={selectedImages.length > 0}
        close={() => setSelectedImages([])}
        slides={selectedImages.map((src) => ({ src }))}
        index={lightboxIndex}
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

function InfoBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
      <p className="text-sm text-white/45">{label}</p>
      <p className="mt-1 text-xl font-bold text-white">{value}</p>
    </div>
  );
}

function formatStatus(status: "pending" | "won" | "lost") {
  if (status === "won") return "Câștigată";
  if (status === "lost") return "Respinsă";
  return "În așteptare";
}

function statusClasses(status: "pending" | "won" | "lost") {
  if (status === "won") {
    return "border-green-500/20 bg-green-500/15 text-green-300";
  }

  if (status === "lost") {
    return "border-red-500/20 bg-red-500/15 text-red-300";
  }

  return "border-yellow-500/20 bg-yellow-500/15 text-yellow-300";
}
