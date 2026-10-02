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

type NumericValue = number | string | null;

type AdminCustomerRow = {
  customer_id: string;
  display_name: string | null;
  city: string | null;
  profile_created_at: string;
  total_requests: NumericValue;
  open_requests: NumericValue;
  in_progress_jobs: NumericValue;
  completed_jobs: NumericValue;
};

type CustomerSort = "created_at" | "display_name";
type SortDirection = "asc" | "desc";
type SortOption =
  | "created_at_desc"
  | "created_at_asc"
  | "display_name_asc"
  | "display_name_desc";
type Cursor = {
  createdAt: string | null;
  name: string | null;
  id: string;
};
type LoadStatus = "loading" | "ready" | "error";

const PAGE_SIZE = 25;
const REQUEST_LIMIT = PAGE_SIZE + 1;

const SORT_OPTIONS: Array<{ value: SortOption; label: string }> = [
  { value: "created_at_desc", label: "Cei mai noi" },
  { value: "created_at_asc", label: "Cei mai vechi" },
  { value: "display_name_asc", label: "Nume A–Z" },
  { value: "display_name_desc", label: "Nume Z–A" },
];

const SORT_PARAMETERS: Record<
  SortOption,
  { sort: CustomerSort; direction: SortDirection }
> = {
  created_at_desc: { sort: "created_at", direction: "desc" },
  created_at_asc: { sort: "created_at", direction: "asc" },
  display_name_asc: { sort: "display_name", direction: "asc" },
  display_name_desc: { sort: "display_name", direction: "desc" },
};

const PROFILE_DATE_FORMATTER = new Intl.DateTimeFormat("ro-RO", {
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

function toNonNegativeInteger(value: NumericValue) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 0;
}

function formatProfileDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : PROFILE_DATE_FORMATTER.format(date);
}

function deduplicateCustomers(rows: AdminCustomerRow[]) {
  return Array.from(
    new Map(rows.map((row) => [row.customer_id, row])).values(),
  );
}

function createCursor(row: AdminCustomerRow, sort: CustomerSort): Cursor {
  return {
    createdAt: sort === "created_at" ? row.profile_created_at : null,
    name: sort === "display_name" ? row.display_name ?? "Client" : null,
    id: row.customer_id,
  };
}

export default function AdminCustomersPage() {
  const router = useRouter();
  const [draftSearch, setDraftSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [sortOption, setSortOption] =
    useState<SortOption>("created_at_desc");
  const [customers, setCustomers] = useState<AdminCustomerRow[]>([]);
  const [loadStatus, setLoadStatus] = useState<LoadStatus>("loading");
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<Cursor | null>(null);
  const requestGenerationRef = useRef(0);
  const querySignatureRef = useRef("");
  const loadingMoreRef = useRef(false);

  const { sort, direction } = SORT_PARAMETERS[sortOption];
  const querySignature = JSON.stringify({
    search: appliedSearch,
    sort,
    direction,
  });

  const loadCustomers = useCallback(
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

        if (sessionError) throw sessionError;

        if (!session) {
          router.replace("/login");
          return;
        }

        const { data, error } = await supabase.rpc("get_admin_customers", {
          p_search: appliedSearch.trim() || null,
          p_sort: sort,
          p_direction: direction,
          p_cursor_created_at: cursor?.createdAt ?? null,
          p_cursor_name: cursor?.name ?? null,
          p_cursor_id: cursor?.id ?? null,
          p_limit: REQUEST_LIMIT,
        });

        if (!isCurrentRequest()) return;

        if (isUnauthorizedError(error)) {
          router.replace("/");
          return;
        }

        if (error || !data) {
          throw error ?? new Error("Admin customers are unavailable.");
        }

        const result = data as AdminCustomerRow[];
        const visibleRows = result.slice(0, PAGE_SIZE);
        const lastVisibleRow = visibleRows.at(-1) ?? null;

        setCustomers((current) =>
          append
            ? deduplicateCustomers([...current, ...visibleRows])
            : visibleRows,
        );
        setHasMore(result.length > PAGE_SIZE);
        setLoadMoreError(false);
        setNextCursor(lastVisibleRow ? createCursor(lastVisibleRow, sort) : null);
        setLoadStatus("ready");
      } catch {
        if (!isCurrentRequest()) return;

        if (append) {
          setLoadMoreError(true);
        } else {
          setCustomers([]);
          setHasMore(false);
          setNextCursor(null);
          setLoadStatus("error");
        }
      } finally {
        if (append && isCurrentRequest()) {
          loadingMoreRef.current = false;
          setLoadingMore(false);
        }
      }
    },
    [appliedSearch, direction, router, sort],
  );

  useEffect(() => {
    const generation = ++requestGenerationRef.current;
    querySignatureRef.current = querySignature;
    loadingMoreRef.current = false;
    setCustomers([]);
    setHasMore(false);
    setNextCursor(null);
    setLoadingMore(false);
    setLoadMoreError(false);
    setLoadStatus("loading");

    void loadCustomers({
      append: false,
      cursor: null,
      generation,
      signature: querySignature,
    });

    return () => {
      requestGenerationRef.current += 1;
    };
  }, [loadCustomers, querySignature]);

  const handleSearchSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setAppliedSearch(draftSearch.trim());
  };

  const clearSearch = () => {
    setDraftSearch("");
    setAppliedSearch("");
  };

  const loadMoreCustomers = () => {
    if (!nextCursor || !hasMore || loadingMoreRef.current) return;

    loadingMoreRef.current = true;
    setLoadingMore(true);
    setLoadMoreError(false);

    void loadCustomers({
      append: true,
      cursor: nextCursor,
      generation: requestGenerationRef.current,
      signature: querySignatureRef.current,
    });
  };

  const retry = () => {
    const generation = ++requestGenerationRef.current;
    querySignatureRef.current = querySignature;
    loadingMoreRef.current = false;
    setLoadingMore(false);
    setLoadMoreError(false);
    setLoadStatus("loading");

    void loadCustomers({
      append: false,
      cursor: null,
      generation,
      signature: querySignature,
    });
  };

  const hasActiveSearch = appliedSearch.length > 0;

  return (
    <main className="min-h-screen overflow-x-hidden bg-black px-4 pb-16 pt-6 text-white sm:px-6 sm:py-10">
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
          <h1 className="mt-2 text-3xl font-bold sm:text-4xl">Clienți</h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-white/60 sm:text-base">
            Director read-only pentru clienții și activitatea lor din marketplace.
          </p>
        </header>

        <section className="mt-8 space-y-4 rounded-3xl border border-white/10 bg-white/[0.04] p-4 sm:p-6">
          <form
            onSubmit={handleSearchSubmit}
            className="flex flex-col gap-3 sm:flex-row"
          >
            <label className="sr-only" htmlFor="admin-customer-search">
              Caută clienți
            </label>
            <input
              id="admin-customer-search"
              type="search"
              value={draftSearch}
              maxLength={100}
              onChange={(event) => setDraftSearch(event.target.value)}
              placeholder="Caută după nume sau oraș"
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

          <div className="flex flex-col gap-2 sm:ml-auto sm:w-72">
            <label htmlFor="admin-customer-sort" className="text-sm text-white/55">
              Sortează
            </label>
            <select
              id="admin-customer-sort"
              value={sortOption}
              onChange={(event) =>
                setSortOption(event.target.value as SortOption)
              }
              className="min-h-12 rounded-2xl border border-white/15 bg-black px-4 text-base text-white outline-none focus:border-orange-400/70 focus:ring-2 focus:ring-orange-400/20"
            >
              {SORT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </section>

        {loadStatus === "loading" && (
          <div className="flex min-h-64 items-center justify-center" role="status">
            <p className="text-white/60">Se încarcă clienții...</p>
          </div>
        )}

        {loadStatus === "error" && (
          <div className="mt-8 rounded-3xl border border-white/10 bg-white/5 p-6 text-center">
            <h2 className="text-xl font-semibold">Director indisponibil</h2>
            <p className="mt-2 text-sm text-white/60">
              Clienții nu au putut fi încărcați.
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

        {loadStatus === "ready" && customers.length === 0 && (
          <div className="mt-8 rounded-3xl border border-white/10 bg-white/5 p-8 text-center">
            <h2 className="text-lg font-semibold">
              {hasActiveSearch ? "Nu am găsit clienți" : "Nu există clienți"}
            </h2>
            {hasActiveSearch && (
              <p className="mt-2 text-sm text-white/55">
                Modifică termenul de căutare și încearcă din nou.
              </p>
            )}
          </div>
        )}

        {loadStatus === "ready" && customers.length > 0 && (
          <section className="mt-8" aria-label="Lista clienților">
            <div className="grid min-w-0 gap-4 lg:grid-cols-2">
              {customers.map((customer) => (
                <CustomerCard key={customer.customer_id} customer={customer} />
              ))}
            </div>

            {hasMore && (
              <div className="mt-5">
                {loadMoreError && (
                  <p className="mb-3 text-center text-sm text-white/55" role="alert">
                    Următorii clienți nu au putut fi încărcați.
                  </p>
                )}
                <button
                  type="button"
                  onClick={loadMoreCustomers}
                  disabled={loadingMore}
                  className="min-h-12 w-full rounded-2xl border border-white/15 bg-white/5 px-5 py-3 font-semibold text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {loadingMore
                    ? "Se încarcă..."
                    : loadMoreError
                      ? "Reîncearcă"
                      : "Încarcă mai mulți"}
                </button>
              </div>
            )}
          </section>
        )}
      </div>
    </main>
  );
}

function CustomerCard({ customer }: { customer: AdminCustomerRow }) {
  const displayName = customer.display_name?.trim() || "Client";
  const city = customer.city?.trim() || null;
  const metrics = [
    { label: "Total cereri", value: customer.total_requests },
    { label: "Cereri deschise", value: customer.open_requests },
    { label: "Lucrări în desfășurare", value: customer.in_progress_jobs },
    { label: "Lucrări finalizate", value: customer.completed_jobs },
  ];

  return (
    <Link
      href={`/admin/customers/${customer.customer_id}`}
      aria-label={`Vezi detaliile clientului ${displayName}`}
      className="group block min-w-0 rounded-3xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400/70"
    >
    <article className="min-w-0 overflow-hidden rounded-3xl border border-white/10 bg-white/[0.05] p-5 shadow-lg transition group-hover:border-orange-400/40 group-hover:bg-white/[0.07] sm:p-6">
      <div className="min-w-0">
        <h2 className="break-words text-lg font-semibold text-white">
          {displayName}
        </h2>
        {city && <p className="mt-1 break-words text-sm text-white/55">{city}</p>}
        <p className="mt-3 text-xs text-white/40">
          Înregistrat la {formatProfileDate(customer.profile_created_at)}
        </p>
      </div>

      <dl className="mt-5 grid min-w-0 grid-cols-2 gap-3">
        {metrics.map((metric) => (
          <div
            key={metric.label}
            className="min-w-0 rounded-2xl border border-white/10 bg-black/30 p-3 sm:p-4"
          >
            <dt className="break-words text-xs leading-5 text-white/45">
              {metric.label}
            </dt>
            <dd className="mt-1 text-2xl font-bold text-white">
              {INTEGER_FORMATTER.format(toNonNegativeInteger(metric.value))}
            </dd>
          </div>
        ))}
      </dl>
      <p className="mt-5 text-center text-sm font-semibold text-orange-300">
        Vezi detalii
      </p>
    </article>
    </Link>
  );
}
