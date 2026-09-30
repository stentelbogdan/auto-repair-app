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

type AdminUserRow = {
  user_id: string;
  display_name: string | null;
  city: string | null;
  roles: string[];
  created_at: string;
  has_customer_role: boolean;
  has_workshop_role: boolean;
  has_admin_role: boolean;
};

type RoleFilter = "all" | "customer" | "workshop" | "admin";
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

const ROLE_FILTERS: Array<{ value: RoleFilter; label: string }> = [
  { value: "all", label: "Toți" },
  { value: "customer", label: "Clienți" },
  { value: "workshop", label: "Service-uri" },
  { value: "admin", label: "Admini" },
];

const SORT_OPTIONS: Array<{ value: SortOption; label: string }> = [
  { value: "created_at_desc", label: "Cei mai noi" },
  { value: "created_at_asc", label: "Cei mai vechi" },
  { value: "display_name_asc", label: "Nume A–Z" },
  { value: "display_name_desc", label: "Nume Z–A" },
];

const SORT_PARAMETERS: Record<
  SortOption,
  {
    sort: "created_at" | "display_name";
    direction: "asc" | "desc";
  }
> = {
  created_at_desc: { sort: "created_at", direction: "desc" },
  created_at_asc: { sort: "created_at", direction: "asc" },
  display_name_asc: { sort: "display_name", direction: "asc" },
  display_name_desc: { sort: "display_name", direction: "desc" },
};

const ROLE_LABELS: Record<Exclude<RoleFilter, "all">, string> = {
  customer: "Client",
  workshop: "Service",
  admin: "Admin",
};

const JOINED_AT_FORMATTER = new Intl.DateTimeFormat("ro-RO", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

function formatJoinedAt(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : JOINED_AT_FORMATTER.format(date);
}

function isUnauthorizedError(error: { code?: string } | null): boolean {
  return error?.code === "42501";
}

function deduplicateUsers(rows: AdminUserRow[]) {
  return Array.from(new Map(rows.map((row) => [row.user_id, row])).values());
}

export default function AdminUsersPage() {
  const router = useRouter();
  const [draftSearch, setDraftSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<RoleFilter>("all");
  const [sortOption, setSortOption] =
    useState<SortOption>("created_at_desc");
  const [users, setUsers] = useState<AdminUserRow[]>([]);
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
    role: roleFilter,
    sort,
    direction,
  });

  const loadUsers = useCallback(
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

        const { data, error } = await supabase.rpc("get_admin_users", {
          p_search: appliedSearch.trim() || null,
          p_roles: roleFilter === "all" ? null : [roleFilter],
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
          throw error ?? new Error("Admin users are unavailable.");
        }

        const result = data as AdminUserRow[];
        const visibleRows = result.slice(0, PAGE_SIZE);
        const lastVisibleRow = visibleRows.at(-1) ?? null;

        setUsers((current) =>
          append
            ? deduplicateUsers([...current, ...visibleRows])
            : visibleRows,
        );
        setHasMore(result.length > PAGE_SIZE);
        setLoadMoreError(false);
        setNextCursor(
          lastVisibleRow
            ? {
                createdAt:
                  sort === "created_at" ? lastVisibleRow.created_at : null,
                name:
                  sort === "display_name"
                    ? (lastVisibleRow.display_name ?? "")
                    : null,
                id: lastVisibleRow.user_id,
              }
            : null,
        );
        setLoadStatus("ready");
      } catch {
        if (!isCurrentRequest()) return;

        if (!append) {
          setUsers([]);
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
    [appliedSearch, direction, roleFilter, router, sort],
  );

  useEffect(() => {
    const generation = ++requestGenerationRef.current;
    querySignatureRef.current = querySignature;
    loadingMoreRef.current = false;
    setUsers([]);
    setHasMore(false);
    setNextCursor(null);
    setLoadingMore(false);
    setLoadMoreError(false);
    setLoadStatus("loading");

    void loadUsers({
      append: false,
      cursor: null,
      generation,
      signature: querySignature,
    });

    return () => {
      requestGenerationRef.current += 1;
    };
  }, [loadUsers, querySignature]);

  const handleSearchSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setAppliedSearch(draftSearch.trim());
  };

  const clearSearch = () => {
    setDraftSearch("");
    setAppliedSearch("");
  };

  const loadMoreUsers = () => {
    if (!nextCursor || !hasMore || loadingMoreRef.current) return;

    loadingMoreRef.current = true;
    setLoadingMore(true);
    setLoadMoreError(false);

    void loadUsers({
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

    void loadUsers({
      append: false,
      cursor: null,
      generation,
      signature: querySignature,
    });
  };

  const hasActiveCriteria = appliedSearch.length > 0 || roleFilter !== "all";

  return (
    <main className="min-h-screen bg-black px-4 pb-16 pt-6 text-white sm:px-6 sm:py-10">
      <div className="mx-auto max-w-5xl">
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
          <h1 className="mt-2 text-3xl font-bold sm:text-4xl">Utilizatori</h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-white/60 sm:text-base">
            Director read-only pentru conturile și rolurile din marketplace.
          </p>
        </header>

        <section className="mt-8 space-y-4 rounded-3xl border border-white/10 bg-white/[0.04] p-4 sm:p-6">
          <form
            onSubmit={handleSearchSubmit}
            className="flex flex-col gap-3 sm:flex-row"
          >
            <label className="sr-only" htmlFor="admin-user-search">
              Caută utilizatori
            </label>
            <input
              id="admin-user-search"
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

          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
            {ROLE_FILTERS.map((filter) => {
              const isActive = roleFilter === filter.value;

              return (
                <button
                  key={filter.value}
                  type="button"
                  onClick={() => setRoleFilter(filter.value)}
                  aria-pressed={isActive}
                  className={`min-h-11 rounded-full border px-4 py-2 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400/70 ${
                    isActive
                      ? "border-orange-400/70 bg-orange-500/15 text-orange-300"
                      : "border-white/15 bg-white/[0.03] text-white/70 hover:bg-white/[0.08]"
                  }`}
                >
                  {filter.label}
                </button>
              );
            })}
          </div>

          <div className="flex flex-col gap-2 sm:ml-auto sm:w-64">
            <label htmlFor="admin-user-sort" className="text-sm text-white/55">
              Sortează
            </label>
            <select
              id="admin-user-sort"
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
            <p className="text-white/60">Se încarcă utilizatorii...</p>
          </div>
        )}

        {loadStatus === "error" && (
          <div className="mt-8 rounded-3xl border border-white/10 bg-white/5 p-6 text-center">
            <h2 className="text-xl font-semibold">Director indisponibil</h2>
            <p className="mt-2 text-sm text-white/60">
              Utilizatorii nu au putut fi încărcați. Încearcă din nou.
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

        {loadStatus === "ready" && users.length === 0 && (
          <div className="mt-8 rounded-3xl border border-white/10 bg-white/5 p-8 text-center">
            <h2 className="text-lg font-semibold">
              {hasActiveCriteria
                ? "Nu am găsit utilizatori"
                : "Nu există utilizatori"}
            </h2>
            {hasActiveCriteria && (
              <p className="mt-2 text-sm text-white/55">
                Modifică termenul de căutare sau filtrul selectat.
              </p>
            )}
          </div>
        )}

        {loadStatus === "ready" && users.length > 0 && (
          <section className="mt-8" aria-label="Lista utilizatorilor">
            <div className="space-y-3">
              {users.map((user) => (
                <UserCard key={user.user_id} user={user} />
              ))}
            </div>

            {hasMore && (
              <div className="mt-5">
                {loadMoreError && (
                  <p className="mb-3 text-center text-sm text-white/55" role="alert">
                    Următorii utilizatori nu au putut fi încărcați.
                  </p>
                )}
                <button
                  type="button"
                  onClick={loadMoreUsers}
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

function UserCard({ user }: { user: AdminUserRow }) {
  const recognizedRoles = user.roles.filter(
    (role): role is Exclude<RoleFilter, "all"> =>
      role === "customer" || role === "workshop" || role === "admin",
  );

  return (
    <article className="rounded-2xl border border-white/10 bg-white/[0.05] p-5 shadow-lg sm:flex sm:items-center sm:justify-between sm:gap-6">
      <div className="min-w-0">
        <h2 className="truncate text-lg font-semibold text-white">
          {user.display_name?.trim() || "Utilizator fără nume"}
        </h2>
        {user.city?.trim() && (
          <p className="mt-1 text-sm text-white/55">{user.city}</p>
        )}
      </div>

      <div className="mt-4 flex flex-col gap-3 sm:mt-0 sm:items-end">
        <div className="flex flex-wrap gap-2 sm:justify-end">
          {recognizedRoles.map((role) => (
            <span
              key={role}
              className={`rounded-full border px-3 py-1 text-xs font-semibold ${
                role === "admin"
                  ? "border-orange-400/50 bg-orange-500/15 text-orange-300"
                  : "border-white/15 bg-white/[0.05] text-white/70"
              }`}
            >
              {ROLE_LABELS[role]}
            </span>
          ))}
        </div>
        <p className="text-sm text-white/45">
          Înscris la {formatJoinedAt(user.created_at)}
        </p>
      </div>
    </article>
  );
}
