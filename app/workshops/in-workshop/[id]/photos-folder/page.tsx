"use client";

import ImageGallery from "@/app/components/ImageGallery";
import { supabase } from "@/lib/supabase/client";
import {
  formatProgressStatus,
  getProgressWorkflow,
  isProgressStatusValidForWorkflow,
  normalizeProgressStatus,
  type ProgressStatus,
} from "@/lib/work-progress/workflows";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

type RequestSummary = {
  id: string;
  car_brand: string | null;
  car_model: string | null;
  car_year: string | null;
  city: string | null;
  service_type: string | null;
  accepted_offer_id: string | null;
};

type ProgressUpdateRow = {
  id: string;
  status: string | null;
  message: string | null;
  images: unknown;
  created_at: string;
};

type PhotoUpdate = Omit<ProgressUpdateRow, "images"> & {
  images: string[];
};

type PhotoGroup = {
  status: ProgressStatus | null;
  label: string;
  index: number;
  updates: PhotoUpdate[];
  totalPhotos: number;
  isOther: boolean;
};

function sanitizeImageUrls(images: unknown): string[] {
  if (!Array.isArray(images)) return [];

  return images.filter(
    (image): image is string =>
      typeof image === "string" && image.trim().length > 0,
  );
}

function formatUpdateDate(createdAt: string) {
  const date = new Date(createdAt);

  if (Number.isNaN(date.getTime())) return "Dată indisponibilă";

  return new Intl.DateTimeFormat("ro-RO", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function buildPhotoGroups(
  updates: PhotoUpdate[],
  serviceType: string | null,
): PhotoGroup[] {
  const workflow = getProgressWorkflow(serviceType);
  const updatesByStatus = new Map<ProgressStatus, PhotoUpdate[]>();
  const otherUpdates: PhotoUpdate[] = [];

  updates.forEach((update) => {
    const normalizedStatus = normalizeProgressStatus(update.status);

    if (
      normalizedStatus &&
      isProgressStatusValidForWorkflow(update.status, serviceType)
    ) {
      const current = updatesByStatus.get(normalizedStatus) ?? [];
      current.push(update);
      updatesByStatus.set(normalizedStatus, current);
      return;
    }

    otherUpdates.push(update);
  });

  const groups = workflow.flatMap<PhotoGroup>((step) => {
    const statusUpdates = updatesByStatus.get(step.status) ?? [];
    if (statusUpdates.length === 0) return [];

    return [
      {
        status: step.status,
        label: step.label,
        index: step.index,
        updates: statusUpdates,
        totalPhotos: statusUpdates.reduce(
          (total, update) => total + update.images.length,
          0,
        ),
        isOther: false,
      },
    ];
  });

  if (otherUpdates.length > 0) {
    groups.push({
      status: null,
      label: "Altele",
      index: workflow.length,
      updates: otherUpdates,
      totalPhotos: otherUpdates.reduce(
        (total, update) => total + update.images.length,
        0,
      ),
      isOther: true,
    });
  }

  return groups.sort((first, second) => first.index - second.index);
}

export default function WorkPhotosFolderPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const requestId = params.id;

  const [loading, setLoading] = useState(true);
  const [request, setRequest] = useState<RequestSummary | null>(null);
  const [groups, setGroups] = useState<PhotoGroup[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    const loadPhotosFolder = async () => {
      try {
        const { data: authData, error: authError } =
          await supabase.auth.getUser();

        if (authError) throw authError;
        if (!authData.user) {
          router.push("/login");
          return;
        }

        const { data: requestData, error: requestError } = await supabase
          .from("repair_requests")
          .select(
            "id, car_brand, car_model, car_year, city, service_type, accepted_offer_id",
          )
          .eq("id", requestId)
          .maybeSingle();

        if (requestError) throw requestError;
        if (!requestData?.accepted_offer_id) {
          throw new Error(
            "Lucrarea nu a fost găsită sau nu ai acces la dosarul ei foto.",
          );
        }

        const { data: acceptedOffer, error: offerError } = await supabase
          .from("repair_offers")
          .select("id")
          .eq("id", requestData.accepted_offer_id)
          .eq("request_id", requestId)
          .eq("workshop_user_id", authData.user.id)
          .eq("status", "accepted")
          .maybeSingle();

        if (offerError) throw offerError;
        if (!acceptedOffer) {
          throw new Error("Nu ai acces la dosarul foto al acestei lucrări.");
        }

        const { data: progressData, error: progressError } = await supabase
          .from("work_progress_updates")
          .select("id, status, message, images, created_at")
          .eq("request_id", requestId)
          .order("created_at", { ascending: false });

        if (progressError) throw progressError;
        if (!active) return;

        const photoUpdates = ((progressData ?? []) as ProgressUpdateRow[])
          .map((update) => ({
            ...update,
            images: sanitizeImageUrls(update.images),
          }))
          .filter((update) => update.images.length > 0);

        setRequest(requestData);
        setGroups(buildPhotoGroups(photoUpdates, requestData.service_type));
      } catch (error) {
        if (!active) return;

        setRequest(null);
        setGroups([]);
        setErrorMessage(
          error instanceof Error
            ? error.message
            : "Dosarul foto nu a putut fi încărcat.",
        );
      } finally {
        if (active) setLoading(false);
      }
    };

    void loadPhotosFolder();

    return () => {
      active = false;
    };
  }, [requestId, router]);

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-black px-5 text-white">
        Se încarcă dosarul foto...
      </main>
    );
  }

  const requestTitle = request
    ? `${request.car_brand || "Mașină"} ${request.car_model || ""}`.trim()
    : "Lucrare";

  return (
    <main className="min-h-screen bg-black px-4 pb-28 pt-4 text-white">
      <div className="mx-auto max-w-3xl">
        <button
          type="button"
          onClick={() => router.push(`/workshops/in-workshop/${requestId}`)}
          className="mb-5 rounded-full border border-white/15 px-4 py-2 text-sm font-semibold text-white/80"
        >
          ← Înapoi
        </button>

        <header className="rounded-[28px] border border-white/10 bg-white/[0.04] p-5">
          <p className="text-xs font-black uppercase tracking-[0.22em] text-orange-400">
            Poze dosar
          </p>
          <h1 className="mt-2 text-3xl font-black tracking-tight">
            {requestTitle}
          </h1>
          {request && (
            <p className="mt-2 text-sm text-white/50">
              {[request.car_year, request.city].filter(Boolean).join(" • ") ||
                "Istoricul fotografic al lucrării"}
            </p>
          )}
          <p className="mt-3 text-sm text-white/65">
            Istoricul fotografic al lucrării, organizat pe etape.
          </p>
        </header>

        {errorMessage ? (
          <div
            className="mt-5 rounded-3xl border border-red-500/25 bg-red-500/10 px-5 py-4 text-sm font-semibold text-red-300"
            role="alert"
          >
            {errorMessage}
          </div>
        ) : groups.length === 0 ? (
          <div className="mt-5 rounded-[28px] border border-white/10 bg-white/[0.04] px-6 py-10 text-center">
            <p className="text-lg font-bold">
              Nu există încă poze în dosarul lucrării.
            </p>
            <p className="mt-2 text-sm text-white/50">
              Fotografiile trimise din cardul Fă poză vor apărea aici.
            </p>
          </div>
        ) : (
          <div className="mt-5 space-y-5">
            {groups.map((group) => (
              <section
                key={group.status ?? "other"}
                className="overflow-hidden rounded-[28px] border border-white/10 bg-white/[0.04]"
              >
                <div className="border-b border-white/10 px-5 py-4">
                  <p className="text-xs font-black uppercase tracking-[0.18em] text-orange-300">
                    {group.label} · {group.totalPhotos}{" "}
                    {group.totalPhotos === 1 ? "poză" : "poze"}
                  </p>
                </div>

                <div className="space-y-4 p-4">
                  {group.updates.map((update) => (
                    <article
                      key={update.id}
                      className="rounded-3xl border border-white/10 bg-black/35 p-4"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <time className="text-xs font-semibold text-white/45">
                          {formatUpdateDate(update.created_at)}
                        </time>

                        <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-bold text-white/70">
                          {update.images.length}{" "}
                          {update.images.length === 1 ? "poză" : "poze"}
                        </span>
                      </div>

                      {group.isOther && (
                        <p className="mt-3 text-xs font-semibold text-amber-300">
                          Status istoric: {formatProgressStatus(update.status) ||
                            "Necunoscut"}{" "}
                          <span className="text-white/35">
                            ({update.status || "fără valoare"})
                          </span>
                        </p>
                      )}

                      {update.message?.trim() && (
                        <p className="mt-3 text-sm leading-6 text-white/70">
                          {update.message.trim()}
                        </p>
                      )}

                      <div className="mt-4 overflow-hidden rounded-2xl">
                        <ImageGallery
                          images={update.images.map((url, imageIndex) => ({
                            name: `folder-${update.id}-${imageIndex}`,
                            url,
                          }))}
                          alt={`Poze ${group.label}`}
                          className="h-52 w-full object-cover"
                          wrapperClassName="block w-full overflow-hidden rounded-2xl"
                        />
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
