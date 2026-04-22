"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase/client";

type RepairRequest = {
  id: string;
  car_brand: string;
  car_model: string;
  car_year: string;
  city: string;
  damage_type: string;
  description: string | null;
  images: {
    name: string;
    dataUrl: string;
  }[];
  status: string;
  created_at: string;
};

export default function ReviewPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestId = searchParams.get("id");

  const [data, setData] = useState<RepairRequest | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadRequest = async () => {
      try {
        const { data: authData } = await supabase.auth.getUser();

        if (!authData.user) {
          router.push("/login");
          return;
        }

        if (!requestId) {
          router.push("/");
          return;
        }

        const { data: request, error } = await supabase
          .from("repair_requests")
          .select("*")
          .eq("id", requestId)
          .eq("user_id", authData.user.id)
          .single();

        if (error || !request) {
          console.error("Failed to load review request:", error);
          router.push("/");
          return;
        }

        setData({
          id: request.id,
          car_brand: request.car_brand,
          car_model: request.car_model,
          car_year: request.car_year,
          city: request.city,
          damage_type: request.damage_type,
          description: request.description,
          images: Array.isArray(request.images) ? request.images : [],
          status: request.status,
          created_at: request.created_at,
        });
      } catch (error) {
        console.error("Failed to load request:", error);
        router.push("/");
      } finally {
        setLoading(false);
      }
    };

    loadRequest();
  }, [requestId, router]);

  const handleSend = () => {
    router.push("/success");
  };

  if (loading) {
    return (
      <main className="min-h-screen bg-black text-white flex items-center justify-center">
        <p className="text-white/70">Loading request...</p>
      </main>
    );
  }

  if (!data) {
    return (
      <main className="min-h-screen bg-black text-white flex items-center justify-center">
        <p className="text-white/70">Request not found.</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-black text-white px-6 py-10">
      <div className="mx-auto max-w-4xl">
        <div className="mb-8">
          <h1 className="text-4xl font-bold">Review your request</h1>
          <p className="mt-2 text-white/70">
            Check the details before sending to workshops
          </p>
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-xl border border-white/10 bg-black/30 p-4">
              <p className="text-sm text-white/50">Car brand</p>
              <p className="mt-1 text-lg font-semibold">{data.car_brand}</p>
            </div>

            <div className="rounded-xl border border-white/10 bg-black/30 p-4">
              <p className="text-sm text-white/50">Car model</p>
              <p className="mt-1 text-lg font-semibold">{data.car_model}</p>
            </div>

            <div className="rounded-xl border border-white/10 bg-black/30 p-4">
              <p className="text-sm text-white/50">Year</p>
              <p className="mt-1 text-lg font-semibold">{data.car_year}</p>
            </div>

            <div className="rounded-xl border border-white/10 bg-black/30 p-4">
              <p className="text-sm text-white/50">City</p>
              <p className="mt-1 text-lg font-semibold">{data.city}</p>
            </div>

            <div className="rounded-xl border border-white/10 bg-black/30 p-4 md:col-span-2">
              <p className="text-sm text-white/50">Damage type</p>
              <p className="mt-1 text-lg font-semibold">
                {formatDamageType(data.damage_type)}
              </p>
            </div>

            <div className="rounded-xl border border-white/10 bg-black/30 p-4 md:col-span-2">
              <p className="text-sm text-white/50">Description</p>
              <p className="mt-1 text-lg font-semibold text-white/90">
                {data.description || "No description provided"}
              </p>
            </div>
          </div>

          {data.images.length > 0 && (
            <div className="mt-6">
              <p className="mb-3 text-sm text-white/70">Uploaded photos</p>
              <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                {data.images.map((image, index) => (
                  <img
                    key={`${image.name}-${index}`}
                    src={image.dataUrl}
                    alt={`Damage ${index + 1}`}
                    className="h-36 w-full rounded-lg border border-white/10 object-cover"
                  />
                ))}
              </div>
            </div>
          )}

          <div className="mt-8 flex flex-col gap-3 md:flex-row">
            <button
              onClick={() => router.push("/")}
              className="w-full rounded-lg border border-white/20 px-6 py-3 font-semibold text-white"
            >
              Back
            </button>

            <button
              onClick={handleSend}
              className="w-full rounded-lg bg-white px-6 py-3 font-semibold text-black"
            >
              Send to workshops
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}

function formatDamageType(value: string) {
  switch (value) {
    case "scratch":
      return "Scratch";
    case "dent":
      return "Dent";
    case "bumper":
      return "Bumper damage";
    case "paint":
      return "Paint damage";
    case "cracked_part":
      return "Cracked part";
    default:
      return "Other";
  }
}