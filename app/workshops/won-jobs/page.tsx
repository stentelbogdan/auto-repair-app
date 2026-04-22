"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";

type JobFilter = "active" | "completed";

type ProfileRow = {
  role: string[] | null;
};

type WonJob = {
  offerId: string;
  requestId: string;
  workshopName: string;
  price: string;
  days: string;
  message: string;
  offerStatus: string;
  createdAt: string;
  request: {
    id: string;
    carBrand: string;
    carModel: string;
    carYear: string;
    city: string;
    damageType: string;
    description: string;
    images: {
      name: string;
      dataUrl: string;
    }[];
    status: string;
    acceptedOfferId: string | null;
    createdAt: string;
  };
};

export default function WorkshopWonJobsPage() {
  const router = useRouter();

  const [authorized, setAuthorized] = useState(false);
  const [checkingAccess, setCheckingAccess] = useState(true);
  const [loadingJobs, setLoadingJobs] = useState(false);
  const [jobs, setJobs] = useState<WonJob[]>([]);
  const [search, setSearch] = useState("");
  const [imageIndexes, setImageIndexes] = useState<Record<string, number>>({});
  const [activeTab, setActiveTab] = useState<JobFilter>("active");

  useEffect(() => {
    const checkUserAndLoad = async () => {
      try {
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

        setAuthorized(true);
        await loadWonJobs(authData.user.id);
      } catch (error) {
        console.error("Access check failed:", error);
        router.push("/login");
      } finally {
        setCheckingAccess(false);
      }
    };

    checkUserAndLoad();
  }, [router]);

  const loadWonJobs = async (userId: string) => {
    setLoadingJobs(true);

    try {
      const { data: offersData, error: offersError } = await supabase
        .from("repair_offers")
        .select(`
          id,
          request_id,
          workshop_user_id,
          workshop_name,
          price,
          days,
          message,
          status,
          created_at
        `)
        .eq("workshop_user_id", userId)
        .eq("status", "accepted")
        .order("created_at", { ascending: false });

      if (offersError) {
        throw offersError;
      }

      const requestIds = (offersData || []).map((offer: any) => offer.request_id);

      let requestsMap = new Map<string, any>();

      if (requestIds.length > 0) {
        const { data: requestsData, error: requestsError } = await supabase
          .from("repair_requests")
          .select(`
            id,
            car_brand,
            car_model,
            car_year,
            city,
            damage_type,
            description,
            images,
            status,
            accepted_offer_id,
            created_at
          `)
          .in("id", requestIds);

        if (requestsError) {
          throw requestsError;
        }

        requestsMap = new Map(
          (requestsData || []).map((request: any) => [request.id, request])
        );
      }

      const mapped: WonJob[] = (offersData || []).map((row: any) => {
        const request = requestsMap.get(row.request_id);

        return {
          offerId: row.id,
          requestId: row.request_id,
          workshopName: row.workshop_name || "Workshop",
          price: String(row.price ?? "-"),
          days: String(row.days ?? "-"),
          message: row.message || "",
          offerStatus: row.status || "accepted",
          createdAt: row.created_at,
          request: {
            id: row.request_id,
            carBrand: request?.car_brand || "Accepted job",
            carModel: request?.car_model || "",
            carYear: request?.car_year || "-",
            city: request?.city || "-",
            damageType: formatDamageType(request?.damage_type || "other"),
            description:
              request?.description ||
              "This accepted offer is now available in Won jobs.",
            images:
              Array.isArray(request?.images) && request.images.length > 0
                ? request.images.map((image: any) => ({
                    name: image?.name || "",
                    dataUrl: image?.dataUrl || "",
                  }))
                : [],
            status: request?.status || "matched",
            acceptedOfferId: request?.accepted_offer_id || row.id,
            createdAt: request?.created_at || row.created_at,
          },
        };
      });

      setJobs(mapped);
    } catch (error) {
      console.error("Failed to load won jobs:", error);
      setJobs([]);
    } finally {
      setLoadingJobs(false);
    }
  };

  const filteredJobs = useMemo(() => {
    const query = search.trim().toLowerCase();

    return jobs.filter((job) => {
      const isCompleted = job.request.status === "completed";
      const matchesTab =
        activeTab === "completed" ? isCompleted : !isCompleted;

      const haystack = [
        job.request.carBrand,
        job.request.carModel,
        job.request.carYear,
        job.request.city,
        job.request.damageType,
        job.request.description,
        job.workshopName,
        job.price,
        job.days,
      ]
        .join(" ")
        .toLowerCase();

      const matchesSearch = query ? haystack.includes(query) : true;

      return matchesTab && matchesSearch;
    });
  }, [jobs, search, activeTab]);

  const activeJobsCount = useMemo(() => {
    return jobs.filter((job) => job.request.status !== "completed").length;
  }, [jobs]);

  const completedJobsCount = useMemo(() => {
    return jobs.filter((job) => job.request.status === "completed").length;
  }, [jobs]);

  const averageQuotedPrice = useMemo(() => {
    if (!jobs.length) return "€0";

    const total = jobs.reduce((sum, job) => sum + Number(job.price || 0), 0);
    return `€${Math.round(total / jobs.length)}`;
  }, [jobs]);

  const getCurrentImageIndex = (jobId: string, imagesCount: number) => {
    if (!imagesCount) return 0;
    const current = imageIndexes[jobId] ?? 0;
    return Math.min(current, imagesCount - 1);
  };

  const goToPrevImage = (jobId: string, imagesCount: number) => {
    if (imagesCount <= 1) return;

    setImageIndexes((prev) => {
      const current = prev[jobId] ?? 0;
      return {
        ...prev,
        [jobId]: current === 0 ? imagesCount - 1 : current - 1,
      };
    });
  };

  const goToNextImage = (jobId: string, imagesCount: number) => {
    if (imagesCount <= 1) return;

    setImageIndexes((prev) => {
      const current = prev[jobId] ?? 0;
      return {
        ...prev,
        [jobId]: current === imagesCount - 1 ? 0 : current + 1,
      };
    });
  };

  if (checkingAccess) {
    return (
      <main className="min-h-screen bg-black px-6 pb-10 pt-4 text-white">
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
    <main className="min-h-screen bg-black px-6 pb-10 pt-4 text-white">
      <div className="mx-auto max-w-7xl">
        <div className="mb-6 flex flex-wrap gap-3">
          <Link
            href="/workshops/dashboard"
            className="rounded-lg border border-white/15 bg-white/5 px-4 py-2 text-sm font-medium text-white/80 transition hover:bg-white/10"
          >
            Dashboard
          </Link>
          <Link
            href="/workshops"
            className="rounded-lg border border-white/15 bg-white/5 px-4 py-2 text-sm font-medium text-white/80 transition hover:bg-white/10"
          >
            Browse requests
          </Link>
          <Link
            href="/workshops/my-offers"
            className="rounded-lg border border-white/15 bg-white/5 px-4 py-2 text-sm font-medium text-white/80 transition hover:bg-white/10"
          >
            My offers
          </Link>
          <Link
            href="/workshops/won-jobs"
            className="rounded-lg bg-white px-4 py-2 text-sm font-semibold text-black"
          >
            Won jobs
          </Link>
        </div>

        <div className="mb-8 flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-sm uppercase tracking-[0.2em] text-white/40">
              Workshop dashboard
            </p>
            <h1 className="mt-2 text-3xl font-bold md:text-4xl">Won jobs</h1>
            <p className="mt-3 max-w-2xl text-white/70">
              These are the repair jobs your workshop has won and can now start
              working on.
            </p>
          </div>

          <div className="w-full lg:w-96">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by car, city, damage type..."
              className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none placeholder:text-white/35 focus:border-white/25"
            />
          </div>
        </div>

        <div className="mb-6 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => setActiveTab("active")}
            className={`rounded-xl px-4 py-2 text-sm font-semibold transition ${
              activeTab === "active"
                ? "bg-white text-black"
                : "border border-white/15 bg-white/5 text-white/80 hover:bg-white/10"
            }`}
          >
            Active jobs ({activeJobsCount})
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("completed")}
            className={`rounded-xl px-4 py-2 text-sm font-semibold transition ${
              activeTab === "completed"
                ? "bg-white text-black"
                : "border border-white/15 bg-white/5 text-white/80 hover:bg-white/10"
            }`}
          >
            Completed jobs ({completedJobsCount})
          </button>
        </div>

        <div className="mb-8 grid grid-cols-1 gap-4 lg:grid-cols-3">
            <StatCard label="Active jobs" value={activeJobsCount} />
            <StatCard label="Completed jobs" value={completedJobsCount} />
            <StatCard label="Average quoted price" value={averageQuotedPrice} />
        </div>

        {loadingJobs ? (
          <div className="rounded-2xl border border-white/10 bg-white/5 p-10 text-center">
            <p className="text-white/70">Loading won jobs...</p>
          </div>
        ) : filteredJobs.length === 0 ? (
          <div className="rounded-2xl border border-white/10 bg-white/5 p-10 text-center">
            <h2 className="text-2xl font-semibold">
              {activeTab === "completed" ? "No completed jobs yet" : "No active jobs yet"}
            </h2>
            <p className="mt-3 text-white/70">
              {activeTab === "completed"
                ? "Completed repair jobs will appear here."
                : "When a customer accepts one of your offers, the job will appear here."}
            </p>

            <div className="mt-6 flex flex-col gap-3 md:flex-row md:justify-center">
              <button
                onClick={() => router.push("/workshops")}
                className="rounded-lg bg-white px-6 py-3 font-semibold text-black"
              >
                Browse requests
              </button>
              <button
                onClick={() => router.push("/workshops/my-offers")}
                className="rounded-lg border border-white/20 px-6 py-3 font-semibold text-white"
              >
                View my offers
              </button>
            </div>
          </div>
        ) : (
          <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
            {filteredJobs.map((job) => (
              <article
                key={job.offerId}
                className="group overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-b from-white/[0.07] to-white/[0.03] shadow-[0_30px_100px_rgba(0,0,0,0.55)] transition duration-300 hover:-translate-y-1 hover:border-white/20 hover:shadow-[0_40px_120px_rgba(0,0,0,0.7)]"
              >
                <div className="relative">
                  {job.request.images &&
                  job.request.images.length > 0 &&
                  job.request.images[
                    getCurrentImageIndex(job.offerId, job.request.images.length)
                  ]?.dataUrl ? (
                    <div className="relative h-64 w-full overflow-hidden bg-white/5">
                      <img
                        src={
                          job.request.images[
                            getCurrentImageIndex(job.offerId, job.request.images.length)
                          ].dataUrl
                        }
                        alt={`${job.request.carBrand} ${job.request.carModel}`}
                        className="h-full w-full object-cover transition duration-500"
                      />

                      {job.request.status === "completed" && (
                    <div className="absolute inset-0 bg-green-500/10 backdrop-blur-[2px]" />
                    )}

                      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-transparent" />

                      {job.request.images.length > 1 && (
                        <>
                          <button
                            type="button"
                            onClick={() =>
                              goToPrevImage(job.offerId, job.request.images.length)
                            }
                            className="absolute left-3 top-1/2 -translate-y-1/2 rounded-full border border-white/15 bg-black/50 px-3 py-2 text-sm font-semibold text-white backdrop-blur transition hover:bg-black/70"
                          >
                            ‹
                          </button>

                          <button
                            type="button"
                            onClick={() =>
                              goToNextImage(job.offerId, job.request.images.length)
                            }
                            className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full border border-white/15 bg-black/50 px-3 py-2 text-sm font-semibold text-white backdrop-blur transition hover:bg-black/70"
                          >
                            ›
                          </button>

                          <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 gap-2">
                            {job.request.images.map((_, index) => {
                              const isActive =
                                index ===
                                getCurrentImageIndex(
                                  job.offerId,
                                  job.request.images.length
                                );

                              return (
                                <button
                                  key={index}
                                  type="button"
                                  onClick={() =>
                                    setImageIndexes((prev) => ({
                                      ...prev,
                                      [job.offerId]: index,
                                    }))
                                  }
                                  className={`h-2.5 w-2.5 rounded-full transition ${
                                    isActive ? "bg-white" : "bg-white/35"
                                  }`}
                                />
                              );
                            })}
                          </div>

                          <div className="absolute right-3 top-3 rounded-full border border-white/10 bg-black/50 px-2.5 py-1 text-xs text-white/80 backdrop-blur">
                            {getCurrentImageIndex(job.offerId, job.request.images.length) + 1}/
                            {job.request.images.length}
                          </div>
                        </>
                      )}
                    </div>
                  ) : (
                    <div className="flex h-64 items-center justify-center bg-white/5 text-white/40">
                      No photo uploaded
                    </div>
                  )}

                  <div className="absolute left-4 top-4">
                <span
                className={`px-4 py-1.5 text-xs font-bold uppercase tracking-[0.2em] rounded-full backdrop-blur ${
                job.request.status === "completed"
                    ? "bg-green-500 text-black"
                    : job.request.status === "in_progress"
                    ? "bg-blue-500 text-black"
                    : "bg-yellow-400 text-black"
                }`}
                >
                {formatJobStatus(job.request.status)}
            </span>
        </div>

                  <div className="absolute bottom-4 left-4 right-4 flex items-end justify-between gap-4">
                    <div>
                      <p className="text-xs uppercase tracking-[0.22em] text-white/50">
                        {formatJobStatus(job.request.status)} repair
                    </p>
                      <h2 className="mt-2 text-3xl font-bold tracking-tight text-white">
                        {job.request.carBrand} {job.request.carModel}
                      </h2>
                      <p className="mt-1 text-sm text-white/70">
                        {job.request.carYear} • {job.request.city}
                      </p>
                    </div>

                    <div className="shrink-0 rounded-2xl border border-white/10 bg-black/45 px-4 py-3 text-right backdrop-blur">
                      <p className="text-[11px] uppercase tracking-[0.18em] text-white/45">
                        Your offer
                      </p>
                      <p className="mt-1 text-3xl font-extrabold tracking-tight text-white">
                        €{job.price}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="p-5">
                  <div className="mb-4 flex flex-wrap gap-2">
                    <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-black">
                      {job.request.damageType}
                    </span>
                    <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-white/70">
                      {job.days} day{job.days !== "1" ? "s" : ""}
                    </span>
                    <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-white/70">
                      {job.workshopName}
                    </span>
                  </div>

                  <div className="rounded-2xl border border-white/10 bg-black/25 p-4">
                    <p className="text-[11px] uppercase tracking-[0.18em] text-white/45">
                      Customer request
                    </p>
                    <p className="mt-2 min-h-[72px] text-sm leading-6 text-white/80">
                      {job.request.description}
                    </p>
                  </div>

                  <div className="mt-4 rounded-2xl border border-white/10 bg-black/25 p-4">
                    <p className="text-[11px] uppercase tracking-[0.18em] text-white/45">
                      Your message
                    </p>
                    <p className="mt-2 text-sm leading-6 text-white/80">
                      {job.message || "No message provided."}
                    </p>
                  </div>

                  <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <button
                      onClick={() => router.push(`/workshops/${job.requestId}`)}
                      className="rounded-2xl border border-white/15 bg-white/5 px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/10"
                    >
                      View request
                    </button>

                    <button
                      onClick={() => router.push(`/workshops/${job.requestId}`)}
                      className="rounded-2xl bg-white px-4 py-3 text-sm font-semibold text-black transition hover:opacity-90"
                    >
                      Open job
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}

function StatCard({
  label,
  value,
}: {
  label: string;
  value: string | number;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
      <p className="text-sm text-white/50">{label}</p>
      <p className="mt-2 text-3xl font-bold text-white">{value}</p>
    </div>
  );
}

function formatDamageType(value: string) {
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

function formatJobStatus(value: string) {
  switch (value) {
    case "completed":
      return "Completed";
    case "in_progress":
      return "In progress";
    case "matched":
      return "Accepted";
    default:
      return "Open";
  }
}

function getJobStatusClass(value: string) {
  switch (value) {
    case "completed":
      return "rounded-full border border-green-500/20 bg-green-500/15 px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-green-300";
    case "in_progress":
      return "rounded-full border border-blue-500/20 bg-blue-500/15 px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-blue-300";
    case "matched":
      return "rounded-full border border-yellow-500/20 bg-yellow-500/15 px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-yellow-300";
    default:
      return "rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-white/70";
  }
}