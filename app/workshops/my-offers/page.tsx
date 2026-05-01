"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";

type ProfileRow = {
  role: string[] | null;
};

type RepairRequest = {
  id: string;
  car_brand: string | null;
  car_model: string | null;
  car_year: string | null;
  city: string | null;
  damage_type: string | null;
  description: string | null;
  status?: string | null;
  created_at?: string | null;
  accepted_offer_id?: string | null;
};

type RepairOffer = {
  id: string;
  request_id: string;
  workshop_user_id: string;
  workshop_name: string;
  price: number | string;
  days: number | string;
  message: string | null;
  status?: string | null;
  created_at: string;
  repair_requests?: RepairRequest | null;
};

type FilterKey = "all" | "pending" | "won" | "lost";

type DerivedOffer = RepairOffer & {
  derivedStatus: "pending" | "won" | "lost";
};

export default function WorkshopMyOffersPage() {
  const router = useRouter();

  const [authorized, setAuthorized] = useState(false);
  const [checkingAccess, setCheckingAccess] = useState(true);
  const [offers, setOffers] = useState<RepairOffer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState<FilterKey>("all");
  const [search, setSearch] = useState("");

  useEffect(() => {
    let isMounted = true;

    async function checkUserAndLoad() {
      try {
        setLoading(true);
        setError(null);

        const { data: authData } = await supabase.auth.getUser();

        if (!authData.user) {
          router.push("/login");
          return;
        }

        const { data: profile, error: profileError } = await supabase
          .from("profiles")
          .select("role")
          .eq("id", authData.user.id)
          .single<ProfileRow>();

        if (profileError) {
          console.error("Failed to load profile:", profileError);
          router.push("/");
          return;
        }

        const roles = Array.isArray(profile?.role) ? profile.role : [];

        if (!roles.includes("workshop")) {
          router.push("/");
          return;
        }

        if (!isMounted) return;
        setAuthorized(true);

        const { data, error } = await supabase
          .from("repair_offers")
          .select(
            `
            id,
            request_id,
            workshop_user_id,
            workshop_name,
            price,
            days,
            message,
            status,
            created_at,
            repair_requests (
              id,
              car_brand,
              car_model,
              car_year,
              city,
              damage_type,
              description,
              status,
              created_at,
              accepted_offer_id
            )
          `,
          )
          .eq("workshop_user_id", authData.user.id)
          .order("created_at", { ascending: false });

        if (!isMounted) return;

        if (error) {
          setError(error.message || "Failed to load offers.");
          setOffers([]);
        } else if (!data) {
          setOffers([]);
        } else {
          const mapped: RepairOffer[] = data.map(
            (row: any): RepairOffer => ({
              id: String(row.id),
              request_id: String(row.request_id),
              workshop_user_id: String(row.workshop_user_id),
              workshop_name: row.workshop_name || "",
              price: row.price ?? "",
              days: row.days ?? "",
              message: row.message || "",
              status: row.status || "pending",
              created_at: String(row.created_at),
              repair_requests: row.repair_requests
                ? {
                    id: String(row.repair_requests.id),
                    car_brand: row.repair_requests.car_brand ?? null,
                    car_model: row.repair_requests.car_model ?? null,
                    car_year: row.repair_requests.car_year ?? null,
                    city: row.repair_requests.city ?? null,
                    damage_type: row.repair_requests.damage_type ?? null,
                    description: row.repair_requests.description ?? null,
                    status: row.repair_requests.status ?? null,
                    created_at: row.repair_requests.created_at ?? null,
                    accepted_offer_id:
                      row.repair_requests.accepted_offer_id ?? null,
                  }
                : null,
            }),
          );

          setOffers(mapped);
        }
      } catch (err) {
        console.error("Failed to load workshop offers:", err);
        if (isMounted) {
          setError("Failed to load offers.");
          setOffers([]);
        }
      } finally {
        if (isMounted) {
          setLoading(false);
          setCheckingAccess(false);
        }
      }
    }

    checkUserAndLoad();

    return () => {
      isMounted = false;
    };
  }, [router]);

  const normalizedOffers = useMemo<DerivedOffer[]>(() => {
    return offers.map((offer) => {
      const requestStatus = offer.repair_requests?.status?.toLowerCase() || "";
      const offerStatus = offer.status?.toLowerCase() || "";
      const acceptedOfferId = offer.repair_requests?.accepted_offer_id || null;

      let derivedStatus: "pending" | "won" | "lost" = "pending";

      if (
        offerStatus === "accepted" ||
        (requestStatus === "matched" && acceptedOfferId === offer.id) ||
        requestStatus === "in_progress" ||
        requestStatus === "completed"
      ) {
        derivedStatus = "won";
      } else if (
        ["rejected", "declined", "lost"].includes(offerStatus) ||
        (requestStatus === "matched" &&
          acceptedOfferId !== null &&
          acceptedOfferId !== offer.id)
      ) {
        derivedStatus = "lost";
      }

      return {
        ...offer,
        derivedStatus,
      };
    });
  }, [offers]);

  const counts = useMemo(() => {
    return {
      all: normalizedOffers.length,
      pending: normalizedOffers.filter((o) => o.derivedStatus === "pending")
        .length,
      won: normalizedOffers.filter((o) => o.derivedStatus === "won").length,
      lost: normalizedOffers.filter((o) => o.derivedStatus === "lost").length,
    };
  }, [normalizedOffers]);

  const filteredOffers = useMemo(() => {
    const q = search.trim().toLowerCase();

    return normalizedOffers.filter((offer) => {
      const matchesFilter =
        activeFilter === "all" ? true : offer.derivedStatus === activeFilter;

      const request = offer.repair_requests;

      const haystack = [
        offer.workshop_name,
        String(offer.price),
        String(offer.days),
        offer.message || "",
        request?.car_brand,
        request?.car_model,
        request?.car_year,
        request?.city,
        request?.damage_type,
        request?.description,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      const matchesSearch = q ? haystack.includes(q) : true;

      return matchesFilter && matchesSearch;
    });
  }, [normalizedOffers, activeFilter, search]);

  function formatDate(value?: string | null) {
    if (!value) return "-";

    return new Date(value).toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  }

  function formatStatus(status: "pending" | "won" | "lost") {
  if (status === "won") return "Acceptată";
  if (status === "lost") return "Pierdută";
  return "În așteptare";
}

  function statusClasses(status: "pending" | "won" | "lost") {
    if (status === "won") {
      return "border-green-500/20 bg-green-500/15 text-green-300";
    }
    if (status === "lost") {
      return "border-red-500/20 bg-red-500/15 text-red-300";
    }
    return "border-yellow-500/20 bg-yellow-500/15 text-yellow-300";
  }

  function formatDamageType(value?: string | null) {
    switch (value) {
      case "scratch":
        return "Scratch";
      case "dent":
        return "Dent";
      case "bumper":
        return "Bumper damage";
      case "paint":
        return "Paint damage";
      case "cracked_part":
        return "Cracked part";
      default:
        return "Other";
    }
  }

  if (checkingAccess) {
    return (
      <main className="min-h-screen bg-black px-6 py-10 text-white">
        <div className="mx-auto flex min-h-[60vh] max-w-7xl items-center justify-center">
          <p className="text-white/70">Checking access...</p>
        </div>
      </main>
    );
  }

  if (!authorized) {
    return null;
  }

  return (
    <main className="min-h-screen bg-black px-6 py-10 text-white">
      <div className="mx-auto max-w-7xl">
        <div className="mb-6 flex flex-wrap gap-3">
          <Link
            href="/workshops/Panou"
            className="rounded-lg border border-white/15 bg-white/5 px-4 py-2 text-sm font-medium text-white/80 transition hover:bg-white/10"
          >
            Panou
          </Link>
          <Link
            href="/workshops"
            className="rounded-lg border border-white/15 bg-white/5 px-4 py-2 text-sm font-medium text-white/80 transition hover:bg-white/10"
          >
            Daune disponibile
          </Link>
          <Link
            href="/workshops/my-offers"
            className="rounded-lg bg-white px-4 py-2 text-sm font-semibold text-black"
          >
            Ofertele tale
          </Link>
          <Link
            href="/workshops/won-jobs"
            className="rounded-lg border border-white/15 bg-white/5 px-4 py-2 text-sm font-medium text-white/80 transition hover:bg-white/10"
          >
            Lucrări câștigate
          </Link>
        </div>

        <div className="mb-8 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-sm uppercase tracking-[0.2em] text-white/40">
              Workshop Panou
            </p>
            <h1 className="mt-2 text-3xl font-bold md:text-4xl">
              Ofertele tale
            </h1>
            <p className="mt-3 max-w-2xl text-white/70">
              Vezi ofertele trimise clienților și urmărește statusul fiecărei
              lucrări.
            </p>
          </div>
        </div>

        <section className="mb-6 rounded-2xl border border-white/10 bg-white/5 p-4">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap gap-2">
              {(
                [
                  ["all", `Toate (${counts.all})`],
                  ["pending", `În așteptare (${counts.pending})`],
                  ["won", `Acceptate (${counts.won})`],
                  ["lost", `Pierdute (${counts.lost})`],
                ] as [FilterKey, string][]
              ).map(([key, label]) => {
                const isActive = activeFilter === key;

                return (
                  <button
                    key={key}
                    onClick={() => setActiveFilter(key)}
                    className={`rounded-xl px-4 py-2 text-sm font-semibold transition ${
                      isActive
                        ? "bg-white text-black"
                        : "bg-white/5 text-white/80 hover:bg-white/10"
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>

            <div className="w-full lg:w-80">
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by car, city, damage type..."
                className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white outline-none transition placeholder:text-white/35 focus:border-white/25"
              />
            </div>
          </div>
        </section>

        {loading ? (
          <div className="rounded-2xl border border-white/10 bg-white/5 p-10 text-center text-sm text-white/70">
            Loading offers...
          </div>
        ) : error ? (
          <div className="rounded-2xl border border-red-500/20 bg-red-500/10 p-6 text-sm text-red-300">
            {error}
          </div>
        ) : filteredOffers.length === 0 ? (
          <div className="rounded-2xl border border-white/10 bg-white/5 p-10 text-center">
            <h2 className="text-lg font-semibold text-white">
              No offers found
            </h2>
            <p className="mt-2 text-sm text-white/60">
              Try another filter or send your first offer from the requests
              page.
            </p>
          </div>
        ) : (
          <div className="grid gap-4">
            {filteredOffers.map((offer) => {
              const request = offer.repair_requests;

              return (
                <article
                  key={offer.id}
                  className="rounded-2xl border border-white/10 bg-white/5 p-5 transition hover:bg-white/[0.07]"
                >
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-xl font-bold text-white">
                          {request?.car_brand || "Unknown brand"}{" "}
                          {request?.car_model || ""}
                          {request?.car_year ? ` (${request.car_year})` : ""}
                        </h2>

                        <span
                          className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${statusClasses(
                            offer.derivedStatus,
                          )}`}
                        >
                          {formatStatus(offer.derivedStatus)}
                        </span>
                      </div>

                      <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-sm text-white/60">
                        <span>
                          <strong>City:</strong> {request?.city || "-"}
                        </span>
                        <span>
                          <strong>Damage:</strong>{" "}
                          {formatDamageType(request?.damage_type)}
                        </span>
                        <span>
                          <strong>Sent:</strong> {formatDate(offer.created_at)}
                        </span>
                      </div>

                      <p className="mt-4 line-clamp-3 text-sm leading-6 text-white/75">
                        {request?.description || "No customer description."}
                      </p>
                    </div>

                    <div className="grid min-w-full gap-3 rounded-2xl bg-black/30 p-4 sm:min-w-[300px] lg:max-w-sm">
                      <div className="grid grid-cols-2 gap-3">
                        <InfoBox label="Your price" value={`€${offer.price}`} />
                        <InfoBox
                          label="Estimated days"
                          value={`${offer.days} days`}
                        />
                      </div>

                      <div>
                        <p className="text-xs font-semibold uppercase tracking-wide text-white/45">
                          Message
                        </p>
                        <p className="mt-1 text-sm leading-6 text-white/80">
                          {offer.message || "No message added."}
                        </p>
                      </div>

                      <div className="flex flex-wrap gap-3 pt-2">
                        <Link
                          href={`/workshops/${offer.request_id}`}
                          className="inline-flex items-center justify-center rounded-xl border border-white/20 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-white/10"
                        >
                          View request
                        </Link>

                        {offer.derivedStatus === "won" && (
                          <Link
                            href={`/workshops/${offer.request_id}`}
                            className="inline-flex items-center justify-center rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-black transition hover:opacity-90"
                          >
                            Open job
                          </Link>
                        )}
                      </div>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
      <p className="text-sm text-white/50">{label}</p>
      <p className="mt-2 text-3xl font-bold text-white">{value}</p>
    </div>
  );
}

function InfoBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-white/45">
        {label}
      </p>
      <p className="mt-1 text-base font-bold text-white">{value}</p>
    </div>
  );
}
