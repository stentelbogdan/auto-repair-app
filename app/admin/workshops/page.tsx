"use client";

import Image from "next/image";
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

type AdminWorkshopRow = {
  workshop_id: string;
  workshop_name: string | null;
  workshop_slug: string | null;
  workshop_city: string | null;
  workshop_logo_url: string | null;
  workshop_specializations: string[] | null;
  created_at: string | null;
  review_count: NumericValue;
  average_rating: NumericValue;
  total_offer_count: NumericValue;
  completed_job_count: NumericValue;
};

type WorkshopSort =
  | "created_at"
  | "workshop_name"
  | "review_count"
  | "average_rating";
type SortDirection = "asc" | "desc";
type SortOption =
  | "created_at_desc"
  | "created_at_asc"
  | "workshop_name_asc"
  | "workshop_name_desc"
  | "review_count_desc"
  | "review_count_asc"
  | "average_rating_desc"
  | "average_rating_asc";
type Cursor = {
  createdAt: string | null;
  value: string | null;
  id: string;
};
type LoadStatus = "loading" | "ready" | "error";

const PAGE_SIZE = 25;
const REQUEST_LIMIT = PAGE_SIZE + 1;

const SORT_OPTIONS: Array<{ value: SortOption; label: string }> = [
  { value: "created_at_desc", label: "Cei mai noi" },
  { value: "created_at_asc", label: "Cei mai vechi" },
  { value: "workshop_name_asc", label: "Nume A–Z" },
  { value: "workshop_name_desc", label: "Nume Z–A" },
  {
    value: "review_count_desc",
    label: "Cele mai multe review-uri",
  },
  {
    value: "review_count_asc",
    label: "Cele mai puține review-uri",
  },
  { value: "average_rating_desc", label: "Rating maxim" },
  { value: "average_rating_asc", label: "Rating minim" },
];

const SORT_PARAMETERS: Record<
  SortOption,
  { sort: WorkshopSort; direction: SortDirection }
> = {
  created_at_desc: { sort: "created_at", direction: "desc" },
  created_at_asc: { sort: "created_at", direction: "asc" },
  workshop_name_asc: { sort: "workshop_name", direction: "asc" },
  workshop_name_desc: { sort: "workshop_name", direction: "desc" },
  review_count_desc: { sort: "review_count", direction: "desc" },
  review_count_asc: { sort: "review_count", direction: "asc" },
  average_rating_desc: { sort: "average_rating", direction: "desc" },
  average_rating_asc: { sort: "average_rating", direction: "asc" },
};

const JOINED_AT_FORMATTER = new Intl.DateTimeFormat("ro-RO", {
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

function toNonNegativeNumber(value: NumericValue) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function toNumericCursor(value: NumericValue) {
  if (typeof value === "string") {
    const normalized = value.trim();
    if (/^[0-9]+(?:\.[0-9]+)?$/.test(normalized)) return normalized;
  }

  return toNonNegativeNumber(value).toString();
}

function formatJoinedAt(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : JOINED_AT_FORMATTER.format(date);
}

function getWorkshopInitials(name: string | null) {
  const words = name?.trim().split(/\s+/).filter(Boolean) ?? [];
  const initials = words
    .slice(0, 2)
    .map((word) => word.charAt(0).toUpperCase())
    .join("");

  return initials || "AR";
}

function deduplicateWorkshops(rows: AdminWorkshopRow[]) {
  return Array.from(
    new Map(rows.map((row) => [row.workshop_id, row])).values(),
  );
}

function createCursor(row: AdminWorkshopRow, sort: WorkshopSort): Cursor {
  if (sort === "created_at") {
    return {
      createdAt: row.created_at,
      value: null,
      id: row.workshop_id,
    };
  }

  if (sort === "workshop_name") {
    return {
      createdAt: null,
      value: row.workshop_name ?? "",
      id: row.workshop_id,
    };
  }

  return {
    createdAt: null,
    value: toNumericCursor(
      sort === "review_count" ? row.review_count : row.average_rating,
    ),
    id: row.workshop_id,
  };
}

export default function AdminWorkshopsPage() {
  const router = useRouter();
  const [draftSearch, setDraftSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [sortOption, setSortOption] =
    useState<SortOption>("created_at_desc");
  const [workshops, setWorkshops] = useState<AdminWorkshopRow[]>([]);
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

  const loadWorkshops = useCallback(
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

        const { data, error } = await supabase.rpc("get_admin_workshops", {
          p_search: appliedSearch.trim() || null,
          p_specializations: null,
          p_sort: sort,
          p_direction: direction,
          p_cursor_created_at: cursor?.createdAt ?? null,
          p_cursor_name: cursor?.value ?? null,
          p_cursor_id: cursor?.id ?? null,
          p_limit: REQUEST_LIMIT,
        });

        if (!isCurrentRequest()) return;

        if (isUnauthorizedError(error)) {
          router.replace("/");
          return;
        }

        if (error || !data) {
          throw error ?? new Error("Admin workshops are unavailable.");
        }

        const result = data as AdminWorkshopRow[];
        const visibleRows = result.slice(0, PAGE_SIZE);
        const lastVisibleRow = visibleRows.at(-1) ?? null;

        setWorkshops((current) =>
          append
            ? deduplicateWorkshops([...current, ...visibleRows])
            : visibleRows,
        );
        setHasMore(result.length > PAGE_SIZE);
        setLoadMoreError(false);
        setNextCursor(lastVisibleRow ? createCursor(lastVisibleRow, sort) : null);
        setLoadStatus("ready");
      } catch {
        if (!isCurrentRequest()) return;

        if (!append) {
          setWorkshops([]);
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
    [appliedSearch, direction, router, sort],
  );

  useEffect(() => {
    const generation = ++requestGenerationRef.current;
    querySignatureRef.current = querySignature;
    loadingMoreRef.current = false;
    setWorkshops([]);
    setHasMore(false);
    setNextCursor(null);
    setLoadingMore(false);
    setLoadMoreError(false);
    setLoadStatus("loading");

    void loadWorkshops({
      append: false,
      cursor: null,
      generation,
      signature: querySignature,
    });

    return () => {
      requestGenerationRef.current += 1;
    };
  }, [loadWorkshops, querySignature]);

  const handleSearchSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setAppliedSearch(draftSearch.trim());
  };

  const clearSearch = () => {
    setDraftSearch("");
    setAppliedSearch("");
  };

  const loadMoreWorkshops = () => {
    if (!nextCursor || !hasMore || loadingMoreRef.current) return;

    loadingMoreRef.current = true;
    setLoadingMore(true);
    setLoadMoreError(false);

    void loadWorkshops({
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

    void loadWorkshops({
      append: false,
      cursor: null,
      generation,
      signature: querySignature,
    });
  };

  const hasActiveCriteria = appliedSearch.length > 0;

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
          <h1 className="mt-2 text-3xl font-bold sm:text-4xl">Service-uri</h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-white/60 sm:text-base">
            Director read-only pentru service-urile din marketplace.
          </p>
        </header>

        <section className="mt-8 space-y-4 rounded-3xl border border-white/10 bg-white/[0.04] p-4 sm:p-6">
          <form
            onSubmit={handleSearchSubmit}
            className="flex flex-col gap-3 sm:flex-row"
          >
            <label className="sr-only" htmlFor="admin-workshop-search">
              Caută service-uri
            </label>
            <input
              id="admin-workshop-search"
              type="search"
              value={draftSearch}
              maxLength={100}
              onChange={(event) => setDraftSearch(event.target.value)}
              placeholder="Caută după nume, oraș sau slug"
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
            <label
              htmlFor="admin-workshop-sort"
              className="text-sm text-white/55"
            >
              Sortează
            </label>
            <select
              id="admin-workshop-sort"
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
          <div
            className="flex min-h-64 items-center justify-center"
            role="status"
          >
            <p className="text-white/60">Se încarcă service-urile...</p>
          </div>
        )}

        {loadStatus === "error" && (
          <div className="mt-8 rounded-3xl border border-white/10 bg-white/5 p-6 text-center">
            <h2 className="text-xl font-semibold">Director indisponibil</h2>
            <p className="mt-2 text-sm text-white/60">
              Service-urile nu au putut fi încărcate.
            </p>
            <button
              type="button"
              onClick={retry}
              className="mt-5 min-h-11 rounded-xl bg-white px-5 py-3 text-sm font-semibold text-black transition hover:bg-white/90"
            >
              Încearcă din nou
            </button>
          </div>
        )}

        {loadStatus === "ready" && workshops.length === 0 && (
          <div className="mt-8 rounded-3xl border border-white/10 bg-white/5 p-8 text-center">
            <h2 className="text-lg font-semibold">
              {hasActiveCriteria
                ? "Nu am găsit service-uri"
                : "Nu există service-uri"}
            </h2>
            {hasActiveCriteria && (
              <p className="mt-2 text-sm text-white/55">
                Modifică termenul de căutare și încearcă din nou.
              </p>
            )}
          </div>
        )}

        {loadStatus === "ready" && workshops.length > 0 && (
          <section className="mt-8" aria-label="Lista service-urilor">
            <div className="grid gap-4 lg:grid-cols-2">
              {workshops.map((workshop) => (
                <WorkshopCard
                  key={workshop.workshop_id}
                  workshop={workshop}
                />
              ))}
            </div>

            {hasMore && (
              <div className="mt-5">
                {loadMoreError && (
                  <p
                    className="mb-3 text-center text-sm text-white/55"
                    role="alert"
                  >
                    Următoarele service-uri nu au putut fi încărcate.
                  </p>
                )}
                <button
                  type="button"
                  onClick={loadMoreWorkshops}
                  disabled={loadingMore}
                  className="min-h-12 w-full rounded-2xl border border-white/15 bg-white/5 px-5 py-3 font-semibold text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {loadingMore ? "Se încarcă..." : "Încarcă mai multe"}
                </button>
              </div>
            )}
          </section>
        )}
      </div>
    </main>
  );
}

function WorkshopCard({ workshop }: { workshop: AdminWorkshopRow }) {
  const [logoFailed, setLogoFailed] = useState(false);
  const name = workshop.workshop_name?.trim() || "Service fără nume";
  const city = workshop.workshop_city?.trim() || null;
  const specializations = Array.from(
    new Set(
      (workshop.workshop_specializations ?? []).filter(
        (specialization) => specialization.trim().length > 0,
      ),
    ),
  );
  const reviewCount = toNonNegativeNumber(workshop.review_count);
  const averageRating = toNonNegativeNumber(workshop.average_rating);
  const totalOffers = toNonNegativeNumber(workshop.total_offer_count);
  const completedJobs = toNonNegativeNumber(workshop.completed_job_count);
  const logoUrl = workshop.workshop_logo_url?.trim() || null;

  return (
    <article className="min-w-0 rounded-3xl border border-white/10 bg-white/[0.05] p-5 shadow-lg sm:p-6">
      <div className="flex min-w-0 items-start gap-4">
        <div className="relative flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-white/10 bg-white/10 text-lg font-black text-orange-300">
          {logoUrl && !logoFailed ? (
            <Image
              src={logoUrl}
              alt=""
              fill
              sizes="64px"
              className="object-cover"
              onError={() => setLogoFailed(true)}
            />
          ) : (
            <span aria-hidden="true">{getWorkshopInitials(name)}</span>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <h2 className="break-words text-lg font-semibold text-white">
            {name}
          </h2>
          {city && (
            <p className="mt-1 break-words text-sm text-white/55">{city}</p>
          )}
          <p className="mt-2 text-sm font-semibold text-orange-300">
            {reviewCount > 0
              ? `${RATING_FORMATTER.format(averageRating)} ★ · ${INTEGER_FORMATTER.format(reviewCount)} ${reviewCount === 1 ? "review" : "review-uri"}`
              : "Fără review-uri"}
          </p>
        </div>
      </div>

      {specializations.length > 0 && (
        <div className="mt-5 flex flex-wrap gap-2">
          {specializations.map((specialization) => (
            <span
              key={specialization}
              className="max-w-full break-words rounded-full border border-white/15 bg-white/[0.05] px-3 py-1 text-xs font-semibold text-white/70"
            >
              {specialization}
            </span>
          ))}
        </div>
      )}

      <div className="mt-5 grid grid-cols-2 gap-3">
        <Metric
          label="Oferte"
          value={INTEGER_FORMATTER.format(totalOffers)}
        />
        <Metric
          label="Lucrări finalizate"
          value={INTEGER_FORMATTER.format(completedJobs)}
        />
        <Metric
          label="Review-uri"
          value={INTEGER_FORMATTER.format(reviewCount)}
        />
        <Metric label="Înscris la" value={formatJoinedAt(workshop.created_at)} />
      </div>
    </article>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-2xl bg-black/30 p-3">
      <p className="text-xs text-white/40">{label}</p>
      <p className="mt-1 break-words text-sm font-semibold text-white/85">
        {value}
      </p>
    </div>
  );
}
