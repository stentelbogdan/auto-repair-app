"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import ImageGallery from "@/app/components/ImageGallery";
import { supabase } from "@/lib/supabase/client";

type NumericValue = number | string | null;

type AdminWorkshopDetail = {
  workshop_id: string;
  workshop_name: string;
  created_at: string | null;
  workshop_description: string | null;
  workshop_city: string | null;
  workshop_hours: string | null;
  workshop_specializations: string[];
  workshop_logo_url: string | null;
  total_offer_count: NumericValue;
  accepted_job_count: NumericValue;
  in_progress_job_count: NumericValue;
  completed_job_count: NumericValue;
  review_count: NumericValue;
  average_rating: NumericValue;
  workshop_phone: string | null;
  workshop_email: string | null;
  work_area_locality: string | null;
  work_area_country_code: string | null;
  work_area_radius_km: number | null;
  workshop_gallery_urls: string[];
};

type DetailState =
  | { status: "loading" }
  | { status: "ready"; detail: AdminWorkshopDetail }
  | { status: "unavailable" }
  | { status: "error" };

const DATE_FORMATTER = new Intl.DateTimeFormat("ro-RO", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

const INTEGER_FORMATTER = new Intl.NumberFormat("ro-RO", {
  maximumFractionDigits: 0,
});

const RATING_FORMATTER = new Intl.NumberFormat("ro-RO", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

function isUnauthorizedError(error: { code?: string } | null): boolean {
  return error?.code === "42501";
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function toNonNegativeInteger(value: NumericValue): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 0;
}

function toNullableNumber(value: NumericValue): number | null {
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatDate(value: string | null): string {
  if (!value) return "Dată indisponibilă";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Dată indisponibilă"
    : DATE_FORMATTER.format(date);
}

function getWorkshopInitials(name: string): string {
  const initials = name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word.charAt(0).toUpperCase())
    .join("");

  return initials || "AR";
}

export default function AdminWorkshopDetailPage() {
  const params = useParams<{ workshopId: string }>();
  const router = useRouter();
  const workshopId = params.workshopId;
  const [detailState, setDetailState] = useState<DetailState>({
    status: "loading",
  });
  const [retryGeneration, setRetryGeneration] = useState(0);
  const requestGenerationRef = useRef(0);

  const loadDetail = useCallback(
    async (generation: number) => {
      const isCurrentRequest = () =>
        requestGenerationRef.current === generation;

      try {
        const {
          data: { session },
          error: sessionError,
        } = await supabase.auth.getSession();

        if (!isCurrentRequest()) return;
        if (sessionError) throw sessionError;
        if (!session) {
          router.replace("/login");
          return;
        }

        const { data, error } = await supabase.rpc(
          "get_admin_workshop_details",
          { p_workshop_id: workshopId },
        );

        if (!isCurrentRequest()) return;
        if (isUnauthorizedError(error)) {
          router.replace("/");
          return;
        }
        if (error || !data) {
          throw error ?? new Error("Workshop detail is unavailable.");
        }

        const detail = (data as AdminWorkshopDetail[])[0] ?? null;
        setDetailState(
          detail ? { status: "ready", detail } : { status: "unavailable" },
        );
      } catch {
        if (isCurrentRequest()) setDetailState({ status: "error" });
      }
    },
    [router, workshopId],
  );

  useEffect(() => {
    const generation = ++requestGenerationRef.current;
    setDetailState({ status: "loading" });

    if (!workshopId || !isUuid(workshopId)) {
      setDetailState({ status: "unavailable" });
      return () => {
        requestGenerationRef.current += 1;
      };
    }

    void loadDetail(generation);

    return () => {
      requestGenerationRef.current += 1;
    };
  }, [loadDetail, retryGeneration, workshopId]);

  return (
    <main className="min-h-screen overflow-x-hidden bg-black px-4 pb-16 pt-6 text-white sm:px-6 sm:py-10">
      <div className="mx-auto max-w-6xl">
        <Link
          href="/admin/workshops"
          className="inline-flex min-h-11 items-center rounded-full border border-white/15 px-4 py-2 text-sm font-semibold text-white/80 transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400/70"
        >
          ← Înapoi la Service-uri
        </Link>

        {detailState.status === "loading" && (
          <div
            className="flex min-h-64 items-center justify-center"
            role="status"
          >
            <p className="text-white/60">
              Se încarcă detaliile service-ului...
            </p>
          </div>
        )}

        {detailState.status === "error" && (
          <StateCard
            title="Detalii indisponibile"
            message="Nu am putut încărca detaliile service-ului."
            actionLabel="Încearcă din nou"
            onAction={() =>
              setRetryGeneration((currentGeneration) => currentGeneration + 1)
            }
          />
        )}

        {detailState.status === "unavailable" && (
          <StateCard
            title="Service indisponibil"
            message="Service-ul nu există sau nu este disponibil pentru vizualizare."
          />
        )}

        {detailState.status === "ready" && (
          <WorkshopDetail
            key={detailState.detail.workshop_id}
            detail={detailState.detail}
          />
        )}
      </div>
    </main>
  );
}

function WorkshopDetail({ detail }: { detail: AdminWorkshopDetail }) {
  const [logoFailed, setLogoFailed] = useState(false);
  const name = detail.workshop_name.trim() || "Service";
  const city = detail.workshop_city?.trim() || "Nespecificat";
  const description =
    detail.workshop_description?.trim() || "Nicio descriere disponibilă";
  const hours = detail.workshop_hours?.trim() || "Nespecificat";
  const phone = detail.workshop_phone?.trim() || "Nespecificat";
  const email = detail.workshop_email?.trim() || "Nespecificat";
  const workAreaLocality = detail.work_area_locality?.trim() || null;
  const workAreaCountryCode =
    detail.work_area_country_code?.trim() || null;
  const workAreaLocation =
    [workAreaLocality, workAreaCountryCode].filter(Boolean).join(", ") ||
    "Localitate nespecificată";
  const workAreaRadius =
    detail.work_area_radius_km === null
      ? "Rază nespecificată"
      : `Rază de lucru: ${INTEGER_FORMATTER.format(detail.work_area_radius_km)} km`;
  const logoUrl = detail.workshop_logo_url?.trim() || null;
  const specializations = Array.from(
    new Set(
      detail.workshop_specializations
        .map((specialization) => specialization.trim())
        .filter(Boolean),
    ),
  );
  const reviewCount = toNonNegativeInteger(detail.review_count);
  const averageRating = toNullableNumber(detail.average_rating);

  const metrics = [
    { label: "Oferte trimise", value: detail.total_offer_count },
    { label: "Lucrări câștigate", value: detail.accepted_job_count },
    { label: "În desfășurare", value: detail.in_progress_job_count },
    { label: "Finalizate", value: detail.completed_job_count },
  ];

  return (
    <>
      <header className="mt-7 min-w-0">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-[0.24em] text-orange-400">
              Admin
            </p>
            <h1 className="mt-2 break-words text-3xl font-bold sm:text-4xl">
              Detalii service
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-white/60 sm:text-base">
              Profil și activitate marketplace, disponibile doar pentru citire.
            </p>
          </div>
          <span className="inline-flex min-h-10 w-fit items-center rounded-full border border-white/15 bg-white/5 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-white/60">
            Doar citire
          </span>
        </div>
      </header>

      <section
        className="mt-8 min-w-0 rounded-3xl border border-white/10 bg-white/[0.05] p-5 shadow-lg sm:p-7"
        aria-labelledby="workshop-profile-title"
      >
        <div className="flex min-w-0 flex-col gap-5 sm:flex-row sm:items-start">
          <div className="relative flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-white/10 bg-white/10 text-xl font-black text-orange-300">
            {logoUrl && !logoFailed ? (
              <Image
                src={logoUrl}
                alt=""
                fill
                sizes="80px"
                className="object-cover"
                onError={() => setLogoFailed(true)}
              />
            ) : (
              <span aria-hidden="true">{getWorkshopInitials(name)}</span>
            )}
          </div>

          <div className="min-w-0 flex-1">
            <h2
              id="workshop-profile-title"
              className="break-words text-2xl font-bold text-white"
            >
              {name}
            </h2>
            <p className="mt-2 break-words text-sm text-white/60">{city}</p>
            <p className="mt-2 text-sm text-white/45">
              Înregistrat la {formatDate(detail.created_at)}
            </p>
          </div>
        </div>

        <div className="mt-6 grid min-w-0 gap-4 md:grid-cols-2">
          <ProfileField label="Descriere" value={description} />
          <ProfileField label="Program" value={hours} />
        </div>

        <div className="mt-6 grid min-w-0 gap-4 md:grid-cols-2">
          <div className="min-w-0 rounded-2xl bg-black/25 p-4">
            <h3 className="text-xs font-semibold uppercase tracking-[0.16em] text-white/40">
              Contact
            </h3>
            <dl className="mt-3 space-y-3">
              <div className="min-w-0">
                <dt className="text-xs text-white/40">Telefon</dt>
                <dd className="mt-1 break-words text-sm leading-6 text-white/75">
                  {phone}
                </dd>
              </div>
              <div className="min-w-0">
                <dt className="text-xs text-white/40">Email</dt>
                <dd className="mt-1 break-words text-sm leading-6 text-white/75">
                  {email}
                </dd>
              </div>
            </dl>
          </div>

          <div className="min-w-0 rounded-2xl bg-black/25 p-4">
            <h3 className="text-xs font-semibold uppercase tracking-[0.16em] text-white/40">
              Zona de lucru
            </h3>
            <p className="mt-3 break-words text-sm leading-6 text-white/75">
              {workAreaLocation}
            </p>
            <p className="mt-1 break-words text-sm leading-6 text-white/60">
              {workAreaRadius}
            </p>
          </div>
        </div>

        <div className="mt-6 min-w-0">
          <h3 className="text-xs font-semibold uppercase tracking-[0.18em] text-white/45">
            Specializări
          </h3>
          {specializations.length > 0 ? (
            <div className="mt-3 flex min-w-0 flex-wrap gap-2">
              {specializations.map((specialization) => (
                <span
                  key={specialization}
                  className="max-w-full break-words rounded-full border border-white/15 bg-black/25 px-3 py-1.5 text-xs font-semibold text-white/75"
                >
                  {specialization}
                </span>
              ))}
            </div>
          ) : (
            <p className="mt-2 text-sm text-white/60">Nespecificate</p>
          )}
        </div>
      </section>

      <WorkshopGallery urls={detail.workshop_gallery_urls} />

      <section className="mt-8" aria-labelledby="marketplace-activity-title">
        <p className="text-xs uppercase tracking-[0.22em] text-orange-400">
          Activitate
        </p>
        <h2 id="marketplace-activity-title" className="mt-2 text-2xl font-bold">
          Activitate marketplace
        </h2>
        <dl className="mt-5 grid min-w-0 grid-cols-2 gap-3 lg:grid-cols-4">
          {metrics.map((metric) => (
            <div
              key={metric.label}
              className="min-w-0 rounded-2xl border border-white/10 bg-white/[0.05] p-4 sm:p-5"
            >
              <dt className="break-words text-xs leading-5 text-white/45">
                {metric.label}
              </dt>
              <dd className="mt-2 text-2xl font-bold text-white">
                {INTEGER_FORMATTER.format(toNonNegativeInteger(metric.value))}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <section
        className="mt-8 rounded-3xl border border-white/10 bg-white/[0.05] p-5 sm:p-7"
        aria-labelledby="workshop-reputation-title"
      >
        <p className="text-xs uppercase tracking-[0.22em] text-orange-400">
          Reputație
        </p>
        <h2 id="workshop-reputation-title" className="mt-2 text-2xl font-bold">
          Review-uri
        </h2>
        {reviewCount > 0 && averageRating !== null ? (
          <div className="mt-5">
            <p className="text-3xl font-bold text-orange-300">
              {RATING_FORMATTER.format(averageRating)} / 5
            </p>
            <p className="mt-2 text-sm text-white/60">
              {INTEGER_FORMATTER.format(reviewCount)} {reviewCount === 1 ? "recenzie" : "recenzii"}
            </p>
          </div>
        ) : (
          <p className="mt-5 text-sm text-white/60">Fără recenzii</p>
        )}
      </section>
    </>
  );
}

function WorkshopGallery({ urls }: { urls: string[] }) {
  const [failedUrls, setFailedUrls] = useState<Set<string>>(() => new Set());
  const galleryUrls = urls.filter((url) => url.trim().length > 0);
  const galleryImages = galleryUrls.map((url, index) => ({
    name: `workshop-gallery-${index + 1}`,
    url,
  }));

  return (
    <section className="mt-8" aria-labelledby="workshop-gallery-title">
      <p className="text-xs uppercase tracking-[0.22em] text-orange-400">
        Galerie service
      </p>
      <h2 id="workshop-gallery-title" className="mt-2 text-2xl font-bold">
        Fotografii
      </h2>

      {galleryUrls.length > 0 ? (
        <div className="mt-5 grid min-w-0 grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
          {galleryUrls.map((url, index) => (
            <div
              key={`${url}-${index}`}
              className="relative aspect-[4/3] min-w-0 overflow-hidden rounded-2xl border border-white/10 bg-white/[0.05]"
            >
              {failedUrls.has(url) ? (
                <div className="flex h-full items-center justify-center px-3 text-center text-xs text-white/40">
                  Imagine indisponibilă
                </div>
              ) : (
                <ImageGallery
                  images={galleryImages}
                  alt={`Fotografie service ${index + 1}`}
                  initialIndex={index}
                  hideCountBadge
                  wrapperClassName="h-full w-full"
                  className="aspect-[4/3] w-full object-cover transition duration-200 hover:scale-[1.03]"
                  onThumbnailError={() =>
                    setFailedUrls((currentUrls) => {
                      const nextUrls = new Set(currentUrls);
                      nextUrls.add(url);
                      return nextUrls;
                    })
                  }
                />
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-5 rounded-2xl border border-white/10 bg-white/[0.05] p-5 text-sm text-white/60">
          Nicio fotografie disponibilă
        </div>
      )}
    </section>
  );
}

function ProfileField({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-2xl bg-black/25 p-4">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-white/40">
        {label}
      </p>
      <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-white/75">
        {value}
      </p>
    </div>
  );
}

function StateCard({
  title,
  message,
  actionLabel,
  onAction,
}: {
  title: string;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className="mt-8 rounded-3xl border border-white/10 bg-white/5 p-6 text-center sm:p-8">
      <h1 className="text-xl font-semibold">{title}</h1>
      <p className="mt-2 text-sm leading-6 text-white/60">{message}</p>
      {actionLabel && onAction && (
        <button
          type="button"
          onClick={onAction}
          className="mt-5 min-h-11 rounded-xl bg-white px-5 py-3 text-sm font-semibold text-black transition hover:bg-white/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-300"
        >
          {actionLabel}
        </button>
      )}
      {!actionLabel && (
        <Link
          href="/admin/workshops"
          className="mt-5 inline-flex min-h-11 items-center justify-center rounded-xl bg-white px-5 py-3 text-sm font-semibold text-black transition hover:bg-white/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-300"
        >
          Înapoi la Service-uri
        </Link>
      )}
    </div>
  );
}
