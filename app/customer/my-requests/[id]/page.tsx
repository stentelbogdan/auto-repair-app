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

export default function CustomerRequestDetailsPage() {
  const router = useRouter();
  const params = useParams();
  const id = params.id as string;

  const [request, setRequest] = useState<RepairRequest | null>(null);
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
    setImageIndex((prev) =>
      prev === 0 ? validImages.length - 1 : prev - 1,
    );
  };

  const goToNextImage = () => {
    if (validImages.length <= 1) return;
    setImageIndex((prev) =>
      prev === validImages.length - 1 ? 0 : prev + 1,
    );
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