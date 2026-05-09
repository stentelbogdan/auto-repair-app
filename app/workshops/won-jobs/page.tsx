"use client";

import { useEffect, useMemo, useState } from "react";
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
      url?: string;
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
      const { data: authData } = await supabase.auth.getUser();

      if (!authData.user) {
        router.push("/login");
        return;
      }

      const { data: profile } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", authData.user.id)
        .single<ProfileRow>();

      const roles = Array.isArray(profile?.role) ? profile.role : [];

      if (!roles.includes("workshop")) {
        router.push("/");
        return;
      }

      setAuthorized(true);
      await loadWonJobs(authData.user.id);
      setCheckingAccess(false);
    };

    checkUserAndLoad();
  }, [router]);

  const loadWonJobs = async (userId: string) => {
    setLoadingJobs(true);

    const { data: offersData } = await supabase
      .from("repair_offers")
      .select("*")
      .eq("workshop_user_id", userId)
      .eq("status", "accepted");

    const requestIds = (offersData || []).map((o: any) => o.request_id);

    const { data: requestsData } = await supabase
      .from("repair_requests")
      .select("*")
      .in("id", requestIds);

    const requestsMap = new Map(
      (requestsData || []).map((r: any) => [r.id, r]),
    );

    const mapped: WonJob[] = (offersData || []).map((row: any) => {
      const request = requestsMap.get(row.request_id);

      return {
        offerId: row.id,
        requestId: row.request_id,
        workshopName: row.workshop_name || "Service",
        price: String(row.price ?? "-"),
        days: String(row.days ?? "-"),
        message: row.message || "",
        offerStatus: row.status || "accepted",
        createdAt: row.created_at,
        request: {
          id: row.request_id,
          carBrand: request?.car_brand || "",
          carModel: request?.car_model || "",
          carYear: request?.car_year || "",
          city: request?.city || "",
          damageType: formatDamageType(request?.damage_type || ""),
          description: request?.description || "",
          images: Array.isArray(request?.images) ? request.images : [],
          status: request?.status || "matched",
          acceptedOfferId: request?.accepted_offer_id || row.id,
          createdAt: request?.created_at || row.created_at,
        },
      };
    });

    setJobs(mapped);
    setLoadingJobs(false);
  };

  const filteredJobs = useMemo(() => {
    return jobs.filter((job) => {
      const isCompleted = job.request.status === "completed";
      return activeTab === "completed" ? isCompleted : !isCompleted;
    });
  }, [jobs, activeTab]);

  const stickyJob = filteredJobs[0];

  const startJob = async (job: WonJob) => {
    await supabase
      .from("repair_requests")
      .update({ status: "in_progress" })
      .eq("id", job.requestId);

    loadWonJobs(job.requestId);
  };

  const markAsCompleted = async (job: WonJob) => {
    await supabase
      .from("repair_requests")
      .update({ status: "completed" })
      .eq("id", job.requestId);

    loadWonJobs(job.requestId);
  };

  if (checkingAccess) return null;
  if (!authorized) return null;

  return (
    <main className="min-h-screen bg-black px-6 pb-32 pt-4 text-white">
      <h1 className="text-3xl font-bold mb-6">Lucrări câștigate</h1>

      <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
        {filteredJobs.map((job) => (
          <article key={job.offerId} className="rounded-3xl bg-white/5 p-5">
            <h2 className="text-xl font-bold">
              {job.request.carBrand} {job.request.carModel}
            </h2>

            <p className="text-white/60 mt-1">
              {job.request.city} • {job.request.carYear}
            </p>

            <p className="mt-3">{job.request.description}</p>

            <div className="mt-4 grid gap-2">
              <button
                onClick={() => router.push(`/workshops/${job.requestId}`)}
                className="bg-white text-black rounded-xl py-2"
              >
                Deschide lucrarea
              </button>

              {job.request.status === "matched" && (
                <button
                  onClick={() => startJob(job)}
                  className="hidden md:block bg-blue-500 rounded-xl py-2"
                >
                  Începe lucrarea
                </button>
              )}

              {job.request.status === "in_progress" && (
                <button
                  onClick={() => markAsCompleted(job)}
                  className="hidden md:block bg-green-500 rounded-xl py-2"
                >
                  Finalizează
                </button>
              )}
            </div>
          </article>
        ))}
      </div>

      {/* STICKY MOBILE */}
      {stickyJob && stickyJob.request.status !== "completed" && (
        <div className="fixed bottom-0 left-0 right-0 bg-black p-4 md:hidden">
          {stickyJob.request.status === "matched" && (
            <button
              onClick={() => startJob(stickyJob)}
              className="w-full bg-blue-500 py-4 rounded-2xl"
            >
              Începe lucrarea
            </button>
          )}

          {stickyJob.request.status === "in_progress" && (
            <button
              onClick={() => markAsCompleted(stickyJob)}
              className="w-full bg-green-500 py-4 rounded-2xl"
            >
              Marchează ca finalizată
            </button>
          )}
        </div>
      )}
    </main>
  );
}

function formatDamageType(value: string) {
  switch (value) {
    case "dent":
      return "Îndoitură";
    default:
      return "Altă daună";
  }
}
