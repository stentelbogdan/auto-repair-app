"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import Lightbox from "yet-another-react-lightbox";
import Zoom from "yet-another-react-lightbox/plugins/zoom";
import "yet-another-react-lightbox/styles.css";

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
  status: string | null;
  accepted_offer_id: string | null;
  images: RepairImage[] | null;
};

type AcceptedOffer = {
  id: string;
  request_id: string;
  workshop_user_id: string | null;
  workshop_name: string | null;
  price: number | string | null;
  days: number | string | null;
  message: string | null;
  status: string | null;
};

export default function CustomerRequestDetailsPage() {
  const router = useRouter();
  const params = useParams();
  const id = params.id as string;

  const [request, setRequest] = useState<RepairRequest | null>(null);
  const [acceptedOffer, setAcceptedOffer] = useState<AcceptedOffer | null>(
    null,
  );
  const [workshopProfile, setWorkshopProfile] = useState<{
    workshop_name: string | null;
    workshop_slug: string | null;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [imageIndex, setImageIndex] = useState(0);
  const [touchStartX, setTouchStartX] = useState<number | null>(null);
  const [lightboxOpen, setLightboxOpen] = useState(false);

  useEffect(() => {
    const loadRequest = async () => {
      try {
        const { data: authData } = await supabase.auth.getUser();

        if (!authData.user) {
          router.push("/login");
          return;
        }

        const { data, error } = await supabase
          .from("repair_requests")
          .select("*")
          .eq("id", id)
          .single<RepairRequest>();

        if (error) throw error;

        setRequest(data);

        if (data.accepted_offer_id) {
          const { data: offerData, error: offerError } = await supabase
            .from("repair_offers")
            .select(
              "id, request_id, workshop_user_id, workshop_name, price, days, message, status",
            )
            .eq("id", data.accepted_offer_id)
            .single<AcceptedOffer>();

          if (!offerError && offerData) {
            setAcceptedOffer(offerData);
            if (offerData.workshop_user_id) {
              const { data: profileData } = await supabase
                .from("profiles")
                .select("workshop_name, workshop_slug")
                .eq("id", offerData.workshop_user_id)
                .single();

              setWorkshopProfile({
                workshop_name: profileData?.workshop_name || null,
                workshop_slug: profileData?.workshop_slug || null,
              });
            }
          }
        } else {
          const { data: offerData, error: offerError } = await supabase
            .from("repair_offers")
            .select(
              "id, request_id, workshop_user_id, workshop_name, price, days, message, status",
            )
            .eq("request_id", id)
            .eq("status", "accepted")
            .maybeSingle<AcceptedOffer>();

          if (!offerError && offerData) {
            setAcceptedOffer(offerData);
            if (offerData.workshop_user_id) {
              const { data: profileData } = await supabase
                .from("profiles")
                .select("workshop_name, workshop_slug")
                .eq("id", offerData.workshop_user_id)
                .single();

              setWorkshopProfile({
                workshop_name: profileData?.workshop_name || null,
                workshop_slug: profileData?.workshop_slug || null,
              });
            }
          }
        }
      } catch (error) {
        console.error("Failed to load request:", error);
        alert("Nu am putut încărca dauna.");
        router.push("/customer/my-requests");
      } finally {
        setLoading(false);
      }
    };

    loadRequest();
  }, [id, router]);

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-black text-white">
        Se încarcă...
      </main>
    );
  }

  if (!request) return null;

  const images = Array.isArray(request.images) ? request.images : [];
  const validImages = images
    .map((image) => image.url || image.dataUrl || "")
    .filter(Boolean);

  const currentImage = validImages[imageIndex] || "";

  const goToPrevImage = () => {
    if (validImages.length <= 1) return;
    setImageIndex((prev) => (prev === 0 ? validImages.length - 1 : prev - 1));
  };

  const goToNextImage = () => {
    if (validImages.length <= 1) return;
    setImageIndex((prev) => (prev === validImages.length - 1 ? 0 : prev + 1));
  };

  return (
    <main className="min-h-screen bg-[#111111] px-4 py-5 text-white">
      <div className="mx-auto max-w-3xl">
        <button
          onClick={() => router.back()}
          className="mb-5 rounded-full border border-white/15 px-4 py-2 text-sm font-semibold text-white"
        >
          Înapoi
        </button>

        <div className="overflow-hidden rounded-[30px] bg-white text-black shadow-xl">
          {currentImage ? (
            <div
              className="relative h-80 w-full overflow-hidden bg-black"
              onTouchStart={(e) => {
                setTouchStartX(e.touches[0].clientX);
              }}
              onTouchEnd={(e) => {
                if (touchStartX === null) return;

                const touchEndX = e.changedTouches[0].clientX;
                const diff = touchStartX - touchEndX;

                if (Math.abs(diff) > 40) {
                  if (diff > 0) {
                    goToNextImage();
                  } else {
                    goToPrevImage();
                  }
                }

                setTouchStartX(null);
              }}
            >
              <img
                key={currentImage}
                src={currentImage}
                alt={`${request.car_brand} ${request.car_model}`}
                onClick={() => setLightboxOpen(true)}
                className="h-full w-full cursor-zoom-in object-cover transition-all duration-500 ease-out"
              />

              <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/35 via-transparent to-transparent" />

              {validImages.length > 1 && (
                <>
                  <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 gap-2">
                    {validImages.map((_, index) => (
                      <button
                        key={index}
                        type="button"
                        onClick={() => setImageIndex(index)}
                        className={`h-2.5 w-2.5 rounded-full transition ${
                          index === imageIndex ? "bg-white" : "bg-white/40"
                        }`}
                      />
                    ))}
                  </div>

                  <div className="absolute right-4 top-4 rounded-full bg-black/55 px-3 py-1.5 text-xs font-semibold text-white backdrop-blur">
                    {imageIndex + 1}/{validImages.length}
                  </div>
                </>
              )}
            </div>
          ) : (
            <div className="flex h-72 items-center justify-center bg-black/10 text-black/40">
              Fără poză
            </div>
          )}

          <div className="space-y-5 p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h1 className="text-4xl font-black leading-tight">
                  {request.car_brand} {request.car_model}
                </h1>
                <p className="mt-2 text-lg text-black/55">
                  {request.car_year} • {request.city}
                </p>
              </div>

              <span
                className={`shrink-0 rounded-full px-3 py-1 text-xs font-bold ${getStatusClass(
                  request.status,
                )}`}
              >
                {formatStatus(request.status)}
              </span>
            </div>

            <StatusTimeline status={request.status} />

            {acceptedOffer && (
              <ServiceCard
                offer={acceptedOffer}
                workshopProfile={workshopProfile}
                onOpenProfile={() => {
                  if (!workshopProfile?.workshop_slug) return;
                  router.push(
                    `/workshops/profile/${workshopProfile.workshop_slug}`,
                  );
                }}
              />
            )}

            <div className="grid gap-4">
              <div className="rounded-3xl bg-black/[0.04] p-5">
                <p className="text-sm text-black/45">Tip daună</p>
                <p className="mt-1 text-xl font-bold">
                  {formatDamageType(request.damage_type)}
                </p>
              </div>

              <div className="rounded-3xl bg-black/[0.04] p-5">
                <p className="text-sm text-black/45">Descriere</p>
                <p className="mt-2 text-lg leading-7 text-black/70">
                  {request.description || "Fără descriere."}
                </p>
              </div>
            </div>

            {request.status !== "open" && (
              <button
                onClick={() => router.push(`/chat/${request.id}`)}
                className="w-full rounded-2xl bg-black px-5 py-4 text-lg font-bold text-white"
              >
                Chat cu service-ul
              </button>
            )}
          </div>
        </div>
      </div>

      <Lightbox
        open={lightboxOpen}
        close={() => setLightboxOpen(false)}
        index={imageIndex}
        slides={validImages.map((src) => ({ src }))}
        plugins={[Zoom]}
        controller={{
          closeOnBackdropClick: true,
          closeOnPullDown: true,
        }}
        animation={{
          fade: 180,
          swipe: 320,
          zoom: 260,
        }}
        carousel={{
          finite: true,
          padding: "0px",
          spacing: "12px",
        }}
        zoom={{
          maxZoomPixelRatio: 4,
          scrollToZoom: true,
          doubleTapDelay: 220,
          doubleClickDelay: 220,
          doubleClickMaxStops: 2,
        }}
        render={{
          buttonPrev: () => null,
          buttonNext: () => null,
          buttonClose: () => null,
          buttonZoom: () => null,
        }}
        styles={{
          container: {
            backgroundColor: "rgba(0,0,0,0.98)",
          },
          slide: {
            padding: "0px",
          },
        }}
      />
    </main>
  );
}

function ServiceCard({
  offer,
  workshopProfile,
  onOpenProfile,
}: {
  offer: AcceptedOffer;
  workshopProfile: {
    workshop_name: string | null;
    workshop_slug: string | null;
  } | null;
  onOpenProfile: () => void;
}) {
  const publicName =
    workshopProfile?.workshop_name || offer.workshop_name || "Service";

  const canOpenProfile = Boolean(workshopProfile?.workshop_slug);

  return (
    <button
      type="button"
      onClick={canOpenProfile ? onOpenProfile : undefined}
      className={`w-full rounded-3xl bg-black p-5 text-left text-white shadow-[0_20px_60px_rgba(0,0,0,0.25)] transition ${
        canOpenProfile
          ? "cursor-pointer hover:bg-black/90 active:scale-[0.99]"
          : ""
      }`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white text-xl font-black text-black">
            {publicName.slice(0, 1).toUpperCase()}
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-white/35">
              Service ales
            </p>
            <h2 className="mt-1 text-2xl font-black">{publicName}</h2>
            <p className="mt-1 text-sm font-semibold text-green-300">
              Verificat ✓
            </p>
          </div>
        </div>

        <div className="text-right">
          <p className="text-xs uppercase tracking-[0.18em] text-white/35">
            Ofertă
          </p>
          <p className="mt-1 text-3xl font-black">€{offer.price}</p>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3">
        <div className="rounded-2xl bg-white/10 p-4">
          <p className="text-xs text-white/45">Durată estimată</p>
          <p className="mt-1 text-lg font-bold">
            {offer.days} {String(offer.days) === "1" ? "zi" : "zile"}
          </p>
        </div>

        <div className="rounded-2xl bg-white/10 p-4">
          <p className="text-xs text-white/45">Status ofertă</p>
          <p className="mt-1 text-lg font-bold">Acceptată</p>
        </div>
      </div>

      {offer.message && (
        <div className="mt-3 rounded-2xl bg-white/10 p-4">
          <p className="text-xs text-white/45">Mesaj service</p>
          <p className="mt-2 text-sm leading-6 text-white/80">
            {offer.message}
          </p>
        </div>
      )}

      {canOpenProfile && (
        <p className="mt-4 text-center text-xs font-semibold text-orange-300/90">
          Apasă pentru profilul service-ului →
        </p>
      )}
    </button>
  );
}

function StatusTimeline({ status }: { status?: string | null }) {
  const steps = [
    { key: "open", label: "Postată" },
    { key: "matched", label: "Acceptată" },
    { key: "in_progress", label: "În lucru" },
    { key: "painting", label: "Vopsire" },
    { key: "polishing", label: "Polish" },
    { key: "completed", label: "Finalizată" },
  ];
  const currentIndex = getStatusIndex(status);

  return (
    <div className="rounded-3xl bg-black/[0.04] p-5">
      <p className="mb-5 text-sm font-semibold uppercase tracking-[0.2em] text-black/35">
        Status lucrare
      </p>

      <div className="relative">
        <div className="absolute left-4 right-4 top-4 h-[2px] bg-black/10" />

        <div
          className="absolute left-4 top-4 h-[2px] bg-black transition-all duration-500"
          style={{
            width:
              currentIndex <= 0
                ? "0%"
                : currentIndex === 1
                  ? "33%"
                  : currentIndex === 2
                    ? "66%"
                    : "calc(100% - 2rem)",
          }}
        />

        <div className="relative grid grid-cols-6 gap-2">
          {steps.map((step, index) => {
            const isDone = index < currentIndex;
            const isActive = index === currentIndex;
            const isFuture = index > currentIndex;

            return (
              <div key={step.key} className="flex flex-col items-center">
                <div
                  className={`flex h-8 w-8 items-center justify-center rounded-full border text-xs font-black transition ${
                    isDone
                      ? "border-black bg-black text-white"
                      : isActive
                        ? "border-black bg-white text-black"
                        : "border-black/10 bg-white text-black/30"
                  }`}
                >
                  {isDone ? "✓" : isActive ? "●" : ""}
                </div>

                <p
                  className={`mt-2 text-center text-[11px] font-bold leading-tight ${
                    isFuture ? "text-black/30" : "text-black"
                  }`}
                >
                  {step.label}
                </p>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function getStatusIndex(status?: string | null) {
  switch (status) {
    case "matched":
      return 1;
    case "in_progress":
      return 2;
    case "completed":
      return 3;
    default:
      return 0;
  }
}

function formatStatus(status?: string | null) {
  switch (status) {
    case "matched":
      return "Programată";
    case "in_progress":
      return "În lucru";
    case "completed":
      return "Finalizată";
    default:
      return "Deschisă";
  }
}

function getStatusClass(status?: string | null) {
  switch (status) {
    case "in_progress":
      return "bg-blue-100 text-blue-700";
    case "completed":
      return "bg-green-100 text-green-700";
    case "matched":
      return "bg-orange-100 text-orange-700";
    default:
      return "bg-orange-100 text-orange-700";
  }
}

function formatDamageType(value?: string | null) {
  switch (value) {
    case "scratch":
      return "Zgârietură";
    case "dent":
      return "Îndoitură";
    case "bumper":
      return "Bară avariată";
    case "paint":
      return "Vopsea afectată";
    case "cracked_part":
      return "Piesă crăpată";
    default:
      return "Altele";
  }
}
