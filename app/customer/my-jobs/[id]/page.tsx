"use client";

import { useEffect, useState } from "react";
import { Home } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import type { RepairRequestRow } from "@/lib/supabase/repair-requests";

type WorkProgressUpdate = {
  id: string;
  status: string | null;
  message: string | null;
  images: string[] | null;
  created_at: string;
};

type AcceptedOffer = {
  id: string;
  workshop_name: string | null;
  price: number | string | null;
  days: number | string | null;
  message: string | null;
};

export default function CustomerJobDetailPage() {
  const router = useRouter();
  const params = useParams();

  const requestId = params.id as string;

  const [request, setRequest] = useState<RepairRequestRow | null>(null);
  const [offer, setOffer] = useState<AcceptedOffer | null>(null);
  const [progressUpdates, setProgressUpdates] = useState<WorkProgressUpdate[]>(
    [],
  );
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadJob = async () => {
      try {
        setLoading(true);

        if (!requestId) {
          router.push("/customer/my-jobs");
          return;
        }

        const { data: authData } = await supabase.auth.getUser();

        if (!authData.user) {
          router.push("/login");
          return;
        }

        const { data: requestData, error: requestError } = await supabase
          .from("repair_requests")
          .select("*")
          .eq("id", requestId)
          .single<RepairRequestRow>();

        if (requestError) {
          console.error(requestError);
          router.push("/customer/my-jobs");
          return;
        }

        setRequest(requestData);

        if (requestData.accepted_offer_id) {
          const { data: offerData } = await supabase
            .from("repair_offers")
            .select("id, workshop_name, price, days, message")
            .eq("id", requestData.accepted_offer_id)
            .single<AcceptedOffer>();

          setOffer(offerData || null);
        }

        const { data: progressData, error: progressError } = await supabase
          .from("work_progress_updates")
          .select("*")
          .eq("request_id", requestId)
          .order("created_at", { ascending: false });

        if (progressError) {
          console.error(progressError);
        } else {
          setProgressUpdates(progressData || []);

          const unreadUpdates =
            progressData?.map((update) => ({
              update_id: update.id,
              user_id: authData.user.id,
            })) || [];

          if (unreadUpdates.length > 0) {
            await supabase.rpc("mark_progress_updates_read", {
              p_request_id: requestId,
            });

            window.dispatchEvent(new Event("progress-read-updated"));
          }
        }
      } catch (error) {
        console.error(error);
      } finally {
        setLoading(false);
      }
    };

    loadJob();

    const channel = supabase
      .channel(`customer-job-progress-${requestId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "work_progress_updates",
          filter: `request_id=eq.${requestId}`,
        },
        async () => {
          await loadJob();
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [requestId, router]);

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#101010] text-white">
        Se încarcă lucrarea...
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
              Programare service
            </p>
            <h1 className="mt-2 text-2xl font-bold">Urmărește lucrarea</h1>
            <p className="mt-2 text-sm text-white/55">
              Aici vezi service-ul, prețul și progresul live al reparației.
            </p>
          </div>

          <button
            type="button"
            onClick={() => router.push("/customer/dashboard")}
            className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full border border-white/20 bg-black/40 text-white"
          >
            <Home size={24} />
          </button>
        </div>

        <div className="rounded-[24px] bg-white p-5 text-black shadow-xl">
          <div className="rounded-3xl bg-black p-5 text-white">
            <p className="text-xs uppercase tracking-[0.22em] text-orange-400">
              Service programat
            </p>

            <h2 className="mt-2 text-2xl font-black">
              {offer?.workshop_name || "Service auto"}
            </h2>

            <div className="mt-4 grid grid-cols-2 gap-3">
              <div className="rounded-2xl bg-white/10 p-4">
                <p className="text-xs text-white/50">Preț</p>
                <p className="mt-1 text-lg font-black">
                  {offer?.price ? `${offer.price} €` : "—"}
                </p>
              </div>

              <div className="rounded-2xl bg-white/10 p-4">
                <p className="text-xs text-white/50">Durată</p>
                <p className="mt-1 text-lg font-black">
                  {offer?.days ? `${offer.days} zile` : "—"}
                </p>
              </div>
            </div>

            {offer?.message && (
              <p className="mt-4 text-sm text-white/70">{offer.message}</p>
            )}
          </div>

          <div className="mt-6 grid gap-3 md:grid-cols-2">
            <InfoCard label="Marcă" value={request.car_brand} />
            <InfoCard label="Model" value={request.car_model} />
            <InfoCard label="An fabricație" value={request.car_year} />
            <InfoCard label="Localitate" value={request.city} />
          </div>

          <div className="mt-8">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.25em] text-orange-500">
                  Service updates
                </p>

                <h2 className="mt-1 text-2xl font-black text-black">
                  Status lucrare
                </h2>
              </div>

              <div className="rounded-full bg-orange-100 px-4 py-2 text-xs font-bold text-orange-600">
                {progressUpdates.length} update-uri
              </div>
            </div>

            {progressUpdates.length === 0 ? (
              <div className="rounded-3xl bg-black/[0.04] p-6 text-center text-sm text-black/50">
                Service-ul nu a trimis încă update-uri.
              </div>
            ) : (
              <div className="space-y-4">
                {progressUpdates.map((update, index) => (
                  <div
                    key={update.id}
                    className="overflow-hidden rounded-3xl border border-black/10 bg-white shadow-sm"
                  >
                    <div className="border-b border-black/5 bg-orange-50 px-5 py-4">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-xs font-bold uppercase tracking-[0.2em] text-orange-500">
                            {update.status || "Update"}
                          </p>

                          <p className="mt-1 text-xs text-black/45">
                            #{progressUpdates.length - index}
                          </p>
                        </div>

                        <div className="rounded-full bg-black px-4 py-2 text-xs font-bold text-white">
                          Service
                        </div>
                      </div>
                    </div>

                    <div className="p-5">
                      <p className="text-sm leading-relaxed text-black/75">
                        {update.message || "Fără mesaj."}
                      </p>

                      {Array.isArray(update.images) &&
                        update.images.length > 0 && (
                          <div className="mt-4 grid grid-cols-2 gap-3">
                            {update.images.slice(0, 2).map((imageUrl) => (
                              <img
                                key={imageUrl}
                                src={imageUrl}
                                alt=""
                                className="h-32 w-full rounded-2xl object-cover"
                              />
                            ))}
                          </div>
                        )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={() => router.push("/customer/my-jobs")}
            className="mt-6 w-full rounded-2xl bg-black px-6 py-4 font-semibold text-white"
          >
            Înapoi la programări
          </button>
        </div>
      </div>
    </main>
  );
}

function InfoCard({
  label,
  value,
}: {
  label: string;
  value?: string | number | null;
}) {
  return (
    <div className="rounded-2xl bg-black/[0.04] p-4">
      <p className="text-xs font-medium uppercase tracking-[0.12em] text-black/40">
        {label}
      </p>
      <p className="mt-1 font-semibold text-black">{value || "—"}</p>
    </div>
  );
}
