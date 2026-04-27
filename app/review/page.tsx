"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import type { RepairRequestRow } from "@/lib/supabase/repair-requests";

export default function ReviewPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestId = searchParams.get("id");

  const [request, setRequest] = useState<RepairRequestRow | null>(null);
  const [loading, setLoading] = useState(true);

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

  if (loading) {
    return (
      <main className="min-h-screen bg-[#101010] px-4 py-5 text-white">
        <p className="text-white/60">Se încarcă cererea...</p>
      </main>
    );
  }

  if (!request) return null;

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
            onClick={() => router.push("/customer/dashboard")}
            className="rounded-full border border-white/15 px-4 py-2 text-sm font-semibold text-white"
          >
            Dashboard
          </button>
        </div>

        <div className="rounded-[24px] bg-white p-5 text-black shadow-xl">
          <div className="grid gap-3 md:grid-cols-2">
            <InfoCard label="Marcă" value={request.car_brand} />
            <InfoCard label="Model" value={request.car_model} />
            <InfoCard label="An fabricație" value={request.car_year} />
            <InfoCard label="Localitate" value={request.city} />
            <InfoCard label="Tip daună" value={formatDamageType(request.damage_type)} />
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

            {request.images?.length > 0 ? (
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                {request.images.map((image, index) => (
                  <img
                    key={`${image.name}-${index}`}
                    src={image.dataUrl}
                    alt={`Poză daună ${index + 1}`}
                    className="h-32 w-full rounded-2xl object-cover md:h-44"
                  />
                ))}
              </div>
            ) : (
              <div className="rounded-2xl bg-black/[0.04] p-5 text-center text-sm text-black/50">
                Nu ai încărcat poze.
              </div>
            )}
          </div>

          <div className="mt-6 flex flex-col gap-3">
            <button
              onClick={() => router.push("/offers")}
              className="rounded-2xl bg-black px-6 py-4 font-semibold text-white"
            >
              Vezi ofertele
            </button>

            <button
              onClick={() => router.push("/customer/my-requests")}
              className="rounded-2xl border border-black/10 px-6 py-4 font-semibold text-black"
            >
              Înapoi la daunele mele
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}

function InfoCard({ label, value }: { label: string; value: string }) {
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