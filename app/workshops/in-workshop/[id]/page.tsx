"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  Camera,
  Clock,
  FileText,
  Images,
  MessageCircle,
  RefreshCw,
} from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import ImageGallery from "@/app/components/ImageGallery";
import Image from "next/image";

type JobImage = {
  name?: string;
  dataUrl?: string;
  url?: string;
};

type RequestData = {
  id: string;
  car_brand: string | null;
  car_model: string | null;
  car_year: string | null;
  city: string | null;
  damage_type: string | null;
  description: string | null;
  images: JobImage[];
  status: string | null;
};

const statusLabels: Record<string, string> = {
  in_progress: "În lucru",
  matched: "Programată",
  completed: "Finalizată",
};

export default function InWorkshopCarPage() {
  const params = useParams();
  const router = useRouter();
  const requestId = String(params.id);

  const [loading, setLoading] = useState(true);
  const [request, setRequest] = useState<RequestData | null>(null);
  const [workshopName, setWorkshopName] = useState("Service");

  useEffect(() => {
    const loadPage = async () => {
      try {
        const { data: authData } = await supabase.auth.getUser();

        if (!authData.user) {
          router.push("/login");
          return;
        }

        const { data: profile } = await supabase
          .from("profiles")
          .select("workshop_name, full_name")
          .eq("id", authData.user.id)
          .maybeSingle();

        setWorkshopName(
          profile?.workshop_name || profile?.full_name || "Service",
        );

        const { data, error } = await supabase
          .from("repair_requests")
          .select(
            "id, car_brand, car_model, car_year, city, damage_type, description, images, status",
          )
          .eq("id", requestId)
          .maybeSingle();

        if (error) throw error;

        if (!data) {
          setRequest(null);
          return;
        }

        setRequest({
          id: data.id,
          car_brand: data.car_brand,
          car_model: data.car_model,
          car_year: data.car_year,
          city: data.city,
          damage_type: data.damage_type,
          description: data.description,
          images: Array.isArray(data.images) ? data.images : [],
          status: data.status,
        });
      } catch (error: any) {
        console.log(error);
        console.log(JSON.stringify(error, null, 2));

        alert(error?.message || JSON.stringify(error));

        console.error(error);
      } finally {
        setLoading(false);
      }
    };

    if (requestId) loadPage();
  }, [requestId, router]);

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-black text-white">
        Se încarcă fișa mașinii...
      </main>
    );
  }

  if (!request) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-black text-white">
        Lucrarea nu a fost găsită.
      </main>
    );
  }

  const title = `${request.car_brand || "Mașină"} ${request.car_model || ""}`;

  return (
    <main className="min-h-screen bg-black px-4 pb-28 pt-4 text-white">
      <div className="mx-auto max-w-5xl">
        <button
          type="button"
          onClick={() => router.push("/workshops/won-jobs?tab=workshop")}
          className="mb-4 rounded-full border border-white/15 px-4 py-2 text-sm font-semibold text-white/80"
        >
          ← Înapoi
        </button>

        <section className="rounded-[26px] border border-white/10 bg-white/[0.035] p-3">
          <div className="flex items-center gap-3">
            <div className="w-[128px] shrink-0">
              <div className="overflow-hidden rounded-[18px] bg-white/5">
                {request.images.length > 0 ? (
                  <ImageGallery
                    images={request.images}
                    alt={title}
                    className="h-[105px] w-[128px] object-cover"
                    wrapperClassName="block h-[105px] w-[128px] overflow-hidden rounded-[18px]"
                  />
                ) : (
                  <div className="flex h-[105px] w-[128px] items-center justify-center text-4xl">
                    🚗
                  </div>
                )}
              </div>

              <div className="relative -ml-1 mt-2.5 h-[28px] w-[138px]">
                <Image
                  src="/images/license-plates/ro.svg"
                  alt="Număr înmatriculare"
                  fill
                  className="object-contain"
                  priority
                />

                <span
                  className="
    absolute
    left-[30px]
    top-1/2
    -translate-y-1/2
    text-[20px]
    font-black
    uppercase
    tracking-[0.0em]
    text-black
    whitespace-nowrap
  "
                >
                  NT 51 FLY
                </span>
              </div>
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex rounded-full bg-lime-400 px-3 py-1 text-[10px] font-black uppercase tracking-[0.14em] text-black">
                  🔧 {statusLabels[request.status || ""] || "În lucru"}
                </span>

                <span className="rounded-full border border-white/15 bg-white/10 px-3 py-1 text-[10px] font-semibold text-white/80">
                  {request.car_year || "-"} • {request.city || "-"}
                </span>
              </div>

              <h1 className="mt-3 text-2xl font-black leading-tight tracking-tight text-white md:text-4xl">
                {request.car_brand} {request.car_model}
              </h1>

              <p className="mt-2 line-clamp-2 text-xs leading-5 text-white/55 md:text-sm">
                {request.description ||
                  "Nu există descriere pentru această lucrare."}
              </p>
            </div>
          </div>
        </section>

        <div className="mt-6 grid grid-cols-2 gap-4 md:gap-5">
          <ActionCard icon={<FileText size={28} />} title="Documente" />
          <ActionCard icon={<Images size={28} />} title="Poze dosar" />
          <ActionCard icon={<Clock size={28} />} title="Ceas" />
          <ActionCard icon={<Camera size={28} />} title="Fă poză" />
          <ActionCard
            icon={<MessageCircle size={28} />}
            title="Chat client"
            onClick={() => router.push(`/chat/${request.id}?role=workshop`)}
          />
          <ActionCard
            icon={<RefreshCw size={28} />}
            title="Update lucrare"
            onClick={() => router.push(`/workshops/won-jobs/${request.id}`)}
          />
        </div>

        <section className="mt-6 rounded-[28px] border border-white/10 bg-white/[0.03] p-5">
          <p className="text-xs font-black uppercase tracking-[0.22em] text-blue-500">
            Informații lucrare
          </p>

          <p className="mt-4 text-sm leading-6 text-white/70">
            {request.description ||
              "Nu există descriere pentru această lucrare."}
          </p>
        </section>
      </div>
    </main>
  );
}

function ActionCard({
  icon,
  title,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-[118px] flex-col items-center justify-center rounded-[26px] border border-white/10 bg-white text-center text-black shadow-lg transition active:scale-[0.98] hover:scale-[1.01]"
    >
      <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-700 text-white">
        {icon}
      </div>

      <p className="text-sm font-black md:text-base">{title}</p>
    </button>
  );
}
