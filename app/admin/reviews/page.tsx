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

type SortOption = "created_at_desc" | "created_at_asc";
type SortDirection = "asc" | "desc";
type LoadStatus = "loading" | "ready" | "error";

type AdminReviewRow = {
  review_id: string;
  request_id: string;
  rating: number;
  review_text: string | null;
  created_at: string;
  customer_display_name: string | null;
  workshop_name: string | null;
  request_category: string | null;
  request_status: string | null;
};

type Cursor = {
  createdAt: string;
  id: string;
};

const PAGE_SIZE = 25;
const REQUEST_LIMIT = PAGE_SIZE + 1;
const RATINGS = [1, 2, 3, 4, 5] as const;

const SORT_OPTIONS: Array<{ value: SortOption; label: string }> = [
  { value: "created_at_desc", label: "Cele mai noi" },
  { value: "created_at_asc", label: "Cele mai vechi" },
];

const CATEGORY_LABELS: Record<string, string> = {
  bodywork: "Daună estetică",
  mechanical: "Problemă mecanică",
  wheels: "Roți și anvelope",
  towing: "Tractare auto",
};

const STATUS_LABELS: Record<string, string> = {
  open: "Deschisă",
  matched: "Potrivită",
  in_progress: "În lucru",
  completed: "Finalizată",
  closed: "Închisă",
};

const CREATED_AT_FORMATTER = new Intl.DateTimeFormat("ro-RO", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

function isUnauthorizedError(error: { code?: string } | null): boolean {
  return error?.code === "42501";
}

function deduplicateReviews(rows: AdminReviewRow[]) {
  return Array.from(
    new Map(rows.map((review) => [review.review_id, review])).values(),
  );
}

function formatCreatedAt(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Dată indisponibilă"
    : CREATED_AT_FORMATTER.format(date);
}

function formatCategory(value: string | null) {
  return value ? (CATEGORY_LABELS[value] ?? "Categorie indisponibilă") : "Categorie indisponibilă";
}

function formatStatus(value: string | null) {
  return value ? (STATUS_LABELS[value] ?? "Status indisponibil") : "Status indisponibil";
}

export default function AdminReviewsPage() {
  const router = useRouter();
  const [draftSearch, setDraftSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [selectedRatings, setSelectedRatings] = useState<number[]>([]);
  const [sortOption, setSortOption] =
    useState<SortOption>("created_at_desc");
  const [reviews, setReviews] = useState<AdminReviewRow[]>([]);
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
    ratings: selectedRatings,
    direction,
  });

  const loadReviews = useCallback(
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

        const { data, error } = await supabase.rpc("get_admin_reviews", {
          p_search: appliedSearch.trim() || null,
          p_ratings: selectedRatings.length > 0 ? selectedRatings : null,
          p_workshop_id: null,
          p_sort: "created_at",
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
          throw error ?? new Error("Admin reviews are unavailable.");
        }

        const result = data as AdminReviewRow[];
        const visibleRows = result.slice(0, PAGE_SIZE);
        const lastVisibleRow = visibleRows.at(-1) ?? null;

        setReviews((current) =>
          append
            ? deduplicateReviews([...current, ...visibleRows])
            : visibleRows,
        );
        setHasMore(result.length > PAGE_SIZE);
        setLoadMoreError(false);
        setNextCursor(
          lastVisibleRow
            ? {
                createdAt: lastVisibleRow.created_at,
                id: lastVisibleRow.review_id,
              }
            : null,
        );
        setLoadStatus("ready");
      } catch {
        if (!isCurrentRequest()) return;

        if (append) {
          setLoadMoreError(true);
        } else {
          setReviews([]);
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
    [appliedSearch, direction, router, selectedRatings],
  );

  useEffect(() => {
    const generation = ++requestGenerationRef.current;
    querySignatureRef.current = querySignature;
    loadingMoreRef.current = false;
    setReviews([]);
    setHasMore(false);
    setNextCursor(null);
    setLoadingMore(false);
    setLoadMoreError(false);
    setLoadStatus("loading");

    void loadReviews({
      append: false,
      cursor: null,
      generation,
      signature: querySignature,
    });

    return () => {
      requestGenerationRef.current += 1;
    };
  }, [loadReviews, querySignature]);

  const handleSearchSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setAppliedSearch(draftSearch.trim());
  };

  const clearSearch = () => {
    setDraftSearch("");
    setAppliedSearch("");
  };

  const toggleRating = (rating: number) => {
    setSelectedRatings((current) =>
      current.includes(rating)
        ? current.filter((value) => value !== rating)
        : [...current, rating].sort((left, right) => left - right),
    );
  };

  const loadMoreReviews = () => {
    if (!nextCursor || !hasMore || loadingMoreRef.current) return;

    loadingMoreRef.current = true;
    setLoadingMore(true);
    setLoadMoreError(false);

    void loadReviews({
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

    void loadReviews({
      append: false,
      cursor: null,
      generation,
      signature: querySignature,
    });
  };

  const hasActiveCriteria =
    appliedSearch.length > 0 || selectedRatings.length > 0;

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
          <h1 className="mt-2 text-3xl font-bold sm:text-4xl">Recenzii</h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-white/60 sm:text-base">
            Vizualizare read-only a recenziilor publicate în marketplace.
          </p>
        </header>

        <section className="mt-8 space-y-5 rounded-3xl border border-white/10 bg-white/[0.04] p-4 sm:p-6">
          <form
            onSubmit={handleSearchSubmit}
            className="flex flex-col gap-3 sm:flex-row"
          >
            <label className="sr-only" htmlFor="admin-review-search">
              Caută recenzii
            </label>
            <input
              id="admin-review-search"
              type="search"
              value={draftSearch}
              maxLength={100}
              onChange={(event) => setDraftSearch(event.target.value)}
              placeholder="Caută în text, client sau service"
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

          <div className="grid gap-5 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <fieldset className="min-w-0">
              <legend className="text-sm text-white/55">Rating</legend>
              <div className="mt-2 flex flex-wrap gap-2">
                {RATINGS.map((rating) => {
                  const selected = selectedRatings.includes(rating);

                  return (
                    <button
                      key={rating}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => toggleRating(rating)}
                      className={`min-h-11 rounded-xl border px-3 py-2 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400/70 ${
                        selected
                          ? "border-orange-400 bg-orange-500/20 text-orange-200"
                          : "border-white/15 bg-black/30 text-white/70 hover:bg-white/10"
                      }`}
                    >
                      {rating} ★
                    </button>
                  );
                })}
              </div>
            </fieldset>

            <div className="flex min-w-0 flex-col gap-2">
              <label htmlFor="admin-review-sort" className="text-sm text-white/55">
                Sortează
              </label>
              <select
                id="admin-review-sort"
                value={sortOption}
                onChange={(event) =>
                  setSortOption(event.target.value as SortOption)
                }
                className="min-h-12 min-w-0 rounded-2xl border border-white/15 bg-black px-4 text-base text-white outline-none focus:border-orange-400/70 focus:ring-2 focus:ring-orange-400/20"
              >
                {SORT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </section>

        {loadStatus === "loading" && (
          <div className="flex min-h-64 items-center justify-center" role="status">
            <p className="text-white/60">Se încarcă recenziile...</p>
          </div>
        )}

        {loadStatus === "error" && (
          <div className="mt-8 rounded-3xl border border-white/10 bg-white/5 p-6 text-center">
            <h2 className="text-xl font-semibold">Recenzii indisponibile</h2>
            <p className="mt-2 text-sm text-white/60">
              Lista recenziilor nu a putut fi încărcată.
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

        {loadStatus === "ready" && reviews.length === 0 && (
          <div className="mt-8 rounded-3xl border border-white/10 bg-white/5 p-8 text-center">
            <h2 className="text-lg font-semibold">
              {hasActiveCriteria
                ? "Nu am găsit recenzii"
                : "Nu există recenzii"}
            </h2>
            {hasActiveCriteria && (
              <p className="mt-2 text-sm text-white/55">
                Modifică termenul de căutare sau ratingurile selectate.
              </p>
            )}
          </div>
        )}

        {loadStatus === "ready" && reviews.length > 0 && (
          <section className="mt-8" aria-label="Lista recenziilor">
            <div className="grid gap-4 lg:grid-cols-2">
              {reviews.map((review) => (
                <ReviewCard key={review.review_id} review={review} />
              ))}
            </div>

            {hasMore && (
              <div className="mt-5">
                {loadMoreError && (
                  <p className="mb-3 text-center text-sm text-white/55" role="alert">
                    Următoarele recenzii nu au putut fi încărcate.
                  </p>
                )}
                <button
                  type="button"
                  onClick={loadMoreReviews}
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

function ReviewCard({ review }: { review: AdminReviewRow }) {
  const rating = Math.min(5, Math.max(1, Math.round(Number(review.rating))));
  const customerName = review.customer_display_name?.trim() || "Client";
  const workshopName = review.workshop_name?.trim() || "Service";
  const reviewText = review.review_text?.trim() || null;

  return (
    <article className="min-w-0 rounded-3xl border border-white/10 bg-white/[0.05] p-5 shadow-lg sm:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p
            className="text-xl tracking-[0.12em] text-orange-300"
            aria-label={`${rating} din 5 stele`}
          >
            <span aria-hidden="true">
              {"★".repeat(rating)}
              <span className="text-white/20">{"★".repeat(5 - rating)}</span>
            </span>
          </p>
          <p className="mt-1 text-sm font-semibold text-white/70">
            {rating} din 5
          </p>
        </div>

        <div className="flex flex-wrap gap-2 sm:max-w-[60%] sm:justify-end">
          <span className="rounded-full border border-white/15 bg-white/[0.05] px-3 py-1 text-xs font-semibold text-white/75">
            {formatCategory(review.request_category)}
          </span>
          <span className="rounded-full border border-orange-400/30 bg-orange-500/10 px-3 py-1 text-xs font-semibold text-orange-200">
            {formatStatus(review.request_status)}
          </span>
        </div>
      </div>

      <blockquote className="mt-5 break-words rounded-2xl bg-black/30 p-4 text-sm leading-6 text-white/80">
        {reviewText ?? "Fără comentariu."}
      </blockquote>

      <dl className="mt-5 grid gap-4 text-sm sm:grid-cols-2">
        <div className="min-w-0">
          <dt className="text-white/40">Client</dt>
          <dd className="mt-1 break-words font-semibold text-white/80">
            {customerName}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-white/40">Service</dt>
          <dd className="mt-1 break-words font-semibold text-white/80">
            {workshopName}
          </dd>
        </div>
      </dl>

      <p className="mt-5 text-xs text-white/40">
        Publicată la {formatCreatedAt(review.created_at)}
      </p>

      <Link
        href={`/admin/requests/${review.request_id}`}
        className="mt-5 inline-flex min-h-11 w-full items-center justify-center rounded-2xl border border-white/15 px-5 py-3 text-sm font-semibold text-white transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400/70"
      >
        Vezi cererea
      </Link>
    </article>
  );
}
