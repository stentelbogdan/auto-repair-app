"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";

type RepairRequest = {
  id: string;
  carBrand: string;
  carModel: string;
  carYear: string;
  city: string;
  damageType: string;
  description: string;
  status?: string;
  acceptedOfferId?: string;
  images?: {
    name: string;
    dataUrl: string;
  }[];
};

type RepairOffer = {
  id: string;
  requestId: string;
  price: string;
  days: string;
  message: string;
  workshopName: string;
  createdAt: string;
  status?: string;
};

type AcceptedJob = {
  request: RepairRequest;
  offer: RepairOffer;
  commissionAmount: number;
};

type ProfileRow = {
  role: string[] | null;
};

const COMMISSION_RATE = 0.1;

export default function AdminPage() {
  const router = useRouter();
  const [requests, setRequests] = useState<RepairRequest[]>([]);
  const [offers, setOffers] = useState<RepairOffer[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);
  const [authorized, setAuthorized] = useState(false);
  const [checkingAccess, setCheckingAccess] = useState(true);

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

        if (!roles.includes("admin")) {
          router.push("/");
          return;
        }

        setAuthorized(true);
        loadAdminData();
      } catch (error) {
        console.error("Access check failed:", error);
        router.push("/login");
      } finally {
        setCheckingAccess(false);
      }
    };

    checkUserAndLoad();
  }, [router]);

  const loadAdminData = () => {
    try {
      const savedRequests = JSON.parse(
        localStorage.getItem("repairRequests") || "[]"
      ) as RepairRequest[];

      const savedOffers = JSON.parse(
        localStorage.getItem("repairOffers") || "[]"
      ) as RepairOffer[];

      setRequests(savedRequests);
      setOffers(savedOffers);
    } catch (error) {
      console.error("Failed to load admin data:", error);
      setRequests([]);
      setOffers([]);
    } finally {
      setIsLoaded(true);
    }
  };

  const acceptedJobs = useMemo<AcceptedJob[]>(() => {
    const acceptedOffers = offers.filter((offer) => offer.status === "accepted");

    return acceptedOffers
      .map((offer) => {
        const request = requests.find((req) => req.id === offer.requestId);
        if (!request) return null;

        const priceNumber = Number(offer.price) || 0;
        const commissionAmount = priceNumber * COMMISSION_RATE;

        return {
          request,
          offer,
          commissionAmount,
        };
      })
      .filter((item): item is AcceptedJob => item !== null)
      .sort(
        (a, b) =>
          new Date(b.offer.createdAt).getTime() -
          new Date(a.offer.createdAt).getTime()
      );
  }, [requests, offers]);

  const recentAcceptedJobs = acceptedJobs.slice(0, 5);

  const totalRequests = requests.length;
  const openRequests = requests.filter(
    (request) => (request.status || "open") === "open"
  ).length;
  const matchedRequests = requests.filter(
    (request) => request.status === "matched"
  ).length;

  const totalOffers = offers.length;
  const pendingOffers = offers.filter(
    (offer) => (offer.status || "pending") === "pending"
  ).length;
  const acceptedOffersCount = offers.filter(
    (offer) => offer.status === "accepted"
  ).length;
  const rejectedOffersCount = offers.filter(
    (offer) => offer.status === "rejected"
  ).length;

  const totalAcceptedValue = acceptedJobs.reduce(
    (sum, job) => sum + (Number(job.offer.price) || 0),
    0
  );

  const totalEstimatedCommission = acceptedJobs.reduce(
    (sum, job) => sum + job.commissionAmount,
    0
  );

  if (checkingAccess) {
    return (
      <main className="min-h-screen bg-black flex items-center justify-center text-white">
        <p className="text-white/70">Checking admin access...</p>
      </main>
    );
  }

  if (!authorized) {
    return null;
  }

  if (!isLoaded) {
    return (
      <main className="min-h-screen bg-black flex items-center justify-center text-white">
        <p className="text-white/70">Loading admin dashboard...</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-black px-6 py-10 text-white">
      <div className="mx-auto max-w-7xl">
        <div className="mb-8 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-sm uppercase tracking-[0.2em] text-white/40">
              Admin dashboard
            </p>
            <h1 className="mt-2 text-3xl font-bold md:text-4xl">
              Marketplace overview
            </h1>
            <p className="mt-3 max-w-3xl text-white/70">
              Track jobs, offers, and your platform revenue in real time.
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            <button
              onClick={() => router.push("/workshops")}
              className="rounded-lg border border-white/20 px-5 py-3 text-sm font-semibold text-white"
            >
              Find jobs
            </button>

            <button
              onClick={() => router.push("/offers")}
              className="rounded-lg border border-white/20 px-5 py-3 text-sm font-semibold text-white"
            >
              My offers
            </button>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <KpiCard label="Total requests" value={String(totalRequests)} />
          <KpiCard label="Open requests" value={String(openRequests)} />
          <KpiCard label="Matched requests" value={String(matchedRequests)} />
          <KpiCard label="Total offers" value={String(totalOffers)} />
        </div>

        <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <KpiCard label="Pending offers" value={String(pendingOffers)} />
          <KpiCard label="Accepted offers" value={String(acceptedOffersCount)} />
          <KpiCard label="Rejected offers" value={String(rejectedOffersCount)} />
          <KpiCard
            label="Commission rate"
            value={`${Math.round(COMMISSION_RATE * 100)}%`}
          />
        </div>

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <HighlightCard
            label="Total accepted value"
            value={`€${formatMoney(totalAcceptedValue)}`}
            sublabel="Total value of accepted jobs"
          />

          <HighlightCard
            label="Estimated commission"
            value={`€${formatMoney(totalEstimatedCommission)}`}
            sublabel="Based on accepted offers only"
          />
        </div>

        <div className="mt-10 grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
          <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
            <div className="mb-5 flex items-center justify-between">
              <div>
                <h2 className="text-2xl font-bold">Accepted jobs</h2>
                <p className="mt-1 text-sm text-white/60">
                  Jobs that already generated revenue opportunity for the platform
                </p>
              </div>

              <span className="rounded-full border border-white/10 bg-black/30 px-3 py-1 text-sm text-white/70">
                {acceptedJobs.length} accepted
              </span>
            </div>

            {acceptedJobs.length === 0 ? (
              <div className="rounded-xl border border-white/10 bg-black/20 p-8 text-center">
                <p className="text-white/70">No accepted jobs yet.</p>
              </div>
            ) : (
              <div className="space-y-4">
                {acceptedJobs.map((job) => (
                  <div
                    key={job.offer.id}
                    className="overflow-hidden rounded-xl border border-white/10 bg-black/20"
                  >
                    <div className="grid gap-0 md:grid-cols-[180px_1fr]">
                      <div className="bg-black/30">
                        {job.request.images && job.request.images.length > 0 ? (
                          <img
                            src={job.request.images[0]?.dataUrl || ""}
                            alt={`${job.request.carBrand} ${job.request.carModel}`}
                            className="h-full min-h-[180px] w-full object-cover"
                          />
                        ) : (
                          <div className="flex min-h-[180px] items-center justify-center text-white/40">
                            No photo
                          </div>
                        )}
                      </div>

                      <div className="p-5">
                        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                          <div>
                            <h3 className="text-2xl font-semibold">
                              {job.request.carBrand} {job.request.carModel}
                            </h3>
                            <p className="mt-1 text-sm text-white/55">
                              {job.request.carYear} • {job.request.city} •{" "}
                              {formatDamageType(job.request.damageType)}
                            </p>
                          </div>

                          <span className="rounded-full border border-green-500/20 bg-green-500/15 px-3 py-1 text-xs font-medium text-green-300">
                            Accepted
                          </span>
                        </div>

                        <div className="mt-4 grid gap-3 md:grid-cols-3">
                          <InfoCard
                            label="Workshop"
                            value={job.offer.workshopName}
                          />
                          <InfoCard
                            label="Accepted price"
                            value={`€${formatMoney(Number(job.offer.price) || 0)}`}
                          />
                          <InfoCard
                            label="Your commission"
                            value={`€${formatMoney(job.commissionAmount)}`}
                          />
                        </div>

                        <div className="mt-4 rounded-lg border border-white/10 bg-black/20 p-4">
                          <p className="text-sm text-white/50">Workshop message</p>
                          <p className="mt-1 text-white/85">
                            {job.offer.message || "No message provided."}
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-6">
            <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
              <h2 className="text-2xl font-bold">Business summary</h2>
              <p className="mt-1 text-sm text-white/60">
                Quick admin view of current marketplace performance
              </p>

              <div className="mt-5 space-y-4">
                <SummaryRow
                  label="Total requests created"
                  value={String(totalRequests)}
                />
                <SummaryRow
                  label="Total offers submitted"
                  value={String(totalOffers)}
                />
                <SummaryRow
                  label="Accepted jobs"
                  value={String(acceptedOffersCount)}
                />
                <SummaryRow
                  label="Rejected offers"
                  value={String(rejectedOffersCount)}
                />
                <SummaryRow
                  label="Pending offers"
                  value={String(pendingOffers)}
                />
                <SummaryRow
                  label="Marketplace gross value"
                  value={`€${formatMoney(totalAcceptedValue)}`}
                />
                <SummaryRow
                  label="Estimated platform revenue"
                  value={`€${formatMoney(totalEstimatedCommission)}`}
                  highlight
                />
              </div>

              <div className="mt-6 rounded-xl border border-white/10 bg-black/20 p-4">
                <p className="text-sm text-white/50">Monetization model</p>
                <p className="mt-2 text-white/85">
                  Platform commission is currently set to{" "}
                  <span className="font-semibold text-white">
                    {Math.round(COMMISSION_RATE * 100)}%
                  </span>{" "}
                  of each accepted offer.
                </p>
              </div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <h2 className="text-2xl font-bold">Recently accepted jobs</h2>
                  <p className="mt-1 text-sm text-white/60">
                    Latest jobs that generated commission
                  </p>
                </div>

                <span className="rounded-full border border-white/10 bg-black/30 px-3 py-1 text-sm text-white/70">
                  {recentAcceptedJobs.length}
                </span>
              </div>

              {recentAcceptedJobs.length === 0 ? (
                <div className="rounded-xl border border-white/10 bg-black/20 p-6 text-center">
                  <p className="text-white/70">No accepted jobs yet.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {recentAcceptedJobs.map((job) => (
                    <div
                      key={`recent-${job.offer.id}`}
                      className="rounded-xl border border-white/10 bg-black/20 p-4"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-semibold text-white">
                            {job.request.carBrand} {job.request.carModel}
                          </p>
                          <p className="mt-1 text-sm text-white/55">
                            {job.request.city} • {job.offer.workshopName}
                          </p>
                        </div>

                        <span className="rounded-full border border-green-500/20 bg-green-500/15 px-3 py-1 text-xs font-medium text-green-300">
                          Accepted
                        </span>
                      </div>

                      <div className="mt-3 grid grid-cols-2 gap-3">
                        <div className="rounded-lg border border-white/10 bg-black/20 p-3">
                          <p className="text-xs text-white/50">Job value</p>
                          <p className="mt-1 font-semibold text-white">
                            €{formatMoney(Number(job.offer.price) || 0)}
                          </p>
                        </div>

                        <div className="rounded-lg border border-white/10 bg-black/20 p-3">
                          <p className="text-xs text-white/50">Commission</p>
                          <p className="mt-1 font-semibold text-green-300">
                            €{formatMoney(job.commissionAmount)}
                          </p>
                        </div>
                      </div>

                      <p className="mt-3 text-xs text-white/45">
                        {formatDate(job.offer.createdAt)}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}

function KpiCard({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
      <p className="text-sm text-white/50">{label}</p>
      <p className="mt-2 text-3xl font-bold">{value}</p>
    </div>
  );
}

function HighlightCard({
  label,
  value,
  sublabel,
}: {
  label: string;
  value: string;
  sublabel: string;
}) {
  return (
    <div className="rounded-2xl border border-green-500/20 bg-green-500/10 p-6">
      <p className="text-sm text-white/60">{label}</p>
      <p className="mt-2 text-4xl font-bold">{value}</p>
      <p className="mt-2 text-sm text-white/60">{sublabel}</p>
    </div>
  );
}

function InfoCard({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-lg border border-white/10 bg-black/20 p-4">
      <p className="text-sm text-white/50">{label}</p>
      <p className="mt-1 text-lg font-semibold">{value}</p>
    </div>
  );
}

function SummaryRow({
  label,
  value,
  highlight = false,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-white/10 bg-black/20 px-4 py-3">
      <span className="text-sm text-white/65">{label}</span>
      <span className={highlight ? "font-bold text-green-300" : "font-semibold"}>
        {value}
      </span>
    </div>
  );
}

function formatDamageType(value: string) {
  switch (value) {
    case "scratch":
    case "Scratch":
      return "Scratch";
    case "dent":
    case "Dent":
      return "Dent";
    case "bumper":
    case "Bumper damage":
      return "Bumper damage";
    case "paint":
    case "Paint damage":
      return "Paint damage";
    case "cracked_part":
    case "Cracked part":
      return "Cracked part";
    default:
      return "Other";
  }
}

function formatMoney(value: number) {
  return value.toFixed(2);
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Unknown date";
  }

  return date.toLocaleString();
}