"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";

type NumericValue = number | string | null;
type RequestStatus =
  | "open"
  | "matched"
  | "in_progress"
  | "completed"
  | "closed";
type RequestCategory = "bodywork" | "mechanical" | "wheels" | "towing";
type RequestType = "repair" | "direct_request";

type AdminCustomerDetail = {
  customer_id: string;
  display_name: string | null;
  city: string | null;
  profile_created_at: string;
  total_requests: NumericValue;
  open_requests: NumericValue;
  in_progress_jobs: NumericValue;
  completed_jobs: NumericValue;
};

type AdminCustomerRequest = {
  request_id: string;
  category: RequestCategory;
  status: RequestStatus;
  request_type: RequestType;
  created_at: string;
  workshop_name: string | null;
  accepted_offer_price: string | null;
  appointment_status: string | null;
  appointment_date: string | null;
  appointment_time: string | null;
};

type ProfileState =
  | { status: "loading" }
  | { status: "ready"; detail: AdminCustomerDetail }
  | { status: "unavailable" }
  | { status: "error" };
type HistoryStatus = "loading" | "ready" | "error";
type Cursor = { createdAt: string; requestId: string };

const PAGE_SIZE = 25;
const REQUEST_LIMIT = PAGE_SIZE + 1;

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

const INTEGER_FORMATTER = new Intl.NumberFormat("ro-RO", {
  maximumFractionDigits: 0,
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

function formatDateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Dată indisponibilă" : DATE_TIME_FORMATTER.format(date);
}

function formatDate(value: string): string {
  const dateOnlyMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const date = dateOnlyMatch
    ? new Date(
        Number(dateOnlyMatch[1]),
        Number(dateOnlyMatch[2]) - 1,
        Number(dateOnlyMatch[3]),
      )
    : new Date(value);

  return Number.isNaN(date.getTime()) ? value : DATE_FORMATTER.format(date);
}

function formatTime(value: string): string {
  const match = /^(\d{2}):(\d{2})/.exec(value);
  return match ? `${match[1]}:${match[2]}` : value;
}

function deduplicateRequests(rows: AdminCustomerRequest[]) {
  return Array.from(new Map(rows.map((row) => [row.request_id, row])).values());
}

export default function AdminCustomerDetailPage() {
  const params = useParams<{ customerId: string }>();
  const router = useRouter();
  const customerId = params.customerId;
  const [profileState, setProfileState] = useState<ProfileState>({ status: "loading" });
  const [historyStatus, setHistoryStatus] = useState<HistoryStatus>("loading");
  const [requests, setRequests] = useState<AdminCustomerRequest[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<Cursor | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState(false);
  const [retryGeneration, setRetryGeneration] = useState(0);
  const requestGenerationRef = useRef(0);
  const loadingMoreRef = useRef(false);

  const loadHistory = useCallback(
    async ({
      append,
      cursor,
      generation,
    }: {
      append: boolean;
      cursor: Cursor | null;
      generation: number;
    }) => {
      const isCurrentRequest = () => requestGenerationRef.current === generation;

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

        const { data, error } = await supabase.rpc("get_admin_customer_requests", {
          p_customer_id: customerId,
          p_cursor_created_at: cursor?.createdAt ?? null,
          p_cursor_request_id: cursor?.requestId ?? null,
          p_limit: REQUEST_LIMIT,
        });

        if (!isCurrentRequest()) return;
        if (isUnauthorizedError(error)) {
          router.replace("/");
          return;
        }
        if (error || !data) {
          throw error ?? new Error("Customer history is unavailable.");
        }

        const result = data as AdminCustomerRequest[];
        const visibleRows = result.slice(0, PAGE_SIZE);
        const lastVisibleRow = visibleRows.at(-1) ?? null;

        setRequests((current) =>
          append
            ? deduplicateRequests([...current, ...visibleRows])
            : visibleRows,
        );
        setHasMore(result.length > PAGE_SIZE);
        setNextCursor(
          lastVisibleRow
            ? {
                createdAt: lastVisibleRow.created_at,
                requestId: lastVisibleRow.request_id,
              }
            : null,
        );
        setLoadMoreError(false);
        setHistoryStatus("ready");
      } catch {
        if (!isCurrentRequest()) return;

        if (append) {
          setLoadMoreError(true);
        } else {
          setRequests([]);
          setHasMore(false);
          setNextCursor(null);
          setHistoryStatus("error");
        }
      } finally {
        if (append && isCurrentRequest()) {
          loadingMoreRef.current = false;
          setLoadingMore(false);
        }
      }
    },
    [customerId, router],
  );

  useEffect(() => {
    const generation = ++requestGenerationRef.current;
    loadingMoreRef.current = false;
    setProfileState({ status: "loading" });
    setHistoryStatus("loading");
    setRequests([]);
    setHasMore(false);
    setNextCursor(null);
    setLoadingMore(false);
    setLoadMoreError(false);

    if (!customerId || !isUuid(customerId)) {
      setProfileState({ status: "unavailable" });
      setHistoryStatus("ready");
      return () => {
        requestGenerationRef.current += 1;
      };
    }

    const loadProfile = async () => {
      const isCurrentRequest = () => requestGenerationRef.current === generation;

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

        const { data, error } = await supabase.rpc("get_admin_customer_detail", {
          p_customer_id: customerId,
        });

        if (!isCurrentRequest()) return;
        if (isUnauthorizedError(error)) {
          router.replace("/");
          return;
        }
        if (error || !data) {
          throw error ?? new Error("Customer detail is unavailable.");
        }

        const detail = (data as AdminCustomerDetail[])[0] ?? null;
        setProfileState(
          detail ? { status: "ready", detail } : { status: "unavailable" },
        );
      } catch {
        if (isCurrentRequest()) setProfileState({ status: "error" });
      }
    };

    void loadProfile();
    void loadHistory({ append: false, cursor: null, generation });

    return () => {
      requestGenerationRef.current += 1;
      loadingMoreRef.current = false;
    };
  }, [customerId, loadHistory, retryGeneration, router]);

  const loadMoreRequests = () => {
    if (!nextCursor || !hasMore || loadingMoreRef.current) return;

    loadingMoreRef.current = true;
    setLoadingMore(true);
    setLoadMoreError(false);

    void loadHistory({
      append: true,
      cursor: nextCursor,
      generation: requestGenerationRef.current,
    });
  };

  const retryHistory = () => {
    const generation = ++requestGenerationRef.current;
    loadingMoreRef.current = false;
    setHistoryStatus("loading");
    setRequests([]);
    setHasMore(false);
    setNextCursor(null);
    setLoadingMore(false);
    setLoadMoreError(false);
    void loadHistory({ append: false, cursor: null, generation });
  };

  return (
    <main className="min-h-screen overflow-x-hidden bg-black px-4 pb-16 pt-6 text-white sm:px-6 sm:py-10">
      <div className="mx-auto max-w-6xl">
        <Link
          href="/admin/customers"
          className="inline-flex min-h-11 items-center rounded-full border border-white/15 px-4 py-2 text-sm font-semibold text-white/80 transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400/70"
        >
          ← Înapoi la Clienți
        </Link>

        {profileState.status === "loading" && (
          <div className="flex min-h-64 items-center justify-center" role="status">
            <p className="text-white/60">Se încarcă detaliile clientului...</p>
          </div>
        )}

        {profileState.status === "error" && (
          <StateCard
            title="Detalii indisponibile"
            message="Profilul clientului nu a putut fi încărcat."
            actionLabel="Reîncearcă"
            onAction={() => setRetryGeneration((current) => current + 1)}
          />
        )}

        {profileState.status === "unavailable" && (
          <StateCard
            title="Clientul nu a fost găsit"
            message="Profilul solicitat nu este disponibil."
          />
        )}

        {profileState.status === "ready" && (
          <>
            <CustomerHeader detail={profileState.detail} />
            <CustomerSummary detail={profileState.detail} />

            <section className="mt-8" aria-labelledby="customer-activity-title">
              <div>
                <p className="text-xs uppercase tracking-[0.22em] text-orange-400">
                  Activitate
                </p>
                <h2 id="customer-activity-title" className="mt-2 text-2xl font-bold">
                  Istoric activitate
                </h2>
              </div>

              {historyStatus === "loading" && (
                <div className="flex min-h-48 items-center justify-center" role="status">
                  <p className="text-white/60">Se încarcă istoricul...</p>
                </div>
              )}

              {historyStatus === "error" && (
                <StateCard
                  title="Istoric indisponibil"
                  message="Activitatea clientului nu a putut fi încărcată."
                  actionLabel="Reîncearcă"
                  onAction={retryHistory}
                />
              )}

              {historyStatus === "ready" && requests.length === 0 && (
                <div className="mt-5 rounded-3xl border border-white/10 bg-white/5 p-8 text-center">
                  <h3 className="text-lg font-semibold">Nu există activitate</h3>
                  <p className="mt-2 text-sm text-white/55">
                    Clientul nu are cereri business eligibile.
                  </p>
                </div>
              )}

              {historyStatus === "ready" && requests.length > 0 && (
                <>
                  <div className="mt-5 grid min-w-0 gap-4 lg:grid-cols-2">
                    {requests.map((request) => (
                      <RequestCard key={request.request_id} request={request} />
                    ))}
                  </div>

                  {hasMore ? (
                    <div className="mt-5">
                      {loadMoreError && (
                        <p className="mb-3 text-center text-sm text-white/55" role="alert">
                          Următoarele rezultate nu au putut fi încărcate.
                        </p>
                      )}
                      <button
                        type="button"
                        onClick={loadMoreRequests}
                        disabled={loadingMore}
                        className="min-h-12 w-full rounded-2xl border border-white/15 bg-white/5 px-5 py-3 font-semibold text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {loadingMore
                          ? "Se încarcă..."
                          : loadMoreError
                            ? "Reîncearcă"
                            : "Încarcă mai multe"}
                      </button>
                    </div>
                  ) : (
                    <p className="mt-5 text-center text-sm text-white/40">
                      Ai ajuns la finalul istoricului.
                    </p>
                  )}
                </>
              )}
            </section>
          </>
        )}
      </div>
    </main>
  );
}

function CustomerHeader({ detail }: { detail: AdminCustomerDetail }) {
  const displayName = detail.display_name?.trim() || "Client";
  const city = detail.city?.trim() || null;

  return (
    <header className="mt-7 min-w-0">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-[0.24em] text-orange-400">Admin</p>
          <h1 className="mt-2 break-words text-3xl font-bold sm:text-4xl">
            {displayName}
          </h1>
          {city && <p className="mt-2 break-words text-white/60">{city}</p>}
          <p className="mt-3 text-sm text-white/45">
            Înregistrat la {formatDateTime(detail.profile_created_at)}
          </p>
        </div>
        <span className="inline-flex min-h-10 w-fit items-center rounded-full border border-white/15 bg-white/5 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-white/60">
          Doar citire
        </span>
      </div>
    </header>
  );
}

function CustomerSummary({ detail }: { detail: AdminCustomerDetail }) {
  const metrics = [
    { label: "Total cereri", value: detail.total_requests },
    { label: "Cereri deschise", value: detail.open_requests },
    { label: "Lucrări în desfășurare", value: detail.in_progress_jobs },
    { label: "Lucrări finalizate", value: detail.completed_jobs },
  ];

  return (
    <section className="mt-8" aria-labelledby="customer-summary-title">
      <h2 id="customer-summary-title" className="sr-only">
        Rezumat activitate
      </h2>
      <dl className="grid min-w-0 grid-cols-2 gap-3 lg:grid-cols-4">
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
  );
}

function RequestCard({ request }: { request: AdminCustomerRequest }) {
  const workshopName = request.workshop_name?.trim() || null;
  const acceptedOfferPrice = request.accepted_offer_price?.trim() || null;
  const hasAppointment = Boolean(
    request.appointment_status || request.appointment_date || request.appointment_time,
  );

  return (
    <article className="min-w-0 rounded-3xl border border-white/10 bg-white/[0.05] p-5 shadow-lg sm:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-white/40">
            {request.request_type === "direct_request"
              ? "Cerere directă"
              : "Marketplace"}
          </p>
          <p className="mt-2 text-sm text-white/55">
            Creată la {formatDateTime(request.created_at)}
          </p>
        </div>
        <div className="flex flex-wrap gap-2 sm:max-w-[60%] sm:justify-end">
          <span className="rounded-full border border-white/15 bg-white/[0.05] px-3 py-1 text-xs font-semibold text-white/75">
            {CATEGORY_LABELS[request.category]}
          </span>
          <span
            className={`rounded-full border px-3 py-1 text-xs font-semibold ${getStatusBadgeClass(request.status)}`}
          >
            {STATUS_LABELS[request.status]}
          </span>
        </div>
      </div>

      <div className="mt-5 space-y-3 rounded-2xl bg-black/30 p-4 text-sm">
        <p className="break-words text-white/75">
          <span className="text-white/40">Service: </span>
          {workshopName ?? "Service nealocat"}
        </p>
        {acceptedOfferPrice && (
          <p className="break-words text-white/75">
            <span className="text-white/40">Ofertă acceptată: </span>
            {acceptedOfferPrice}
          </p>
        )}
      </div>

      {hasAppointment && (
        <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-orange-300">
            Programare
          </p>
          <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-3">
            {request.appointment_status && (
              <Detail
                label="Status"
                value={
                  APPOINTMENT_STATUS_LABELS[request.appointment_status] ??
                  "Status disponibil"
                }
              />
            )}
            {request.appointment_date && (
              <Detail label="Data" value={formatDate(request.appointment_date)} />
            )}
            {request.appointment_time && (
              <Detail label="Ora" value={formatTime(request.appointment_time)} />
            )}
          </dl>
        </div>
      )}

      <Link
        href={`/admin/requests/${request.request_id}`}
        className="mt-5 inline-flex min-h-11 w-full items-center justify-center rounded-2xl bg-orange-500 px-5 py-3 text-sm font-bold text-black transition hover:bg-orange-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-300"
      >
        Vezi detalii cerere
      </Link>
    </article>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-white/40">{label}</dt>
      <dd className="mt-1 break-words font-semibold text-white/80">{value}</dd>
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
    <div className="mt-8 rounded-3xl border border-white/10 bg-white/5 p-6 text-center">
      <h2 className="text-xl font-semibold">{title}</h2>
      <p className="mt-2 text-sm text-white/60">{message}</p>
      {actionLabel && onAction && (
        <button
          type="button"
          onClick={onAction}
          className="mt-5 min-h-11 rounded-xl bg-white px-5 py-3 text-sm font-semibold text-black transition hover:bg-white/90"
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}

function getStatusBadgeClass(status: RequestStatus) {
  switch (status) {
    case "open":
      return "border-blue-400/40 bg-blue-500/15 text-blue-200";
    case "matched":
      return "border-yellow-400/40 bg-yellow-500/15 text-yellow-200";
    case "in_progress":
      return "border-orange-400/50 bg-orange-500/15 text-orange-300";
    case "completed":
      return "border-green-400/40 bg-green-500/15 text-green-200";
    case "closed":
      return "border-white/15 bg-white/[0.05] text-white/55";
  }
}
