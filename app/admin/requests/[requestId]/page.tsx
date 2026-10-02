"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  getAffectedPartLabels,
  getDamageTypeLabels,
  isStructuredServiceDetails,
} from "@/lib/car-damage";
import { getDamageTypeLabel } from "@/lib/displayLabels";
import { getMechanicalServiceDetailGroups } from "@/lib/mechanical/mechanical-service-details";
import { supabase } from "@/lib/supabase/client";
import type { RepairServiceDetails } from "@/lib/supabase/repair-requests";
import {
  formatTowingRouteDistance,
  formatTowingRouteDuration,
} from "@/lib/towing/towing-display";
import { getWheelsDisplaySummary } from "@/lib/wheels/wheels-display";
import {
  isWheelsServiceDetailsV1,
  WHEEL_GENERAL_ISSUES,
  WHEEL_ISSUES,
  WHEEL_POSITIONS,
  WHEEL_SERVICES,
} from "@/lib/wheels/wheels-service-details";
import { formatProgressStatus } from "@/lib/work-progress/workflows";

type RequestStatus =
  | "open"
  | "matched"
  | "in_progress"
  | "completed"
  | "closed";
type RequestCategory = "bodywork" | "mechanical" | "wheels" | "towing";
type RequestType = "repair" | "direct_request";
type LoadState =
  | { status: "loading" }
  | { status: "ready"; detail: AdminRequestDetail }
  | { status: "unavailable" }
  | { status: "error" };

type SanitizedRequestImage = {
  url?: string | null;
  thumb_url?: string | null;
};

type ProgressTimelineEntry = {
  status?: string | null;
  created_at?: string | null;
};

type AdminRequestDetail = {
  request_id: string;
  category: RequestCategory;
  request_type: RequestType;
  request_status: RequestStatus;
  created_at: string;
  customer_display_name: string | null;
  city: string | null;
  car_brand: string | null;
  car_model: string | null;
  car_year: string | null;
  license_plate: string | null;
  damage_type: string | null;
  service_details: unknown;
  description: string | null;
  request_images: unknown;
  target_workshop_name: string | null;
  accepted_workshop_name: string | null;
  accepted_offer_price: string | null;
  accepted_offer_days: string | null;
  appointment_status: string | null;
  appointment_date: string | null;
  appointment_time: string | null;
  appointment_original_date: string | null;
  appointment_original_time: string | null;
  appointment_proposed_date: string | null;
  appointment_proposed_time: string | null;
  handover_method: string | null;
  latest_progress_status: string | null;
  progress_update_count: number | string | null;
  view_count: number | string | null;
  latest_progress_at: string | null;
  completion_timestamp: string | null;
  progress_timeline: unknown;
  towing_schedule_type: string | null;
  towing_requested_at: string | null;
  route_distance_meters: number | null;
  route_duration_seconds: number | null;
};

type SanitizedTowingDetails = {
  pickupCity: string | null;
  destinationCity: string | null;
  reason: string | null;
  starts: boolean | null;
  canBePushed: boolean | null;
  wheels: string | null;
};

const STATUS_LABELS: Record<RequestStatus, string> = {
  open: "Deschisă",
  matched: "Potrivită",
  in_progress: "În lucru",
  completed: "Finalizată",
  closed: "Închisă",
};

const CATEGORY_LABELS: Record<RequestCategory, string> = {
  bodywork: "Daună estetică",
  mechanical: "Problemă mecanică",
  wheels: "Roți și anvelope",
  towing: "Tractare auto",
};

const APPOINTMENT_STATUS_LABELS: Record<string, string> = {
  requested: "Solicitată",
  workshop_proposed: "Propusă de service",
  customer_proposed: "Propusă de client",
  confirmed: "Confirmată",
  declined: "Refuzată",
  cancelled: "Anulată",
};

const HANDOVER_LABELS: Record<string, string> = {
  customer_dropoff: "Predare de către client",
  workshop_pickup: "Preluare de către service",
};

const TOWING_REASON_LABELS: Record<string, string> = {
  breakdown: "Defecțiune",
  accident: "Accident",
  flat_tire: "Pană",
  other: "Alt motiv",
};

const TOWING_WHEEL_LABELS: Record<string, string> = {
  free: "Roți libere",
  blocked: "Roți blocate",
  unknown: "Stare necunoscută",
};

const DATE_TIME_FORMATTER = new Intl.DateTimeFormat("ro-RO", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

const DATE_FORMATTER = new Intl.DateTimeFormat("ro-RO", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function restoreSanitizedWheelsPartsSupply(value: unknown): unknown {
  if (
    !isRecord(value) ||
    value.version !== 2 ||
    value.kind !== "wheels" ||
    !isRecord(value.partsSupply)
  ) {
    return value;
  }

  const hasTireSupply = Object.hasOwn(value.partsSupply, "tire");
  const hasRimSupply = Object.hasOwn(value.partsSupply, "rim");

  if (hasTireSupply && hasRimSupply) return value;

  return {
    ...value,
    partsSupply: {
      ...value.partsSupply,
      ...(hasTireSupply ? {} : { tire: null }),
      ...(hasRimSupply ? {} : { rim: null }),
    },
  };
}

function asTrimmedString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asSafeImageUrl(value: unknown): string | null {
  const candidate = asTrimmedString(value);
  if (!candidate) return null;

  try {
    const parsed = new URL(candidate);
    return parsed.protocol === "https:" || parsed.protocol === "http:"
      ? parsed.toString()
      : null;
  } catch {
    return null;
  }
}

function isUnauthorizedError(error: { code?: string } | null): boolean {
  return error?.code === "42501";
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function formatDateTime(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : DATE_TIME_FORMATTER.format(date);
}

function formatDate(value: string | null): string | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const date = match
    ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
    : new Date(value);
  return Number.isNaN(date.getTime()) ? null : DATE_FORMATTER.format(date);
}

function formatTime(value: string | null): string | null {
  if (!value) return null;
  const match = /^(\d{2}):(\d{2})/.exec(value);
  return match ? `${match[1]}:${match[2]}` : null;
}

function toNonNegativeInteger(value: number | string | null): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 0;
}

function normalizeImages(value: unknown): SanitizedRequestImage[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((item) => {
    if (!isRecord(item)) return [];
    const url = asSafeImageUrl(item.url);
    const thumbUrl = asSafeImageUrl(item.thumb_url);
    return url || thumbUrl ? [{ url, thumb_url: thumbUrl }] : [];
  });
}

function normalizeTimeline(value: unknown): ProgressTimelineEntry[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((item) => {
    if (!isRecord(item)) return [];
    const status = asTrimmedString(item.status);
    const createdAt = asTrimmedString(item.created_at);
    return status && createdAt ? [{ status, created_at: createdAt }] : [];
  });
}

function getSanitizedTowingDetails(value: unknown): SanitizedTowingDetails | null {
  if (!isRecord(value) || value.kind !== "towing") return null;

  const pickup = isRecord(value.pickup) ? value.pickup : null;
  const destination = isRecord(value.destination) ? value.destination : null;
  const condition = isRecord(value.vehicleCondition)
    ? value.vehicleCondition
    : null;

  return {
    pickupCity: asTrimmedString(pickup?.city),
    destinationCity: asTrimmedString(destination?.city),
    reason: asTrimmedString(value.reason),
    starts: typeof condition?.starts === "boolean" ? condition.starts : null,
    canBePushed:
      typeof condition?.canBePushed === "boolean"
        ? condition.canBePushed
        : null,
    wheels: asTrimmedString(condition?.wheels),
  };
}

export default function AdminRequestDetailPage() {
  const params = useParams<{ requestId: string }>();
  const router = useRouter();
  const requestGenerationRef = useRef(0);
  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });
  const requestId = params.requestId;

  const loadDetail = useCallback(async () => {
    const generation = ++requestGenerationRef.current;
    const isCurrentRequest = () => requestGenerationRef.current === generation;
    setLoadState({ status: "loading" });

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

      if (!isUuid(requestId)) {
        setLoadState({ status: "unavailable" });
        return;
      }

      const { data, error } = await supabase
        .rpc("get_admin_request_detail", { p_request_id: requestId })
        .maybeSingle<AdminRequestDetail>();

      if (!isCurrentRequest()) return;

      if (isUnauthorizedError(error)) {
        router.replace("/");
        return;
      }

      if (error) throw error;

      if (!data) {
        setLoadState({ status: "unavailable" });
        return;
      }

      setLoadState({ status: "ready", detail: data });
    } catch {
      if (isCurrentRequest()) setLoadState({ status: "error" });
    }
  }, [requestId, router]);

  useEffect(() => {
    void loadDetail();
    return () => {
      requestGenerationRef.current += 1;
    };
  }, [loadDetail]);

  if (loadState.status === "loading") {
    return (
      <PageShell>
        <div className="flex min-h-64 items-center justify-center" role="status">
          <p className="text-white/60">Se încarcă detaliile cererii...</p>
        </div>
      </PageShell>
    );
  }

  if (loadState.status === "error") {
    return (
      <PageShell>
        <StateCard
          title="Detalii indisponibile"
          message="Datele nu au putut fi încărcate. Încearcă din nou."
          action={
            <button
              type="button"
              onClick={() => void loadDetail()}
              className="mt-5 min-h-11 rounded-xl bg-white px-5 py-3 text-sm font-semibold text-black transition hover:bg-white/90"
            >
              Reîncearcă
            </button>
          }
        />
      </PageShell>
    );
  }

  if (loadState.status === "unavailable") {
    return (
      <PageShell>
        <StateCard
          title="Cererea nu este disponibilă."
          message="Revino la directorul de cereri și lucrări."
        />
      </PageShell>
    );
  }

  return <RequestDetailContent detail={loadState.detail} />;
}

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-black px-4 pb-16 pt-6 text-white sm:px-6 sm:py-10">
      <div className="mx-auto max-w-6xl">
        <BackLink />
        {children}
      </div>
    </main>
  );
}

function BackLink() {
  return (
    <Link
      href="/admin/requests"
      className="inline-flex min-h-11 items-center rounded-full border border-white/15 px-4 py-2 text-sm font-semibold text-white/80 transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400/70"
    >
      ← Înapoi la cereri
    </Link>
  );
}

function StateCard({
  title,
  message,
  action,
}: {
  title: string;
  message: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="mt-8 rounded-3xl border border-white/10 bg-white/5 p-7 text-center">
      <h1 className="text-xl font-semibold">{title}</h1>
      <p className="mt-2 text-sm text-white/60">{message}</p>
      {action}
    </div>
  );
}

function RequestDetailContent({ detail }: { detail: AdminRequestDetail }) {
  const images = normalizeImages(detail.request_images);
  const timeline = normalizeTimeline(detail.progress_timeline);
  const createdAt = formatDateTime(detail.created_at) ?? "Dată indisponibilă";
  const progressCount = Number(detail.progress_update_count ?? 0);
  const safeProgressCount = Number.isFinite(progressCount) ? progressCount : 0;
  const viewCount = toNonNegativeInteger(detail.view_count);

  return (
    <main className="min-h-screen bg-black px-4 pb-16 pt-6 text-white sm:px-6 sm:py-10">
      <div className="mx-auto max-w-6xl">
        <BackLink />

        <header className="mt-7">
          <p className="text-xs uppercase tracking-[0.24em] text-orange-400">
            Admin · Read-only
          </p>
          <div className="mt-2 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h1 className="text-3xl font-bold sm:text-4xl">Detalii cerere</h1>
              <p className="mt-3 text-sm text-white/55">Creată la {createdAt}</p>
            </div>
            <div className="flex flex-wrap gap-2 sm:max-w-[55%] sm:justify-end">
              <Badge>{CATEGORY_LABELS[detail.category] ?? "Categorie"}</Badge>
              <Badge>{detail.request_type === "direct_request" ? "Cerere directă" : "Marketplace"}</Badge>
              <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${getStatusBadgeClass(detail.request_status)}`}>
                {STATUS_LABELS[detail.request_status] ?? "Status disponibil"}
              </span>
            </div>
          </div>
        </header>

        <div className="mt-8 grid gap-5 lg:grid-cols-2">
          <Section title="Client">
            <DetailsGrid>
              <Detail label="Nume afișat" value={detail.customer_display_name} />
              <Detail label="Oraș" value={detail.city} />
            </DetailsGrid>
          </Section>

          <Section title="Mașină">
            <DetailsGrid>
              <Detail label="Marcă" value={detail.car_brand} />
              <Detail label="Model" value={detail.car_model} />
              <Detail label="An" value={detail.car_year} />
              <Detail label="Nr. înmatriculare" value={detail.license_plate} />
            </DetailsGrid>
          </Section>
        </div>

        <div className="mt-5">
          <Section title="Cererea">
            <DetailsGrid>
              <Detail label="Categorie" value={CATEGORY_LABELS[detail.category]} />
              <Detail
                label="Tip"
                value={detail.request_type === "direct_request" ? "Cerere directă" : "Marketplace"}
              />
              <Detail label="Status" value={STATUS_LABELS[detail.request_status]} />
              <Detail
                label="Tip daună / problemă"
                value={
                  detail.category === "towing"
                    ? CATEGORY_LABELS.towing
                    : getDamageTypeLabel(detail.damage_type) || null
                }
              />
            </DetailsGrid>
            <div className="mt-5 border-t border-white/10 pt-5">
              <h3 className="text-sm font-semibold text-white/50">Descriere</h3>
              <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-white/80">
                {detail.description?.trim() || "Nu a fost furnizată o descriere."}
              </p>
            </div>
            <ServiceDetails detail={detail} />
          </Section>
        </div>

        <div className="mt-5">
          <Section title="Fotografii">
            {images.length > 0 ? (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {images.map((image, index) => {
                  const source = image.thumb_url || image.url;
                  if (!source) return null;
                  return (
                    <a
                      key={`${source}-${index}`}
                      href={image.url || source}
                      target="_blank"
                      rel="noreferrer"
                      className="group relative aspect-square min-w-0 overflow-hidden rounded-2xl border border-white/10 bg-white/5"
                    >
                      <Image
                        src={source}
                        alt={`Fotografie cerere ${index + 1}`}
                        fill
                        unoptimized
                        sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
                        className="object-cover transition duration-200 group-hover:scale-[1.03]"
                      />
                    </a>
                  );
                })}
              </div>
            ) : (
              <EmptyText>Nu există fotografii pentru această cerere.</EmptyText>
            )}
          </Section>
        </div>

        <div className="mt-5 grid gap-5 lg:grid-cols-2">
          <WorkshopAndOffer detail={detail} />
          <Appointment detail={detail} />
        </div>

        <div className="mt-5">
          <Section title="Progres">
            <DetailsGrid>
              <Detail
                label="Ultimul status"
                value={formatProgressStatus(detail.latest_progress_status) || null}
              />
              <Detail label="Actualizări progres" value={String(safeProgressCount)} />
              <Detail label="Vizualizări" value={String(viewCount)} />
              <Detail label="Ultima actualizare" value={formatDateTime(detail.latest_progress_at)} />
              <Detail label="Finalizare" value={formatDateTime(detail.completion_timestamp)} />
            </DetailsGrid>
            {timeline.length > 0 && (
              <ol className="mt-6 space-y-3 border-t border-white/10 pt-5">
                {timeline.map((entry, index) => (
                  <li key={`${entry.created_at}-${index}`} className="flex min-w-0 gap-3">
                    <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-orange-400" />
                    <div className="min-w-0">
                      <p className="break-words text-sm font-semibold text-white/85">
                        {formatProgressStatus(entry.status) || "Status indisponibil"}
                      </p>
                      <p className="mt-1 text-xs text-white/45">{formatDateTime(entry.created_at ?? null) ?? "Dată indisponibilă"}</p>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </Section>
        </div>
      </div>
    </main>
  );
}

function ServiceDetails({ detail }: { detail: AdminRequestDetail }) {
  const serviceDetails = detail.service_details as RepairServiceDetails | null;

  if (detail.category === "mechanical") {
    const groups = getMechanicalServiceDetailGroups(detail.service_details);
    return (
      <DetailsBlock title="Probleme selectate">
        {groups.length > 0 ? groups.map((group) => (
          <LabelGroup key={group.category} title={group.categoryLabel} labels={group.symptomLabels} />
        )) : <MalformedFallback />}
      </DetailsBlock>
    );
  }

  if (detail.category === "wheels") {
    const wheelsDetails = restoreSanitizedWheelsPartsSupply(
      detail.service_details,
    );
    const summary = getWheelsDisplaySummary(wheelsDetails);
    if (summary) {
      return (
        <DetailsBlock title="Servicii roți și anvelope">
          <p className="mb-4 text-sm text-white/65">Dimensiune: {summary.wheelSizeLabel}</p>
          {summary.groups.map((group) => (
            <LabelGroup
              key={group.key}
              title={group.title}
              labels={[...group.serviceLabels, ...(group.supplyLabel ? [group.supplyLabel] : [])]}
            />
          ))}
        </DetailsBlock>
      );
    }

    if (isWheelsServiceDetailsV1(detail.service_details)) {
      return <LegacyWheelsDetails value={detail.service_details} />;
    }

    return <DetailsBlock title="Servicii roți și anvelope"><MalformedFallback /></DetailsBlock>;
  }

  if (detail.category === "towing") {
    return <TowingDetails detail={detail} />;
  }

  const structured = isStructuredServiceDetails(serviceDetails);
  const serviceIds = structured
    ? serviceDetails.selectedServices
    : Array.isArray(serviceDetails)
      ? serviceDetails.filter((item): item is string => typeof item === "string")
      : [];
  const parts = getAffectedPartLabels(serviceDetails);
  const damages = getDamageTypeLabels(serviceDetails);
  const damageLabelSet = new Set(
    damages.map((label) => label.toLocaleLowerCase("ro-RO")),
  );
  const serviceLabels = serviceIds
    .map(getDamageTypeLabel)
    .filter(Boolean)
    .filter(
      (label) =>
        !structured ||
        !damageLabelSet.has(label.toLocaleLowerCase("ro-RO")),
    );

  return (
    <DetailsBlock title="Servicii și daune selectate">
      {serviceLabels.length > 0 && <LabelGroup title="Servicii" labels={serviceLabels} />}
      {parts.length > 0 && <LabelGroup title="Elemente afectate" labels={parts} />}
      {damages.length > 0 && <LabelGroup title="Tip daună" labels={damages} />}
      {serviceLabels.length === 0 && parts.length === 0 && damages.length === 0 && <MalformedFallback />}
    </DetailsBlock>
  );
}

function LegacyWheelsDetails({ value }: { value: Parameters<typeof isWheelsServiceDetailsV1>[0] }) {
  if (!isWheelsServiceDetailsV1(value)) return null;
  const positionLabels = new Map(WHEEL_POSITIONS.map((item) => [item.id, item.label]));
  const issueLabels = new Map(WHEEL_ISSUES.map((item) => [item.id, item.label]));
  const generalLabels = new Map(WHEEL_GENERAL_ISSUES.map((item) => [item.id, item.label]));
  const serviceLabels = new Map(WHEEL_SERVICES.map((item) => [item.id, item.label]));

  return (
    <DetailsBlock title="Servicii roți și anvelope">
      {value.selectedWheels.length > 0 && <LabelGroup title="Roți selectate" labels={value.selectedWheels.map((id) => positionLabels.get(id) ?? id)} />}
      {Object.entries(value.issuesByWheel).map(([position, issues]) => (
        <LabelGroup key={position} title={positionLabels.get(position as keyof typeof value.issuesByWheel) ?? position} labels={(issues ?? []).map((id) => issueLabels.get(id) ?? id)} />
      ))}
      {value.generalIssues.length > 0 && <LabelGroup title="Probleme generale" labels={value.generalIssues.map((id) => generalLabels.get(id) ?? id)} />}
      {value.services.length > 0 && <LabelGroup title="Servicii" labels={value.services.map((id) => serviceLabels.get(id) ?? id)} />}
    </DetailsBlock>
  );
}

function TowingDetails({ detail }: { detail: AdminRequestDetail }) {
  const towing = getSanitizedTowingDetails(detail.service_details);
  const hasRoute =
    typeof detail.route_distance_meters === "number" && detail.route_distance_meters >= 0 &&
    typeof detail.route_duration_seconds === "number" && detail.route_duration_seconds >= 0;

  return (
    <DetailsBlock title="Detalii tractare">
      {towing ? (
        <DetailsGrid>
          <Detail label="Oraș preluare" value={towing.pickupCity} />
          <Detail label="Oraș destinație" value={towing.destinationCity} />
          <Detail label="Motiv" value={towing.reason ? TOWING_REASON_LABELS[towing.reason] ?? "Motiv disponibil" : null} />
          <Detail label="Pornire vehicul" value={towing.starts === null ? null : towing.starts ? "Pornește" : "Nu pornește"} />
          <Detail label="Poate fi împins" value={towing.canBePushed === null ? null : towing.canBePushed ? "Da" : "Nu"} />
          <Detail label="Stare roți" value={towing.wheels ? TOWING_WHEEL_LABELS[towing.wheels] ?? "Stare disponibilă" : null} />
          <Detail label="Programare" value={detail.towing_schedule_type === "asap" ? "Cât mai repede" : detail.towing_schedule_type === "scheduled" ? "Programată" : null} />
          <Detail label="Data solicitată" value={formatDateTime(detail.towing_requested_at)} />
          {hasRoute && <Detail label="Distanță" value={formatTowingRouteDistance(detail.route_distance_meters!)} />}
          {hasRoute && <Detail label="Durată estimată" value={formatTowingRouteDuration(detail.route_duration_seconds!)} />}
        </DetailsGrid>
      ) : <MalformedFallback />}
    </DetailsBlock>
  );
}

function WorkshopAndOffer({ detail }: { detail: AdminRequestDetail }) {
  const hasContent = detail.target_workshop_name || detail.accepted_workshop_name || detail.accepted_offer_price || detail.accepted_offer_days;
  return (
    <Section title="Service și ofertă">
      {hasContent ? (
        <DetailsGrid>
          {detail.request_type === "direct_request" && <Detail label="Service solicitat" value={detail.target_workshop_name} />}
          <Detail label="Service acceptat" value={detail.accepted_workshop_name} />
          <Detail label="Preț comunicat" value={detail.accepted_offer_price} />
          <Detail label="Durată estimată" value={detail.accepted_offer_days ? `${detail.accepted_offer_days} zile` : null} />
        </DetailsGrid>
      ) : <EmptyText>Nu există încă un service sau o ofertă acceptată.</EmptyText>}
    </Section>
  );
}

function Appointment({ detail }: { detail: AdminRequestDetail }) {
  const hasAppointment = detail.appointment_status || detail.appointment_date || detail.appointment_time || detail.appointment_proposed_date || detail.appointment_proposed_time;
  return (
    <Section title="Programare">
      {hasAppointment ? (
        <DetailsGrid>
          <Detail label="Status" value={detail.appointment_status ? APPOINTMENT_STATUS_LABELS[detail.appointment_status] ?? "Status disponibil" : null} />
          <Detail label="Data" value={formatDate(detail.appointment_date)} />
          <Detail label="Ora" value={formatTime(detail.appointment_time)} />
          <Detail label="Data inițială" value={formatDate(detail.appointment_original_date)} />
          <Detail label="Ora inițială" value={formatTime(detail.appointment_original_time)} />
          <Detail label="Data propusă" value={formatDate(detail.appointment_proposed_date)} />
          <Detail label="Ora propusă" value={formatTime(detail.appointment_proposed_time)} />
          <Detail label="Predare" value={detail.handover_method ? HANDOVER_LABELS[detail.handover_method] ?? "Metodă disponibilă" : null} />
        </DetailsGrid>
      ) : <EmptyText>Nu există o programare asociată.</EmptyText>}
    </Section>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="min-w-0 rounded-3xl border border-white/10 bg-white/[0.05] p-5 shadow-lg sm:p-6">
      <h2 className="text-lg font-semibold text-white">{title}</h2>
      <div className="mt-5">{children}</div>
    </section>
  );
}

function DetailsBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-5 border-t border-white/10 pt-5">
      <h3 className="text-sm font-semibold text-white/50">{title}</h3>
      <div className="mt-3 space-y-4">{children}</div>
    </div>
  );
}

function DetailsGrid({ children }: { children: React.ReactNode }) {
  return <dl className="grid min-w-0 gap-4 sm:grid-cols-2">{children}</dl>;
}

function Detail({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="min-w-0 rounded-2xl bg-black/25 p-4">
      <dt className="text-xs font-semibold uppercase tracking-wide text-white/40">{label}</dt>
      <dd className="mt-2 break-words text-sm font-semibold text-white/80">{value?.trim() || "—"}</dd>
    </div>
  );
}

function LabelGroup({ title, labels }: { title: string; labels: string[] }) {
  if (labels.length === 0) return null;
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-white/40">{title}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {labels.map((label, index) => (
          <span key={`${label}-${index}`} className="max-w-full break-words rounded-full border border-white/10 bg-white/[0.06] px-3 py-1.5 text-xs text-white/75">
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}

function Badge({ children }: { children: React.ReactNode }) {
  return <span className="rounded-full border border-white/15 bg-white/[0.05] px-3 py-1 text-xs font-semibold text-white/75">{children}</span>;
}

function EmptyText({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-white/50">{children}</p>;
}

function MalformedFallback() {
  return <EmptyText>Detaliile structurate nu sunt disponibile.</EmptyText>;
}

function getStatusBadgeClass(status: RequestStatus) {
  switch (status) {
    case "open": return "border-blue-400/40 bg-blue-500/15 text-blue-200";
    case "matched": return "border-yellow-400/40 bg-yellow-500/15 text-yellow-200";
    case "in_progress": return "border-orange-400/50 bg-orange-500/15 text-orange-300";
    case "completed": return "border-green-400/40 bg-green-500/15 text-green-200";
    case "closed": return "border-white/15 bg-white/[0.05] text-white/55";
  }
}
