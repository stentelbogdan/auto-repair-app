"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";

type RequestStatus =
  | "open"
  | "matched"
  | "in_progress"
  | "completed"
  | "closed";
type RequestCategory = "bodywork" | "mechanical" | "wheels" | "towing";
type RequestType = "repair" | "direct_request";
type StatusFilter = "all" | RequestStatus;
type CategoryFilter = "all" | RequestCategory;
type SortOption = "created_at_desc" | "created_at_asc";
type SortDirection = "asc" | "desc";
type LoadStatus = "loading" | "ready" | "error";

type AdminRequestRow = {
  request_id: string;
  category: RequestCategory;
  status: RequestStatus;
  request_type: RequestType;
  created_at: string;
  customer_display_name: string | null;
  city: string | null;
  license_plate: string | null;
  workshop_name: string | null;
  accepted_offer_price: string | null;
  appointment_status: string | null;
  appointment_date: string | null;
  appointment_time: string | null;
};

type Cursor = {
  createdAt: string;
  id: string;
};

const PAGE_SIZE = 25;
const REQUEST_LIMIT = PAGE_SIZE + 1;

const STATUS_FILTERS: Array<{ value: StatusFilter; label: string }> = [
  { value: "all", label: "Toate statusurile" },
  { value: "open", label: "Deschise" },
  { value: "matched", label: "Potrivite" },
  { value: "in_progress", label: "În lucru" },
  { value: "completed", label: "Finalizate" },
  { value: "closed", label: "Închise" },
];

const CATEGORY_FILTERS: Array<{ value: CategoryFilter; label: string }> = [
  { value: "all", label: "Toate categoriile" },
  { value: "bodywork", label: "Daune estetice" },
  { value: "mechanical", label: "Probleme mecanice" },
  { value: "wheels", label: "Roți și anvelope" },
  { value: "towing", label: "Tractări auto" },
];

const SORT_OPTIONS: Array<{ value: SortOption; label: string }> = [
  { value: "created_at_desc", label: "Cele mai noi" },
  { value: "created_at_asc", label: "Cele mai vechi" },
];

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

const CREATED_AT_FORMATTER = new Intl.DateTimeFormat("ro-RO", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

const APPOINTMENT_DATE_FORMATTER = new Intl.DateTimeFormat("ro-RO", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

function isUnauthorizedError(error: { code?: string } | null): boolean {
  return error?.code === "42501";
}

function deduplicateRequests(rows: AdminRequestRow[]) {
  return Array.from(
    new Map(rows.map((row) => [row.request_id, row])).values(),
  );
}

function formatCreatedAt(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Dată indisponibilă"
    : CREATED_AT_FORMATTER.format(date);
}

function formatAppointmentDate(value: string) {
  const dateOnlyMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const date = dateOnlyMatch
    ? new Date(
        Number(dateOnlyMatch[1]),
        Number(dateOnlyMatch[2]) - 1,
        Number(dateOnlyMatch[3]),
      )
    : new Date(value);

  return Number.isNaN(date.getTime())
    ? value
    : APPOINTMENT_DATE_FORMATTER.format(date);
}

function formatAppointmentTime(value: string) {
  const timeMatch = /^(\d{2}):(\d{2})/.exec(value);
  return timeMatch ? `${timeMatch[1]}:${timeMatch[2]}` : value;
}

export default function AdminRequestsPage() {
  const router = useRouter();
  const [draftSearch, setDraftSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [categoryFilter, setCategoryFilter] =
    useState<CategoryFilter>("all");
  const [sortOption, setSortOption] =
    useState<SortOption>("created_at_desc");
  const [requests, setRequests] = useState<AdminRequestRow[]>([]);
  const [loadStatus, setLoadStatus] = useState<LoadStatus>("loading");
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<Cursor | null>(null);
  const requestGenerationRef = useRef(0);
  const querySignatureRef = useRef("");
  const loadingMoreRef = useRef(false);

  const direction: SortDirection =
    sortOption === "created_at_asc" ? "asc" : "desc";
  const querySignature = JSON.stringify({
    search: appliedSearch,
    status: statusFilter,
    category: categoryFilter,
    direction,
  });

  const loadRequests = useCallback(
    async ({
      append,
      cursor,
      generation,
      signature,
    }: {
      append: boolean;
      cursor: Cursor | null;
      generation: number;
      signature: string;
    }) => {
      const isCurrentRequest = () =>
        requestGenerationRef.current === generation &&
        querySignatureRef.current === signature;

      try {
        const {
          data: { session },
          error: sessionError,
        } = await supabase.auth.getSession();

        if (!isCurrentRequest()) return;

        if (sessionError) {
          throw sessionError;
        }

        if (!session) {
          router.replace("/login");
          return;
        }

        const { data, error } = await supabase.rpc("get_admin_requests", {
          p_search: appliedSearch.trim() || null,
          p_status: statusFilter === "all" ? null : statusFilter,
          p_category: categoryFilter === "all" ? null : categoryFilter,
          p_direction: direction,
          p_cursor_created_at: cursor?.createdAt ?? null,
          p_cursor_id: cursor?.id ?? null,
          p_limit: REQUEST_LIMIT,
        });

        if (!isCurrentRequest()) return;

        if (isUnauthorizedError(error)) {
          router.replace("/");
          return;
        }

        if (error || !data) {
          throw error ?? new Error("Admin requests are unavailable.");
        }

        const result = data as AdminRequestRow[];
        const visibleRows = result.slice(0, PAGE_SIZE);
        const lastVisibleRow = visibleRows.at(-1) ?? null;

        setRequests((current) =>
          append
            ? deduplicateRequests([...current, ...visibleRows])
            : visibleRows,
        );
        setHasMore(result.length > PAGE_SIZE);
        setLoadMoreError(false);
        setNextCursor(
          lastVisibleRow
            ? {
                createdAt: lastVisibleRow.created_at,
                id: lastVisibleRow.request_id,
              }
            : null,
        );
        setLoadStatus("ready");
      } catch {
        if (!isCurrentRequest()) return;

        if (!append) {
          setRequests([]);
          setHasMore(false);
          setNextCursor(null);
          setLoadStatus("error");
        } else {
          setLoadMoreError(true);
        }
      } finally {
        if (append && isCurrentRequest()) {
          loadingMoreRef.current = false;
          setLoadingMore(false);
        }
      }
    },
    [
      appliedSearch,
      categoryFilter,
      direction,
      router,
      statusFilter,
    ],
  );

  useEffect(() => {
    const generation = ++requestGenerationRef.current;
    querySignatureRef.current = querySignature;
    loadingMoreRef.current = false;
    setRequests([]);
    setHasMore(false);
    setNextCursor(null);
    setLoadingMore(false);
    setLoadMoreError(false);
    setLoadStatus("loading");

    void loadRequests({
      append: false,
      cursor: null,
      generation,
      signature: querySignature,
    });

    return () => {
      requestGenerationRef.current += 1;
    };
  }, [loadRequests, querySignature]);

  const handleSearchSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setAppliedSearch(draftSearch.trim());
  };

  const clearSearch = () => {
    setDraftSearch("");
    setAppliedSearch("");
  };

  const loadMoreRequests = () => {
    if (!nextCursor || !hasMore || loadingMoreRef.current) return;

    loadingMoreRef.current = true;
    setLoadingMore(true);
    setLoadMoreError(false);

    void loadRequests({
      append: true,
      cursor: nextCursor,
      generation: requestGenerationRef.current,
      signature: querySignatureRef.current,
    });
  };

  const retry = () => {
    const generation = ++requestGenerationRef.current;
    querySignatureRef.current = querySignature;
    setLoadStatus("loading");

    void loadRequests({
      append: false,
      cursor: null,
      generation,
      signature: querySignature,
    });
  };

  const hasActiveCriteria =
    appliedSearch.length > 0 ||
    statusFilter !== "all" ||
    categoryFilter !== "all";

  return (
    <main className="min-h-screen bg-black px-4 pb-16 pt-6 text-white sm:px-6 sm:py-10">
      <div className="mx-auto max-w-6xl">
        <Link
          href="/admin"
          className="inline-flex min-h-11 items-center rounded-full border border-white/15 px-4 py-2 text-sm font-semibold text-white/80 transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400/70"
        >
          ← Înapoi la Admin
        </Link>

        <header className="mt-7">
          <p className="text-xs uppercase tracking-[0.24em] text-orange-400">
            Admin
          </p>
          <h1 className="mt-2 text-3xl font-bold sm:text-4xl">
            Cereri și lucrări
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-white/60 sm:text-base">
            Director read-only pentru cererile și lucrările din marketplace.
          </p>
        </header>

        <section className="mt-8 space-y-4 rounded-3xl border border-white/10 bg-white/[0.04] p-4 sm:p-6">
          <form
            onSubmit={handleSearchSubmit}
            className="flex flex-col gap-3 sm:flex-row"
          >
            <label className="sr-only" htmlFor="admin-request-search">
              Caută cereri și lucrări
            </label>
            <input
              id="admin-request-search"
              type="search"
              value={draftSearch}
              maxLength={100}
              onChange={(event) => setDraftSearch(event.target.value)}
              placeholder="Caută client, service, oraș, categorie sau nr. înmatriculare"
              className="min-h-12 min-w-0 flex-1 rounded-2xl border border-white/15 bg-black/40 px-4 text-base text-white outline-none placeholder:text-white/35 focus:border-orange-400/70 focus:ring-2 focus:ring-orange-400/20"
            />
            <div className="grid grid-cols-2 gap-3 sm:flex">
              <button
                type="submit"
                className="min-h-12 rounded-2xl bg-orange-500 px-5 text-sm font-bold text-black transition hover:bg-orange-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-300"
              >
                Caută
              </button>
              <button
                type="button"
                onClick={clearSearch}
                disabled={!draftSearch && !appliedSearch}
                className="min-h-12 rounded-2xl border border-white/15 px-5 text-sm font-semibold text-white/75 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Șterge
              </button>
            </div>
          </form>

          <div className="grid gap-3 sm:grid-cols-3">
            <FilterSelect
              id="admin-request-status"
              label="Status"
              value={statusFilter}
              onChange={(value) => setStatusFilter(value as StatusFilter)}
              options={STATUS_FILTERS}
            />
            <FilterSelect
              id="admin-request-category"
              label="Categorie"
              value={categoryFilter}
              onChange={(value) => setCategoryFilter(value as CategoryFilter)}
              options={CATEGORY_FILTERS}
            />
            <FilterSelect
              id="admin-request-sort"
              label="Sortează"
              value={sortOption}
              onChange={(value) => setSortOption(value as SortOption)}
              options={SORT_OPTIONS}
            />
          </div>
        </section>

        {loadStatus === "loading" && (
          <div
            className="flex min-h-64 items-center justify-center"
            role="status"
          >
            <p className="text-white/60">Se încarcă cererile și lucrările...</p>
          </div>
        )}

        {loadStatus === "error" && (
          <div className="mt-8 rounded-3xl border border-white/10 bg-white/5 p-6 text-center">
            <h2 className="text-xl font-semibold">Director indisponibil</h2>
            <p className="mt-2 text-sm text-white/60">
              Cererile și lucrările nu au putut fi încărcate.
            </p>
            <button
              type="button"
              onClick={retry}
              className="mt-5 min-h-11 rounded-xl bg-white px-5 py-3 text-sm font-semibold text-black transition hover:bg-white/90"
            >
              Reîncearcă
            </button>
          </div>
        )}

        {loadStatus === "ready" && requests.length === 0 && (
          <div className="mt-8 rounded-3xl border border-white/10 bg-white/5 p-8 text-center">
            <h2 className="text-lg font-semibold">
              {hasActiveCriteria
                ? "Nu am găsit cereri sau lucrări"
                : "Nu există cereri sau lucrări"}
            </h2>
            {hasActiveCriteria && (
              <p className="mt-2 text-sm text-white/55">
                Modifică termenul de căutare sau filtrele selectate.
              </p>
            )}
          </div>
        )}

        {loadStatus === "ready" && requests.length > 0 && (
          <section className="mt-8" aria-label="Lista cererilor și lucrărilor">
            <div className="grid gap-4 lg:grid-cols-2">
              {requests.map((request) => (
                <RequestCard key={request.request_id} request={request} />
              ))}
            </div>

            {hasMore && (
              <div className="mt-5">
                {loadMoreError && (
                  <p
                    className="mb-3 text-center text-sm text-white/55"
                    role="alert"
                  >
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
            )}
          </section>
        )}
      </div>
    </main>
  );
}

function FilterSelect({
  id,
  label,
  value,
  onChange,
  options,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <label htmlFor={id} className="text-sm text-white/55">
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="min-h-12 min-w-0 rounded-2xl border border-white/15 bg-black px-4 text-base text-white outline-none focus:border-orange-400/70 focus:ring-2 focus:ring-orange-400/20"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function RequestCard({ request }: { request: AdminRequestRow }) {
  const customerName =
    request.customer_display_name?.trim() || "Client fără nume";
  const city = request.city?.trim() || null;
  const licensePlate = request.license_plate?.trim() || null;
  const workshopName = request.workshop_name?.trim() || null;
  const acceptedOfferPrice = request.accepted_offer_price?.trim() || null;
  const hasAppointment = Boolean(
    request.appointment_status ||
      request.appointment_date ||
      request.appointment_time,
  );

  return (
    <article className="min-w-0 rounded-3xl border border-white/10 bg-white/[0.05] p-5 shadow-lg sm:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h2 className="break-words text-lg font-semibold text-white">
            {customerName}
          </h2>
          {city && <p className="mt-1 text-sm text-white/55">{city}</p>}
          <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-white/40">
            {request.request_type === "direct_request"
              ? "Cerere directă"
              : "Marketplace"}
          </p>
        </div>

        <div className="flex flex-wrap gap-2 sm:max-w-[55%] sm:justify-end">
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
          <span className="text-white/40">Nr. înmatriculare: </span>
          {licensePlate ?? "—"}
        </p>
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
              <AppointmentDetail
                label="Status"
                value={
                  APPOINTMENT_STATUS_LABELS[request.appointment_status] ??
                  "Status disponibil"
                }
              />
            )}
            {request.appointment_date && (
              <AppointmentDetail
                label="Data"
                value={formatAppointmentDate(request.appointment_date)}
              />
            )}
            {request.appointment_time && (
              <AppointmentDetail
                label="Ora"
                value={formatAppointmentTime(request.appointment_time)}
              />
            )}
          </dl>
        </div>
      )}

      <p className="mt-4 text-xs text-white/40">
        Creată la {formatCreatedAt(request.created_at)}
      </p>

      <Link
        href={`/admin/requests/${request.request_id}`}
        className="mt-5 inline-flex min-h-11 w-full items-center justify-center rounded-2xl bg-orange-500 px-5 py-3 text-sm font-bold text-black transition hover:bg-orange-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-300"
      >
        Vezi detalii
      </Link>
    </article>
  );
}

function AppointmentDetail({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-white/40">{label}</dt>
      <dd className="mt-1 break-words font-semibold text-white/80">{value}</dd>
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
