"use client";

import { Suspense, useEffect, useState } from "react";
import { Home, X } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import type { RepairRequestRow } from "@/lib/supabase/repair-requests";

export default function ReviewPage() {
  return (
    <Suspense fallback={<ReviewLoading />}>
      <ReviewContent />
    </Suspense>
  );
}

function ReviewContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestId = searchParams.get("id");

  const [request, setRequest] = useState<RepairRequestRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedImageIndex, setSelectedImageIndex] = useState<number | null>(
    null
  );
  const [isZoomed, setIsZoomed] = useState(false);
  const [touchStartX, setTouchStartX] = useState<number | null>(null);

  useEffect(() => {
    if (selectedImageIndex === null) return;

    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = "";
    };
  }, [selectedImageIndex]);

  useEffect(() => {
    const loadRequest = async () => {
      if (!requestId) {
        router.push("/customer/dashboard");
        return;
      }

      const { data, error } = await supabase
        .from("repair_requests")
        .select("*")
        .eq("id", requestId)
        .single<RepairRequestRow>();

      if (error) {
        console.error("Failed to load request:", error);
        alert("Nu am putut încărca cererea.");
        router.push("/customer/dashboard");
        return;
      }

      setRequest(data);
      setLoading(false);
    };

    loadRequest();
  }, [requestId, router]);

  if (loading) return <ReviewLoading />;
  if (!request) return null;

  const images = Array.isArray(request.images) ? request.images : [];

  return (
    <main className="min-h-screen bg-[#101010] px-4 py-5 text-white">
      <div className="mx-auto max-w-4xl">
        <div className="mb-5 flex items-center justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.25em] text-orange-400">
              Verificare daună
            </p>
            <h1 className="mt-2 text-2xl font-bold">Cererea ta</h1>
            <p className="mt-2 text-sm text-white/55">
              Verifică detaliile înainte să urmărești ofertele primite.
            </p>
          </div>

          <button
            type="button"
            onClick={() => router.push("/customer/dashboard")}
            className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full border border-white/20 bg-black/40 text-white"
            aria-label="Înapoi la dashboard"
          >
            <Home size={24} />
          </button>
        </div>

        <div className="rounded-[24px] bg-white p-5 text-black shadow-xl">
          <div className="grid gap-3 md:grid-cols-2">
            <InfoCard label="Marcă" value={request.car_brand} />
            <InfoCard label="Model" value={request.car_model} />
            <InfoCard label="An fabricație" value={request.car_year} />
            <InfoCard label="Localitate" value={request.city} />
            <InfoCard
              label="Tip daună"
              value={formatDamageType(request.damage_type)}
            />
            <InfoCard label="Status" value={formatStatus(request.status)} />
          </div>

          <div className="mt-4 rounded-2xl bg-black/[0.04] p-4">
            <p className="text-sm font-medium text-black/50">Descriere</p>
            <p className="mt-1 text-sm text-black/75">
              {request.description || "Nu ai adăugat descriere."}
            </p>
          </div>

          <div className="mt-5">
            <p className="mb-3 text-sm font-semibold text-black/60">
              Poze încărcate
            </p>

            {images.length > 0 ? (
              <div className="flex snap-x gap-3 overflow-x-auto pb-2">
                {images.map((image, index) => {
                  const imageSrc = image.url || image.dataUrl || "";

                  return (
                    <button
                      key={`${image.name}-${index}`}
                      type="button"
                      onClick={() => setSelectedImageIndex(index)}
                      className="relative h-56 min-w-full snap-center overflow-hidden rounded-3xl bg-black/10 sm:min-w-[70%]"
                    >
                      <img
                        src={imageSrc}
                        alt={`Poză daună ${index + 1}`}
                        className="h-full w-full object-cover"
                      />

                      {images.length > 1 && (
                        <span className="absolute right-3 top-3 rounded-full bg-black/70 px-3 py-1 text-xs font-semibold text-white">
                          {index + 1}/{images.length}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="rounded-2xl bg-black/[0.04] p-5 text-center text-sm text-black/50">
                Nu ai încărcat poze.
              </div>
            )}
          </div>

          <div className="mt-6 flex flex-col gap-3">
            <button
              type="button"
              onClick={() => router.push("/offers")}
              className="rounded-2xl bg-black px-6 py-4 font-semibold text-white"
            >
              Vezi ofertele
            </button>

            <button
              type="button"
              onClick={() => router.push("/customer/my-requests")}
              className="rounded-2xl border border-black/10 px-6 py-4 font-semibold text-black"
            >
              Înapoi la daunele mele
            </button>
          </div>
        </div>
      </div>

      {selectedImageIndex !== null && images[selectedImageIndex] && (
    <div
        className="fixed inset-0 z-[9999] bg-black"
        onTouchStart={(e) => {
        setTouchStartX(e.touches[0].clientX);
    }}
        onTouchEnd={(e) => {
        if (touchStartX === null || isZoomed) return;

        const touchEndX = e.changedTouches[0].clientX;
        const difference = touchStartX - touchEndX;

        if (difference > 60 && selectedImageIndex < images.length - 1) {
        setSelectedImageIndex(selectedImageIndex + 1);
        setIsZoomed(false);
      }

        if (difference < -60 && selectedImageIndex > 0) {
        setSelectedImageIndex(selectedImageIndex - 1);
        setIsZoomed(false);
      }

        setTouchStartX(null);
    }}
  >
        <div className="absolute left-0 right-0 top-0 z-10 flex items-center justify-between p-4 text-white">
        <span className="rounded-full bg-white/10 px-3 py-1 text-sm font-semibold">
            {selectedImageIndex + 1}/{images.length}
        </span>

        <button
            type="button"
            onClick={() => {
            setSelectedImageIndex(null);
            setIsZoomed(false);
        }}
            className="flex h-11 w-11 items-center justify-center rounded-full bg-white/10"
            aria-label="Închide poza"
        >
            <X size={26} />
      </button>
    </div>

    <div
      className="flex h-full w-full items-center justify-center overflow-hidden px-3"
      onDoubleClick={() => setIsZoomed((current) => !current)}
    >
      <img
        src={
          images[selectedImageIndex].url ||
          images[selectedImageIndex].dataUrl ||
          ""
        }
        alt={`Poză mărită ${selectedImageIndex + 1}`}
        className={`max-h-[88vh] max-w-full object-contain transition-transform duration-300 ${
          isZoomed ? "scale-150 cursor-zoom-out" : "scale-100 cursor-zoom-in"
        }`}
      />
    </div>
  </div>
)}
    </main>
  );
}

function ReviewLoading() {
  return (
    <main className="min-h-screen bg-[#101010] px-4 py-5 text-white">
      <p className="text-white/60">Se încarcă cererea...</p>
    </main>
  );
}

function InfoCard({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="rounded-2xl bg-black/[0.04] p-4">
      <p className="text-sm font-medium text-black/50">{label}</p>
      <p className="mt-1 font-bold text-black">{value || "-"}</p>
    </div>
  );
}

function formatDamageType(value: string) {
  switch (value) {
    case "scratch":
      return "Zgârietură";
    case "dent":
      return "Îndoitură";
    case "bumper":
      return "Bară avariată";
    case "paint":
      return "Problemă vopsea";
    case "cracked_part":
      return "Element crăpat";
    default:
      return "Altă daună";
  }
}

function formatStatus(value: string) {
  switch (value) {
    case "matched":
      return "Programată";
    case "open":
      return "Deschisă";
    default:
      return value || "-";
  }
}