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
  thumbUrl?: string;
};

type ProfileRow = {
  role: string[] | null;
};

type RepairRequestRow = {
  id: string;
  car_brand: string;
  car_model: string;
  car_year: string;
  city: string;
  damage_type: string;
  description: string | null;
  images: RepairImage[];
  status: string;
};

export default function WorkshopRequestDetailsPage() {
  const router = useRouter();
  const params = useParams();
  const id = params.id as string;

  const [request, setRequest] = useState<RepairRequestRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedImages, setSelectedImages] = useState<string[]>([]);
  const [updatingStatus, setUpdatingStatus] = useState(false);

  useEffect(() => {
    localStorage.setItem("activeRole", "workshop");
    const loadRequest = async () => {
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

        const { data, error } = await supabase
          .from("repair_requests")
          .select(
            "id, car_brand, car_model, car_year, city, damage_type, description, images, status",
          )
          .eq("id", id)
          .single<RepairRequestRow>();

        if (error || !data) {
          setRequest(null);
          return;
        }

        setRequest(data);
      } catch {
        setRequest(null);
      } finally {
        setLoading(false);
      }
    };

    loadRequest();
  }, [id, router]);

  const updateJobStatus = async (status: string) => {
    if (!request) return;

    try {
      setUpdatingStatus(true);

      const { data, error } = await supabase
        .from("repair_requests")
        .update({ status })
        .eq("id", request.id)
        .select("id, status")
        .single();

      if (error) {
        alert(error.message);
        return;
      }

      setRequest((prev) =>
        prev
          ? {
              ...prev,
              status: data.status,
            }
          : prev,
      );

      await supabase.channel(`repair-request-${request.id}`).send({
        type: "broadcast",
        event: "status-updated",
        payload: {
          status: data.status,
        },
      });
      
    } catch (error) {
      console.error("Failed to update status:", error);
      alert("Statusul nu a putut fi actualizat.");
    } finally {
      setUpdatingStatus(false);
    }
  };

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-black text-white">
        Se încarcă...
      </main>
    );
  }

  if (!request) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-black text-white">
        Dauna nu a fost găsită.
      </main>
    );
  }

  const images =
    request.images
      ?.map((image) => image.url || image.dataUrl || "")
      .filter(Boolean) || [];

  const isClosed = request.status === "completed";

  return (
    <main className="min-h-screen bg-black px-4 py-8 text-white">
      <div className="mx-auto max-w-md">
        <button
          onClick={() => router.push("/workshops")}
          className="mb-6 rounded-full border border-white/15 px-4 py-2 text-sm text-white/80"
        >
          Înapoi
        </button>

        <section className="mb-6">
          <p className="text-[11px] uppercase tracking-[0.26em] text-orange-400">
            Detalii daună
          </p>

          <h1 className="mt-3 text-4xl font-black leading-tight">
            {request.car_brand} {request.car_model}
          </h1>

          <p className="mt-2 text-lg text-white/50">
            {request.car_year} • {request.city}
          </p>
        </section>

        <button
          type="button"
          onClick={() => setSelectedImages(images)}
          className="mb-5 block w-full overflow-hidden rounded-[28px] bg-white/5"
        >
          {images.length > 0 ? (
            <img
              src={images[0]}
              alt={`${request.car_brand} ${request.car_model}`}
              className="h-[340px] w-full object-cover"
            />
          ) : (
            <div className="flex h-[260px] items-center justify-center text-white/40">
              Fără poză
            </div>
          )}
        </button>

        {images.length > 1 && (
          <div className="mb-6 grid grid-cols-3 gap-3">
            {images.slice(1).map((src, index) => (
              <button
                key={index}
                type="button"
                onClick={() => setSelectedImages(images)}
                className="overflow-hidden rounded-2xl bg-white/5"
              >
                <img
                  src={src}
                  alt={`Poză ${index + 2}`}
                  className="h-24 w-full object-cover"
                />
              </button>
            ))}
          </div>
        )}

        <section className="rounded-[28px] border border-white/10 bg-white/[0.04] p-5">
          <p className="text-[11px] uppercase tracking-[0.24em] text-white/35">
            Descriere client
          </p>

          <p className="mt-4 text-lg leading-8 text-white/80">
            {request.description || "Clientul nu a adăugat descriere."}
          </p>

          <div className="mt-5 flex flex-wrap gap-2">
            <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-black">
              {formatDamageType(request.damage_type)}
            </span>

            <span className="rounded-full border border-white/10 px-3 py-1 text-xs text-white/65">
              {request.city}
            </span>

            <span className="rounded-full border border-white/10 px-3 py-1 text-xs text-white/65">
              {request.car_year}
            </span>
          </div>
        </section>

        <section className="mt-5 rounded-[28px] border border-white/10 bg-white/[0.04] p-5">
          <p className="text-[11px] uppercase tracking-[0.24em] text-orange-400">
            Status lucrare
          </p>

          <div className="mt-4 flex flex-wrap gap-3">
            <button
              disabled={updatingStatus}
              onClick={() => updateJobStatus("in_progress")}
              className={`rounded-2xl px-4 py-3 text-sm font-bold transition ${
                request.status === "in_progress"
                  ? "bg-blue-500 text-white"
                  : "bg-white/10 text-white"
              }`}
            >
              În lucru
            </button>

            <button
              disabled={updatingStatus}
              onClick={() => updateJobStatus("painting")}
              className={`rounded-2xl px-4 py-3 text-sm font-bold transition ${
                request.status === "painting"
                  ? "bg-orange-500 text-black"
                  : "bg-white/10 text-white"
              }`}
            >
              La vopsit
            </button>

            <button
              disabled={updatingStatus}
              onClick={() => updateJobStatus("polishing")}
              className={`rounded-2xl px-4 py-3 text-sm font-bold transition ${
                request.status === "polishing"
                  ? "bg-purple-500 text-white"
                  : "bg-white/10 text-white"
              }`}
            >
              La polish
            </button>

            <button
              disabled={updatingStatus}
              onClick={() => updateJobStatus("completed")}
              className={`rounded-2xl px-4 py-3 text-sm font-bold transition ${
                request.status === "completed"
                  ? "bg-green-500 text-white"
                  : "bg-white/10 text-white"
              }`}
            >
              Finalizată
            </button>
          </div>
        </section>

        <button
          onClick={() => router.push(`/workshops/${request.id}/offer`)}
          disabled={isClosed}
          className="mt-6 w-full rounded-full bg-white px-6 py-4 text-base font-bold text-black transition active:scale-[0.98] disabled:opacity-50"
        >
          {isClosed ? "Oferta este închisă" : "Trimite ofertă"}
        </button>
      </div>

      <Lightbox
        open={selectedImages.length > 0}
        close={() => setSelectedImages([])}
        slides={selectedImages.map((src) => ({ src }))}
        plugins={[Zoom]}
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
