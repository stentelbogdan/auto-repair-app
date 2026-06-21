"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import Lightbox from "yet-another-react-lightbox";
import "yet-another-react-lightbox/styles.css";
import Zoom from "yet-another-react-lightbox/plugins/zoom";

type JobFilter = "active" | "completed";

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
  status: "requested" | "confirmed" | "declined" | "cancelled";
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
  const [imageIndexes, setImageIndexes] = useState<Record<string, number>>({});
  const [activeTab, setActiveTab] = useState<JobFilter>("active");
  const [touchStartX, setTouchStartX] = useState<number | null>(null);

  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [lightboxImages, setLightboxImages] = useState<{ src: string }[]>([]);
  const [progressUnreadCount, setProgressUnreadCount] = useState(0);

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

        appointmentsMap = new Map(
          (appointmentsData || []).map((appointment: any) => [
            appointment.request_id,
            appointment as RepairAppointment,
          ]),
        );
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
      const isCompleted = job.request.status === "completed";
      const matchesTab = activeTab === "completed" ? isCompleted : !isCompleted;

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

  const stickyJob = filteredJobs[0];

  const getCurrentImageIndex = (jobId: string, imagesCount: number) => {
    if (!imagesCount) return 0;
    const current = imageIndexes[jobId] ?? 0;
    return Math.min(current, imagesCount - 1);
  };

  const openLightbox = (job: WonJob) => {
    const currentIndex = getCurrentImageIndex(
      job.offerId,
      job.request.images.length,
    );

    const slides = job.request.images
      .map((image) => ({
        src: image.dataUrl || image.url || "",
      }))
      .filter((image) => image.src);

    if (!slides.length) return;

    setLightboxImages(slides);
    setLightboxIndex(currentIndex);
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

      setActiveTab("completed");
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

    const newDate = prompt("Introdu data nouă în format YYYY-MM-DD:");
    if (!newDate) return;

    const newTime = prompt("Introdu ora nouă, ex: 10:00:");
    if (!newTime) return;

    try {
      const { data, error } = await supabase
        .from("repair_appointments")
        .update({
          proposed_date: newDate.trim(),
          proposed_time: newTime.trim(),
          status: "requested",
          workshop_note: "Service-ul a propus o altă dată.",
          updated_at: new Date().toISOString(),
        })
        .eq("id", job.appointment.id)
        .select(
          "id, request_id, appointment_date, appointment_time, handover_method, pickup_address, customer_note, workshop_note, proposed_date, proposed_time, status",
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

      const { data: authData } = await supabase.auth.getUser();

      if (authData.user) {
        await loadWonJobs(authData.user.id);
      }

      alert("Noua dată a fost propusă clientului.");
    } catch (error) {
      console.error("Failed to propose another appointment:", error);
      alert("Nu am putut propune altă dată.");
    }
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
              Acestea sunt lucrările câștigate de service-ul tău pe care le poți
              începe.
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
            Lucrări active ({activeJobsCount})
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
            Lucrări finalizate ({completedJobsCount})
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
                : "Nu ai lucrări active"}
            </h2>

            <p className="mt-3 text-white/70">
              {activeTab === "completed"
                ? "Lucrările finalizate vor apărea aici."
                : "Când un client acceptă una dintre ofertele tale, lucrarea va apărea aici."}
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
        ) : (
          <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
            {filteredJobs.map((job) => {
              const currentImageIndex = getCurrentImageIndex(
                job.offerId,
                job.request.images.length,
              );
              const currentImage = job.request.images[currentImageIndex];

              return (
                <article
                  key={job.offerId}
                  onClick={() =>
                    router.push(`/workshops/won-jobs/${job.requestId}`)
                  }
                  className="group cursor-pointer overflow-hidden rounded-3xl border border-white/10 ..."
                >
                  <div className="relative">
                    {currentImage?.dataUrl ? (
                      <div
                        className="relative h-64 w-full overflow-hidden bg-white/5"
                        onTouchStart={(e) => {
                          setTouchStartX(e.touches[0].clientX);
                        }}
                        onTouchEnd={(e) => {
                          if (touchStartX === null) return;

                          const touchEndX = e.changedTouches[0].clientX;
                          const diff = touchStartX - touchEndX;

                          if (Math.abs(diff) < 40) return;

                          if (diff > 0) {
                            goToNextImage(
                              job.offerId,
                              job.request.images.length,
                            );
                          } else {
                            goToPrevImage(
                              job.offerId,
                              job.request.images.length,
                            );
                          }

                          setTouchStartX(null);
                        }}
                      >
                        <img
                          key={`${job.offerId}-${currentImageIndex}`}
                          src={currentImage.dataUrl}
                          alt={`${job.request.carBrand} ${job.request.carModel}`}
                          onClick={() => openLightbox(job)}
                          className="h-full w-full cursor-zoom-in object-cover transition-all duration-500 ease-out group-hover:scale-[1.02]"
                        />

                        <div className="pointer-events-none absolute inset-0 bg-black/0 transition duration-500 group-hover:bg-black/5" />

                        <div className="pointer-events-none absolute bottom-3 right-3 hidden rounded-full border border-white/10 bg-black/55 px-3 py-1.5 text-xs font-semibold text-white/80 backdrop-blur md:block"></div>

                        {job.request.status === "completed" && (
                          <div className="absolute inset-0 bg-green-500/10 backdrop-blur-[2px]" />
                        )}

                        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-transparent" />

                        {job.request.images.length > 1 && (
                          <>
                            <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 gap-2">
                              {job.request.images.map((_, index) => {
                                const isActive = index === currentImageIndex;

                                return (
                                  <button
                                    key={index}
                                    type="button"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      setImageIndexes((prev) => ({
                                        ...prev,
                                        [job.offerId]: index,
                                      }));
                                    }}
                                    className={`h-2.5 w-2.5 rounded-full transition ${
                                      isActive ? "bg-white" : "bg-white/35"
                                    }`}
                                  />
                                );
                              })}
                            </div>

                            <div className="absolute right-3 top-3 rounded-full border border-white/10 bg-black/50 px-2.5 py-1 text-xs text-white/80 backdrop-blur">
                              {currentImageIndex + 1}/
                              {job.request.images.length}
                            </div>
                          </>
                        )}
                      </div>
                    ) : (
                      <div className="flex h-64 items-center justify-center bg-white/5 text-white/40">
                        Nu există fotografii
                      </div>
                    )}

                    <div className="absolute left-4 top-4">
                      <span
                        className={`rounded-full px-4 py-1.5 text-xs font-bold uppercase tracking-[0.2em] backdrop-blur ${
                          (job.latestProgressStatus || job.request.status) ===
                            "completed" ||
                          (job.latestProgressStatus || job.request.status) ===
                            "Ready" ||
                          (job.latestProgressStatus || job.request.status) ===
                            "Gata"
                            ? "bg-green-500 text-black"
                            : "bg-blue-500 text-black"
                        }`}
                      >
                        {formatJobStatus(
                          job.latestProgressStatus || job.request.status,
                        )}
                      </span>
                    </div>

                    <div className="absolute bottom-4 left-4 right-4 flex items-end justify-between gap-4">
                      <div>
                        <p className="text-xs uppercase tracking-[0.22em] text-white/50">
                          Lucrare{" "}
                          {formatJobStatus(
                            job.latestProgressStatus || job.request.status,
                          ).toLowerCase()}
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
                          Oferta ta
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
                        {job.days} {job.days === "1" ? "zi" : "zile"}
                      </span>

                      <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-white/70">
                        {job.workshopName}
                      </span>
                    </div>

                    <div className="rounded-2xl border border-white/10 bg-black/25 p-4">
                      <p className="text-[11px] uppercase tracking-[0.18em] text-white/45">
                        Cererea clientului
                      </p>

                      <p className="mt-2 min-h-[72px] text-sm leading-6 text-white/80">
                        {job.request.description}
                      </p>
                    </div>

                    <div className="mt-4 rounded-2xl border border-white/10 bg-black/25 p-4">
                      <p className="text-[11px] uppercase tracking-[0.18em] text-white/45">
                        Mesajul tău
                      </p>

                      <p className="mt-2 text-sm leading-6 text-white/80">
                        {job.message || "Nu ai adăugat niciun mesaj."}
                      </p>
                    </div>

                    {job.appointment && (
                      <div className="mt-4 rounded-2xl border border-orange-500/25 bg-orange-500/10 p-4">
                        <p className="text-[11px] uppercase tracking-[0.18em] text-orange-300">
                          Programare solicitată
                        </p>

                        <div className="mt-3 rounded-2xl border border-orange-500/25 bg-gradient-to-r from-orange-500/10 to-orange-500/20 p-3">
                          <p className="text-base font-black text-white">
                            📅{" "}
                            {formatAppointmentDate(
                              job.appointment.proposed_date ||
                                job.appointment.appointment_date,
                            )}
                          </p>

                          <p className="mt-1 text-sm font-semibold text-white/70">
                            🕐 Ora{" "}
                            {job.appointment.proposed_time ||
                              job.appointment.appointment_time}
                          </p>
                        </div>

                        <p className="mt-1 text-sm text-white/70">
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

                        {job.appointment.status === "requested" && (
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

                    {job.appointment?.status === "requested" && (
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          proposeAnotherAppointment(job);
                        }}
                        className="mt-3 w-full rounded-2xl border border-orange-500/30 bg-orange-500/10 px-4 py-3 text-sm font-semibold text-orange-300"
                      >
                        Propune altă dată
                      </button>
                    )}

                    <div className="mt-5 space-y-3">
                      <button
                        onClick={() =>
                          router.push(`/workshops/${job.requestId}`)
                        }
                        className="w-full rounded-2xl bg-white px-4 py-4 text-sm font-semibold text-black transition hover:opacity-90"
                      >
                        Deschide lucrarea
                      </button>

                      <button
                        onClick={() => {
                          localStorage.setItem("activeRole", "workshop");
                          router.push(
                            `/chat/${job.requestId}?offerId=${job.offerId}&role=workshop`,
                          );
                        }}
                        className="w-full rounded-2xl border border-white/15 bg-white/5 px-4 py-4 text-sm font-semibold text-white transition hover:bg-white/10"
                      >
                        Chat cu clientul
                      </button>

                      {job.request.status === "matched" &&
                        job.appointment?.status === "confirmed" && (
                          <button
                            onClick={() => {
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

                      {job.request.status === "in_progress" && (
                        <button
                          onClick={() => {
                            if (
                              confirm(
                                "Ești sigur că vrei să finalizezi această lucrare?",
                              )
                            ) {
                              markAsCompleted(job);
                            }
                          }}
                          className="mt-2 hidden w-full rounded-2xl border border-green-400/30 bg-green-500/10 px-4 py-4 text-sm font-semibold text-green-300 transition hover:bg-green-500/20 md:block sm:col-span-2"
                        >
                          Marchează ca finalizată
                        </button>
                      )}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>

      {stickyJob && stickyJob.request.status !== "completed" && (
        <div className="fixed bottom-0 left-0 right-0 z-50 border-t border-white/10 bg-black/80 backdrop-blur md:hidden">
          <div className="mx-auto max-w-7xl px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-4">
            {stickyJob.request.status === "matched" &&
              stickyJob.appointment?.status === "confirmed" && (
                <button
                  onClick={() => {
                    if (
                      confirm("Ești sigur că vrei să începi această lucrare?")
                    ) {
                      startJob(stickyJob);
                    }
                  }}
                  className="w-full rounded-2xl bg-blue-500 px-6 py-4 text-lg font-bold text-black shadow-[0_20px_60px_rgba(59,130,246,0.35)] transition active:scale-[0.99]"
                >
                  Începe lucrarea
                </button>
              )}

            {stickyJob.request.status === "in_progress" && (
              <button
                onClick={() => {
                  if (
                    confirm("Ești sigur că vrei să finalizezi această lucrare?")
                  ) {
                    markAsCompleted(stickyJob);
                  }
                }}
                className="w-full rounded-2xl bg-green-500 px-6 py-4 text-lg font-bold text-black shadow-[0_20px_60px_rgba(34,197,94,0.35)] transition active:scale-[0.99]"
              >
                Marchează ca finalizată
              </button>
            )}
          </div>
        </div>
      )}

      <Lightbox
        open={lightboxIndex !== null}
        close={() => setLightboxIndex(null)}
        slides={lightboxImages}
        index={lightboxIndex ?? 0}
        plugins={[Zoom]}
        controller={{
          closeOnBackdropClick: true,
          closeOnPullDown: true,
        }}
        animation={{
          fade: 220,
          swipe: 260,
          zoom: 260,
        }}
        zoom={{
          maxZoomPixelRatio: 4,
          scrollToZoom: true,
          doubleTapDelay: 250,
          doubleClickDelay: 250,
        }}
        carousel={{
          finite: true,
          padding: "16px",
          spacing: "16px",
        }}
        styles={{
          button: { display: "none" },
        }}
      />
    </main>
  );
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
      return "Acceptată";

    default:
      return "Deschisă";
  }
}
