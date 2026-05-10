"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";

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
  const mainImage = images[0]?.url || images[0]?.dataUrl || "";

  return (
    <main className="min-h-screen bg-[#111111] px-4 py-5 text-white">
      <div className="mx-auto max-w-3xl">
        <button
          onClick={() => router.back()}
          className="mb-5 rounded-full border border-white/15 px-4 py-2 text-sm font-semibold text-white"
        >
          Înapoi
        </button>

        <div className="overflow-hidden rounded-[28px] bg-white text-black shadow-xl">
          {mainImage ? (
            <img
              src={mainImage}
              alt={`${request.car_brand} ${request.car_model}`}
              className="h-80 w-full object-cover"
            />
          ) : (
            <div className="flex h-72 items-center justify-center bg-black/10 text-black/40">
              Fără poză
            </div>
          )}

          <div className="space-y-5 p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h1 className="text-3xl font-black">
                  {request.car_brand} {request.car_model}
                </h1>
                <p className="mt-1 text-black/55">
                  {request.car_year} • {request.city}
                </p>
              </div>

              <span className="rounded-full bg-orange-100 px-3 py-1 text-xs font-bold text-orange-700">
                {formatStatus(request.status)}
              </span>
            </div>

            <div className="rounded-2xl bg-black/[0.04] p-4">
              <p className="text-sm text-black/45">Tip daună</p>
              <p className="mt-1 font-bold">
                {formatDamageType(request.damage_type)}
              </p>
            </div>

            <div className="rounded-2xl bg-black/[0.04] p-4">
              <p className="text-sm text-black/45">Descriere</p>
              <p className="mt-2 text-black/70">
                {request.description || "Fără descriere."}
              </p>
            </div>

            {request.status !== "open" && (
              <button
                onClick={() => router.push(`/chat/${request.id}`)}
                className="w-full rounded-2xl bg-black px-5 py-4 font-bold text-white"
              >
                Chat cu service-ul
              </button>
            )}
          </div>
        </div>
      </div>
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