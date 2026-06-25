"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import ImageGallery from "@/app/components/ImageGallery";

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

        <div className="mb-5 overflow-hidden rounded-[28px] bg-white/5">
          <ImageGallery
            images={request.images || []}
            alt={`${request.car_brand} ${request.car_model}`}
            className="h-[340px] w-full object-cover"
          />
        </div>

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

        <button
          onClick={() => router.push(`/workshops/${request.id}/offer`)}
          disabled={isClosed}
          className="mt-6 w-full rounded-full bg-white px-6 py-4 text-base font-bold text-black transition active:scale-[0.98] disabled:opacity-50"
        >
          {isClosed ? "Oferta este închisă" : "Trimite ofertă"}
        </button>
      </div>
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
