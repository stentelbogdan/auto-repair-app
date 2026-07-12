"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import ImageGallery from "@/app/components/ImageGallery";
import CarHeader from "@/app/components/CarHeader";
import { Wrench } from "lucide-react";

type JobFilter = "appointments" | "workshop" | "completed";

type JobStage = "appointments" | "workshop" | "completed";
type JobPriority = "needs_action" | "waiting" | "ok";

type ProfileRow = {
  role: string[] | null;
};

type JobImage = {
  name: string;
  dataUrl: string;
  url?: string;
};

type RepairAppointment = {
  id: string;
  request_id: string;
  appointment_date: string;
  appointment_time: string;
  handover_method: "customer_dropoff" | "workshop_pickup";
  pickup_address: string | null;
  customer_note: string | null;
  workshop_note: string | null;
  proposed_date: string | null;
  proposed_time: string | null;
  updated_at?: string | null;
  status:
    | "workshop_proposed"
    | "customer_proposed"
    | "confirmed"
    | "declined"
    | "cancelled";
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
  latestProgressStatus?: string | null;
  appointment?: RepairAppointment | null;
  request: {
    id: string;
    carBrand: string;
    carModel: string;
    carYear: string;
    city: string;
    licensePlate: string | null;
    damageType: string;
    description: string;
    images: JobImage[];
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
  const [activeTab, setActiveTab] = useState<JobFilter>("appointments");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tab = params.get("tab");

    if (tab === "appointments" || tab === "workshop" || tab === "completed") {
      setActiveTab(tab);
    }
  }, []);

  const [editingAppointmentId, setEditingAppointmentId] = useState<
    string | null
  >(null);
  const [newAppointmentDate, setNewAppointmentDate] = useState("");
  const [newAppointmentTime, setNewAppointmentTime] = useState("");

  useEffect(() => {
    localStorage.setItem("activeRole", "workshop");
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

        const { error: readError } = await supabase
          .from("repair_offers")
          .update({
            workshop_read_at: new Date().toISOString(),
          })
          .eq("workshop_user_id", authData.user.id)
          .eq("status", "accepted")
          .is("workshop_read_at", null);

        if (readError) {
          console.error("Failed to mark won jobs as read:", readError);
        }

        await loadWonJobs(authData.user.id);

        setTimeout(() => {
          window.dispatchEvent(new Event("offers-read-updated"));
        }, 300);
      } catch (error) {
        console.error("Access check failed:", error);
        router.push("/login");
      } finally {
        setCheckingAccess(false);
      }
    };

    checkUserAndLoad();
  }, [router]);

  useEffect(() => {
    const channel = supabase
      .channel("workshop-appointments-live")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "repair_appointments",
        },
        async () => {
          const { data: authData } = await supabase.auth.getUser();

          if (authData.user) {
            await loadWonJobs(authData.user.id);
          }
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const loadWonJobs = async (userId: string) => {
    setLoadingJobs(true);

    try {
      const { data: offersData, error: offersError } = await supabase
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
  workshop_read_at
`,
        )
        .eq("workshop_user_id", userId)
        .eq("status", "accepted")
        .order("created_at", { ascending: false });

      if (offersError) throw offersError;

      const unreadAcceptedOfferIds = (offersData || [])
        .filter((offer: any) => !offer.workshop_read_at)
        .map((offer: any) => offer.id);

      if (unreadAcceptedOfferIds.length > 0) {
        const { error: markReadError } = await supabase
          .from("repair_offers")
          .update({ workshop_read_at: new Date().toISOString() })
          .in("id", unreadAcceptedOfferIds);

        if (markReadError) {
          console.error("Failed to mark won jobs as read:", markReadError);
        } else {
          setTimeout(() => {
            window.dispatchEvent(new Event("offers-read-updated"));
          }, 300);
        }
      }

      const requestIds = (offersData || []).map(
        (offer: any) => offer.request_id,
      );

      let appointmentsMap = new Map<string, RepairAppointment>();

      if (requestIds.length > 0) {
        const { data: appointmentsData, error: appointmentsError } =
          await supabase
            .from("repair_appointments")
            .select(
              "id, request_id, appointment_date, appointment_time, handover_method, pickup_address, customer_note, workshop_note, proposed_date, proposed_time, status, updated_at",
            )
            .in("request_id", requestIds)
            .order("updated_at", { ascending: false });

        if (appointmentsError) {
          console.error("Failed to load appointments:", appointmentsError);
        }

        appointmentsMap = new Map();

        (appointmentsData || []).forEach((appointment: any) => {
          if (!appointmentsMap.has(appointment.request_id)) {
            appointmentsMap.set(
              appointment.request_id,
              appointment as RepairAppointment,
            );
          }
        });
      }

      let requestsMap = new Map<string, any>();

      let latestProgressMap = new Map<string, string>();

      if (requestIds.length > 0) {
        const { data: progressData } = await supabase
          .from("work_progress_updates")
          .select("request_id, status, created_at")
          .in("request_id", requestIds)
          .order("created_at", { ascending: false });

        latestProgressMap = new Map();

        (progressData || []).forEach((item: any) => {
          if (!latestProgressMap.has(item.request_id)) {
            latestProgressMap.set(item.request_id, item.status);
          }
        });
      }

      if (requestIds.length > 0) {
        const { data: requestsData, error: requestsError } = await supabase
          .from("repair_requests")
          .select(
            `
            id,
            car_brand,
            car_model,
            car_year,
            city,
            license_plate,
            damage_type,
            description,
            images,
            status,
            accepted_offer_id,
            created_at
          `,
          )
          .in("id", requestIds);

        if (requestsError) throw requestsError;

        requestsMap = new Map(
          (requestsData || []).map((request: any) => [request.id, request]),
        );
      }

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
          latestProgressStatus: latestProgressMap.get(row.request_id) || null,
          createdAt: row.created_at,
          appointment: appointmentsMap.get(row.request_id) || null,
          request: {
            id: row.request_id,
            carBrand: request?.car_brand || "Lucrare acceptată",
            carModel: request?.car_model || "",
            carYear: request?.car_year || "-",
            city: request?.city || "-",
            licensePlate: request?.license_plate || null,
            damageType: formatDamageType(request?.damage_type || "other"),
            description:
              request?.description ||
              "Această lucrare acceptată este acum disponibilă aici.",
            images:
              Array.isArray(request?.images) && request.images.length > 0
                ? request.images.map((image: any) => ({
                    name: image?.name || "",
                    dataUrl: image?.dataUrl || image?.url || "",
                    url: image?.url || "",
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
      const jobState = getJobState(job);

      const shouldShowInWonJobs =
        job.request.status === "in_progress" ||
        job.request.status === "completed" ||
        job.appointment?.status === "confirmed";

      const matchesTab = jobState.stage === activeTab;

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
        jobState.label,
        jobState.message,
      ]
        .join(" ")
        .toLowerCase();

      const matchesSearch = query ? haystack.includes(query) : true;

      return shouldShowInWonJobs && matchesTab && matchesSearch;
    });
  }, [jobs, search, activeTab]);

  const appointmentsJobsCount = useMemo(() => {
    return jobs.filter(
      (job) =>
        getJobState(job).stage === "appointments" &&
        job.appointment?.status === "confirmed",
    ).length;
  }, [jobs]);

  const workshopJobsCount = useMemo(() => {
    return jobs.filter((job) => getJobState(job).stage === "workshop").length;
  }, [jobs]);

  const completedJobsCount = useMemo(() => {
    return jobs.filter((job) => getJobState(job).stage === "completed").length;
  }, [jobs]);

  const startJob = async (job: WonJob) => {
    try {
      const { error } = await supabase
        .from("repair_requests")
        .update({ status: "in_progress" })
        .eq("id", job.requestId);

      if (error) throw error;

      setJobs((prev) =>
        prev.map((j) =>
          j.requestId === job.requestId
            ? {
                ...j,
                request: {
                  ...j.request,
                  status: "in_progress",
                },
              }
            : j,
        ),
      );
    } catch (err) {
      console.error("Failed to start job:", err);
      alert("Nu am putut începe lucrarea.");
    }
  };

  const markAsCompleted = async (job: WonJob) => {
    try {
      const { error } = await supabase
        .from("repair_requests")
        .update({ status: "completed" })
        .eq("id", job.requestId);

      if (error) throw error;

      setJobs((prev) =>
        prev.map((j) =>
          j.requestId === job.requestId
            ? {
                ...j,
                request: {
                  ...j.request,
                  status: "completed",
                },
              }
            : j,
        ),
      );

      changeTab("completed");
    } catch (err) {
      console.error(
        "Failed to mark as completed:",
        JSON.stringify(err, null, 2),
      );
      alert("Nu am putut finaliza lucrarea.");
    }
  };

  const updateAppointmentStatus = async (
    job: WonJob,
    status: "confirmed" | "declined",
  ) => {
    if (!job.appointment) return;

    try {
      const { error } = await supabase
        .from("repair_appointments")
        .update({
          status,
          appointment_date:
            status === "confirmed" && job.appointment.proposed_date
              ? job.appointment.proposed_date
              : job.appointment.appointment_date,
          appointment_time:
            status === "confirmed" && job.appointment.proposed_time
              ? job.appointment.proposed_time
              : job.appointment.appointment_time,
          proposed_date:
            status === "confirmed" ? null : job.appointment.proposed_date,
          proposed_time:
            status === "confirmed" ? null : job.appointment.proposed_time,
          workshop_note:
            status === "confirmed" ? null : job.appointment.workshop_note,
          updated_at: new Date().toISOString(),
        })
        .eq("id", job.appointment.id);

      if (error) throw error;

      setJobs((prev) =>
        prev.map((item) =>
          item.requestId === job.requestId
            ? {
                ...item,
                appointment: item.appointment
                  ? {
                      ...item.appointment,
                      status,
                      appointment_date:
                        status === "confirmed" && item.appointment.proposed_date
                          ? item.appointment.proposed_date
                          : item.appointment.appointment_date,
                      appointment_time:
                        status === "confirmed" && item.appointment.proposed_time
                          ? item.appointment.proposed_time
                          : item.appointment.appointment_time,
                      proposed_date:
                        status === "confirmed"
                          ? null
                          : item.appointment.proposed_date,
                      proposed_time:
                        status === "confirmed"
                          ? null
                          : item.appointment.proposed_time,
                      workshop_note:
                        status === "confirmed"
                          ? null
                          : item.appointment.workshop_note,
                    }
                  : item.appointment,
              }
            : item,
        ),
      );
    } catch (error) {
      console.error("Failed to update appointment:", error);
      alert("Nu am putut actualiza programarea.");
    }
  };

  const proposeAnotherAppointment = async (job: WonJob) => {
    if (!job.appointment) return;

    if (!newAppointmentDate || !newAppointmentTime) {
      alert("Alege data și ora pentru noua propunere.");
      return;
    }

    try {
      const { data, error } = await supabase
        .from("repair_appointments")
        .update({
          proposed_date: newAppointmentDate,
          proposed_time: newAppointmentTime,
          status: "workshop_proposed",
          workshop_note: "Service-ul a propus o altă dată.",
          updated_at: new Date().toISOString(),
        })
        .eq("id", job.appointment.id)
        .select(
          "id, request_id, appointment_date, appointment_time, proposed_date, proposed_time, handover_method, pickup_address, customer_note, workshop_note, status, updated_at",
        )
        .single();

      if (error) throw error;

      setJobs((prev) =>
        prev.map((item) =>
          item.requestId === job.requestId
            ? {
                ...item,
                appointment: data as RepairAppointment,
              }
            : item,
        ),
      );

      setEditingAppointmentId(null);
      setNewAppointmentDate("");
      setNewAppointmentTime("");

      alert("Noua dată a fost propusă clientului.");
    } catch (error) {
      console.error("Failed to propose another appointment:", error);
      alert("Nu am putut propune altă dată.");
    }
  };

  const changeTab = (tab: JobFilter) => {
    setActiveTab(tab);
    router.replace(`/workshops/won-jobs?tab=${tab}`, {
      scroll: false,
    });
  };

  if (checkingAccess) {
    return (
      <main className="min-h-screen bg-black px-6 pb-28 pt-4 text-white">
        <div className="mx-auto flex min-h-[60vh] max-w-7xl items-center justify-center">
          <p className="text-white/70">Se verifică accesul...</p>
        </div>
      </main>
    );
  }

  if (!authorized) {
    return null;
  }

  return (
    <main className="min-h-screen bg-black px-6 pb-32 pt-4 text-white">
      <div className="mx-auto max-w-7xl">
        <div className="mb-8 flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-sm uppercase tracking-[0.2em] text-white/40">
              Dashboard service
            </p>

            <h1 className="mt-2 text-3xl font-bold md:text-4xl">
              Lucrări câștigate
            </h1>

            <p className="mt-3 max-w-2xl text-white/70">
              Gestionează lucrările acceptate de client: programare, lucru în
              curs și finalizare.
            </p>
          </div>

          <div className="w-full lg:w-96">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Caută după mașină, oraș, tip daună..."
              className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none placeholder:text-white/35 focus:border-white/25"
            />
          </div>
        </div>

        <div className="mb-6 flex gap-2 overflow-x-auto pb-1">
          <button
            type="button"
            onClick={() => changeTab("appointments")}
            className={`shrink-0 rounded-xl px-4 py-2 text-sm font-semibold transition ${
              activeTab === "appointments"
                ? "bg-white text-black"
                : "border border-white/15 bg-white/5 text-white/80 hover:bg-white/10"
            }`}
          >
            Programări ({appointmentsJobsCount})
          </button>

          <button
            type="button"
            onClick={() => changeTab("workshop")}
            className={`shrink-0 rounded-xl px-4 py-2 text-sm font-semibold transition ${
              activeTab === "workshop"
                ? "bg-white text-black"
                : "border border-white/15 bg-white/5 text-white/80 hover:bg-white/10"
            }`}
          >
            În atelier ({workshopJobsCount})
          </button>

          <button
            type="button"
            onClick={() => changeTab("completed")}
            className={`shrink-0 rounded-xl px-4 py-2 text-sm font-semibold transition ${
              activeTab === "completed"
                ? "bg-white text-black"
                : "border border-white/15 bg-white/5 text-white/80 hover:bg-white/10"
            }`}
          >
            Finalizate ({completedJobsCount})
          </button>
        </div>

        {loadingJobs ? (
          <div className="rounded-2xl border border-white/10 bg-white/5 p-10 text-center">
            <p className="text-white/70">Se încarcă lucrările...</p>
          </div>
        ) : filteredJobs.length === 0 ? (
          <div className="rounded-2xl border border-white/10 bg-white/5 p-10 text-center">
            <h2 className="text-2xl font-semibold">
              {activeTab === "completed"
                ? "Nu ai lucrări finalizate"
                : activeTab === "workshop"
                  ? "Nu ai mașini în atelier"
                  : "Nu ai programări active"}
            </h2>

            <p className="mt-3 text-white/70">
              {activeTab === "completed"
                ? "Lucrările finalizate vor apărea aici."
                : activeTab === "workshop"
                  ? "Mașinile aflate în lucru vor apărea aici."
                  : "Aici apar lucrările care trebuie programate sau confirmate."}
            </p>

            <div className="mt-6 flex flex-col gap-3 md:flex-row md:justify-center">
              <button
                onClick={() => router.push("/workshops")}
                className="rounded-lg bg-white px-6 py-3 font-semibold text-black"
              >
                Vezi cererile disponibile
              </button>

              <button
                onClick={() => router.push("/workshops/my-offers")}
                className="rounded-lg border border-white/20 px-6 py-3 font-semibold text-white"
              >
                Vezi ofertele mele
              </button>
            </div>
          </div>
        ) : activeTab === "workshop" ? (
          <div className="space-y-4">
            {filteredJobs.map((job) => {
              return (
                <div
                  key={job.offerId}
                  className="flex w-full items-center gap-4 rounded-[28px] border border-white/10 bg-white/[0.04] p-4 text-left transition hover:border-white/20 hover:bg-white/[0.07]"
                >
                  <div className="h-24 w-24 shrink-0 overflow-hidden rounded-3xl bg-white/5">
                    {job.request.images.length > 0 ? (
                      <ImageGallery
                        images={job.request.images}
                        alt={`${job.request.carBrand} ${job.request.carModel}`}
                        className="h-24 w-24 object-cover"
                        wrapperClassName="block h-24 w-24 overflow-hidden rounded-3xl"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-3xl">
                        🚗
                      </div>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={() =>
                      router.push(`/workshops/in-workshop/${job.requestId}`)
                    }
                    className="flex min-w-0 flex-1 items-center justify-between gap-4 text-left"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="mb-2 flex items-center gap-2">
                        <span className="rounded-full bg-blue-500 px-3 py-1 text-[11px] font-black uppercase tracking-[0.16em] text-white">
                          În lucru
                        </span>

                        {job.latestProgressStatus && (
                          <span className="truncate rounded-full bg-white/10 px-3 py-1 text-[11px] font-semibold text-white/70">
                            {formatJobStatus(job.latestProgressStatus)}
                          </span>
                        )}
                      </div>

                      <h2 className="truncate text-xl font-black text-white">
                        {job.request.carBrand} {job.request.carModel}
                      </h2>

                      <p className="mt-1 text-sm text-white/55">
                        {job.request.carYear} • {job.request.city}
                      </p>

                      <p className="mt-2 line-clamp-1 text-sm text-white/45">
                        {job.request.description}
                      </p>
                    </div>

                    <div className="hidden shrink-0 text-right sm:block">
                      <p className="text-xs uppercase tracking-[0.18em] text-white/35">
                        Preț
                      </p>
                      <p className="text-xl font-black text-white">
                        €{job.price}
                      </p>
                    </div>
                  </button>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
            {filteredJobs.map((job) => {
              const jobState = getJobState(job);

              return (
                <article
                  key={job.offerId}
                  className="group cursor-pointer overflow-hidden rounded-[28px] bg-white p-5 text-black shadow-lg transition"
                >
                  <CarHeader
                    images={job.request.images}
                    plate={job.request.licensePlate}
                    brand={job.request.carBrand}
                    model={job.request.carModel}
                    year={job.request.carYear}
                    city={job.request.city}
                    variant="listLarge"
                    platePosition="bottom"
                    details={[
                      {
                        text: jobState.label,
                        color:
                          jobState.priority === "needs_action"
                            ? "orange"
                            : jobState.priority === "waiting"
                              ? "yellow"
                              : jobState.stage === "completed"
                                ? "green"
                                : "blue",
                      },
                      {
                        text: `€${job.price}`,
                        color: "gray",
                      },
                    ]}
                  />

                  <div
                    onClick={() =>
                      router.push(`/workshops/in-workshop/${job.requestId}`)
                    }
                    className="block w-full cursor-pointer text-left"
                  >
                    <div className="pt-5">
                      <div className="mb-4 flex flex-wrap gap-2">
                        <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-black">
                          {job.request.damageType}
                        </span>

                        <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-white/70">
                          {job.days}
                        </span>

                        <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-white/70">
                          {job.workshopName}
                        </span>
                      </div>

                      <div className="rounded-[24px] bg-neutral-100 p-5">
                        <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-black/35">
                          Cererea clientului
                        </p>

                        <p className="mt-4 text-sm leading-6 text-black/75">
                          {job.request.description}
                        </p>
                      </div>

                      <div className="mt-4 rounded-[24px] bg-neutral-100 p-5">
                        <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-black/35">
                          Mesaj ofertă
                        </p>

                        <p className="mt-4 text-sm leading-6 text-black/75">
                          {job.message || "Nu ai adăugat niciun mesaj."}
                        </p>
                      </div>

                      <div
                        className={`mt-4 rounded-[24px] p-5 ${
                          jobState.priority === "needs_action"
                            ? "bg-orange-50"
                            : jobState.priority === "waiting"
                              ? "bg-yellow-50"
                              : "bg-neutral-100"
                        }`}
                      >
                        <p
                          className={`text-[11px] font-bold uppercase tracking-[0.24em] ${
                            jobState.priority === "needs_action"
                              ? "text-orange-600"
                              : jobState.priority === "waiting"
                                ? "text-yellow-700"
                                : "text-black/40"
                          }`}
                        >
                          Următorul pas
                        </p>

                        <p className="mt-4 text-base font-bold leading-7 text-black">
                          {jobState.message}
                        </p>
                      </div>

                      {job.appointment && (
                        <div
                          className={`mt-4 rounded-[24px] p-5 ${
                            job.appointment.status === "declined"
                              ? "bg-red-50"
                              : "bg-orange-50"
                          }`}
                        >
                          <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-orange-600">
                            {job.appointment.status === "confirmed"
                              ? "Programare confirmată de client"
                              : job.appointment.status === "declined"
                                ? "Programare refuzată"
                                : "Programare în așteptare"}
                          </p>

                          <div className="mt-4 rounded-[22px] bg-white p-4">
                            <p className="text-lg font-black text-black">
                              📅{" "}
                              {formatAppointmentDate(
                                job.appointment.proposed_date ||
                                  job.appointment.appointment_date,
                              )}
                            </p>

                            <p className="mt-2 text-base font-bold text-black/70">
                              🕘 Ora{" "}
                              {job.appointment.proposed_time ||
                                job.appointment.appointment_time}
                            </p>
                          </div>

                          <p className="mt-4 text-sm leading-6 text-black/65">
                            {job.appointment.handover_method ===
                            "customer_dropoff"
                              ? "Clientul aduce mașina la service"
                              : "Service-ul ridică mașina"}
                          </p>

                          {job.appointment.pickup_address && (
                            <p className="mt-2 text-sm text-white/70">
                              Adresă: {job.appointment.pickup_address}
                            </p>
                          )}

                          {job.appointment.customer_note && (
                            <p className="mt-2 text-sm text-white/70">
                              Mesaj client: {job.appointment.customer_note}
                            </p>
                          )}

                          <span className="mt-3 inline-flex rounded-full bg-black px-3 py-1 text-[11px] font-bold text-white">
                            {job.appointment.status === "confirmed"
                              ? "Confirmată"
                              : job.appointment.status === "declined"
                                ? "Refuzată"
                                : job.appointment.status === "cancelled"
                                  ? "Anulată"
                                  : "Așteaptă confirmare"}
                          </span>

                          {job.appointment.status === "customer_proposed" && (
                            <div className="mt-4 grid grid-cols-2 gap-2">
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  updateAppointmentStatus(job, "confirmed");
                                }}
                                className="rounded-2xl bg-green-500 px-4 py-3 text-sm font-black text-black"
                              >
                                Confirmă
                              </button>

                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();

                                  if (
                                    confirm(
                                      "Sigur vrei să refuzi această programare?",
                                    )
                                  ) {
                                    updateAppointmentStatus(job, "declined");
                                  }
                                }}
                                className="rounded-2xl border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm font-black text-red-300"
                              >
                                Refuză
                              </button>
                            </div>
                          )}
                        </div>
                      )}

                      {job.appointment &&
                        ["customer_proposed", "declined"].includes(
                          job.appointment.status,
                        ) && (
                          <div
                            className="mt-3"
                            onClick={(event) => event.stopPropagation()}
                          >
                            {editingAppointmentId === job.appointment.id ? (
                              <div className="rounded-2xl border border-orange-500/30 bg-orange-500/10 p-4">
                                <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-orange-300">
                                  Alege noua dată
                                </p>

                                <div className="mt-4 grid grid-cols-3 gap-2">
                                  {getNextDays(10).map((day) => (
                                    <button
                                      key={day.value}
                                      type="button"
                                      onClick={() =>
                                        setNewAppointmentDate(day.value)
                                      }
                                      className={`rounded-2xl border px-3 py-3 text-left text-sm font-bold ${
                                        newAppointmentDate === day.value
                                          ? "border-orange-500 bg-orange-500 text-black"
                                          : "border-white/10 bg-black text-white"
                                      }`}
                                    >
                                      <span className="block text-xs opacity-70">
                                        {day.weekday}
                                      </span>
                                      <span>{day.label}</span>
                                    </button>
                                  ))}
                                </div>

                                <p className="mt-5 text-[11px] font-bold uppercase tracking-[0.18em] text-orange-300">
                                  Alege ora
                                </p>

                                <div className="mt-3 grid grid-cols-3 gap-2">
                                  {[
                                    "08:00",
                                    "09:00",
                                    "10:00",
                                    "11:00",
                                    "12:00",
                                    "13:00",
                                    "14:00",
                                    "15:00",
                                    "16:00",
                                  ].map((time) => (
                                    <button
                                      key={time}
                                      type="button"
                                      onClick={() =>
                                        setNewAppointmentTime(time)
                                      }
                                      className={`rounded-2xl border px-3 py-3 text-sm font-black ${
                                        newAppointmentTime === time
                                          ? "border-orange-500 bg-orange-500 text-black"
                                          : "border-white/10 bg-black text-white"
                                      }`}
                                    >
                                      {time}
                                    </button>
                                  ))}
                                </div>

                                <div className="mt-4 grid grid-cols-2 gap-2">
                                  <button
                                    type="button"
                                    onClick={() =>
                                      proposeAnotherAppointment(job)
                                    }
                                    className="rounded-2xl bg-orange-500 px-4 py-3 text-sm font-black text-black"
                                  >
                                    Trimite
                                  </button>

                                  <button
                                    type="button"
                                    onClick={() => {
                                      setEditingAppointmentId(null);
                                      setNewAppointmentDate("");
                                      setNewAppointmentTime("");
                                    }}
                                    className="rounded-2xl border border-white/15 bg-white/5 px-4 py-3 text-sm font-black text-white"
                                  >
                                    Anulează
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingAppointmentId(job.appointment!.id);

                                  setNewAppointmentDate(
                                    job.appointment?.proposed_date ||
                                      job.appointment?.appointment_date ||
                                      "",
                                  );

                                  setNewAppointmentTime(
                                    job.appointment?.proposed_time ||
                                      job.appointment?.appointment_time ||
                                      "",
                                  );
                                }}
                                className="w-full rounded-2xl border border-orange-500/30 bg-orange-500/10 px-4 py-3 text-sm font-semibold text-orange-300"
                              >
                                Propune altă dată
                              </button>
                            )}
                          </div>
                        )}

                      <div className="mt-5 space-y-3">
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            localStorage.setItem("activeRole", "workshop");
                            router.push(
                              `/chat/${job.requestId}?offerId=${job.offerId}&role=workshop`,
                            );
                          }}
                          className="w-full rounded-2xl border border-white/15 bg-white/5 px-4 py-4 text-sm font-semibold text-white transition hover:bg-white/10"
                        >
                          Chat cu clientul
                        </button>

                        {job.appointment?.status === "confirmed" && (
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              router.push(
                                `/workshops/in-workshop/${job.requestId}`,
                              );
                            }}
                            className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-black px-4 py-4 text-sm font-semibold text-white transition hover:opacity-90"
                          >
                            <Wrench size={17} strokeWidth={2.4} />
                            Deschide lucrarea
                          </button>
                        )}

                        {job.request.status === "matched" &&
                          job.appointment?.status === "confirmed" && (
                            <button
                              onClick={(event) => {
                                event.stopPropagation();

                                if (
                                  confirm(
                                    "Ești sigur că vrei să începi această lucrare?",
                                  )
                                ) {
                                  startJob(job);
                                }
                              }}
                              className="hidden rounded-2xl border border-blue-400/30 bg-blue-500/10 px-4 py-3 text-sm font-semibold text-blue-300 transition hover:bg-blue-500/20 md:block sm:col-span-2"
                            >
                              Începe lucrarea
                            </button>
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

function getJobState(job: WonJob): {
  stage: JobStage;
  priority: JobPriority;
  label: string;
  message: string;
} {
  const status = job.request.status;
  const appointment = job.appointment;

  if (status === "completed") {
    return {
      stage: "completed",
      priority: "ok",
      label: "Finalizată",
      message: "Lucrarea este terminată.",
    };
  }

  if (status === "in_progress") {
    return {
      stage: "workshop",
      priority: "ok",
      label: "În atelier",
      message: "Mașina este în lucru.",
    };
  }

  if (!appointment) {
    return {
      stage: "appointments",
      priority: "waiting",
      label: "Necesită programare",
      message: "Clientul trebuie să aleagă o dată.",
    };
  }

  if (
    appointment.status === "customer_proposed" &&
    appointment.proposed_date &&
    appointment.proposed_time
  ) {
    return {
      stage: "appointments",
      priority: "needs_action",
      label: "Clientul a propus altă dată",
      message:
        "Clientul a propus o nouă programare. Confirmă sau propune altă dată.",
    };
  }

  if (appointment.status === "workshop_proposed") {
    return {
      stage: "appointments",
      priority: "waiting",
      label: "Așteaptă clientul",
      message: "Ai propus o altă dată. Clientul trebuie să răspundă.",
    };
  }

  if (appointment.status === "confirmed") {
    return {
      stage: "appointments",
      priority: "ok",
      label: "Programare confirmată",
      message: `Clientul a confirmat programarea pentru ${formatAppointmentDate(
        appointment.appointment_date,
      )} la ${appointment.appointment_time}.`,
    };
  }

  if (appointment.status === "declined") {
    return {
      stage: "appointments",
      priority: "needs_action",
      label: "Refuzată",
      message: "Programarea a fost refuzată. Propune altă dată.",
    };
  }

  return {
    stage: "appointments",
    priority: "ok",
    label: "Programare",
    message: "Verifică detaliile programării.",
  };
}

function formatDamageType(value: string) {
  switch (value) {
    case "scratch":
      return "Zgârietură";
    case "dent":
      return "Îndoitură";
    case "bumper":
      return "Bară avariată";
    case "paint":
      return "Vopsea afectată";
    case "cracked_part":
      return "Piesă crăpată";
    default:
      return "Altele";
  }
}

function formatAppointmentDate(date: string) {
  return new Date(date).toLocaleDateString("ro-RO", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function getNextDays(count: number) {
  const days = [];

  for (let i = 0; i < count; i++) {
    const date = new Date();
    date.setDate(date.getDate() + i);

    const value = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(
      2,
      "0",
    )}-${String(date.getDate()).padStart(2, "0")}`;

    days.push({
      value,
      weekday: date.toLocaleDateString("ro-RO", { weekday: "short" }),
      label: date.toLocaleDateString("ro-RO", {
        day: "numeric",
        month: "short",
      }),
    });
  }

  return days;
}

function formatJobStatus(value?: string | null) {
  switch (value) {
    case "completed":
    case "Ready":
    case "Gata":
      return "Finalizată";

    case "in_progress":
      return "În lucru";

    case "Received":
    case "received":
      return "Primită";

    case "Diagnosis":
    case "Diagnoză":
      return "Diagnoză";

    case "Parts ordered":
    case "Piese comandate":
      return "Piese comandate";

    case "In repair":
    case "in repair":
    case "În reparație":
      return "În reparație";

    case "Testing":
    case "Testare":
      return "Testare";

    case "matched":
      return "Programată";

    default:
      return "Deschisă";
  }
}
