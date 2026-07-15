"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import {
  getOwnRepairRequests,
  type RepairRequestRow,
} from "@/lib/supabase/repair-requests";
import {
  getOffersForCustomerRequests,
  type RepairOfferRow,
} from "@/lib/supabase/repair-offers";
import CarHeader from "@/app/components/CarHeader";
import { Eye } from "lucide-react";
import OfferSummaryCard from "@/app/components/OfferSummaryCard";
import WorkshopSummaryCard from "@/app/components/WorkshopSummaryCard";
import { interactiveButton } from "@/lib/ui";
import { markNotificationsAsRead } from "@/lib/notifications";

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

export default function MyJobsPage() {
  const router = useRouter();

  const [requests, setRequests] = useState<RepairRequestRow[]>([]);
  const [offers, setOffers] = useState<RepairOfferRow[]>([]);
  const [progressByRequestId, setProgressByRequestId] = useState<
    Record<string, { latestStatus: string | null; count: number }>
  >({});
  const [loading, setLoading] = useState(true);
  const [unreadByRequestId, setUnreadByRequestId] = useState<
    Record<string, number>
  >({});
  const [reviewedRequestIds, setReviewedRequestIds] = useState<string[]>([]);
  const [appointments, setAppointments] = useState<RepairAppointment[]>([]);
  const [workshopSlugs, setWorkshopSlugs] = useState<Record<string, string>>(
    {},
  );

  type JobsTab = "scheduled" | "in_progress" | "completed";

  const isValidTab = (tab: string | null): tab is JobsTab =>
    tab === "scheduled" || tab === "in_progress" || tab === "completed";

  const [activeTab, setActiveTab] = useState<JobsTab>("scheduled");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tab = params.get("tab");

    if (isValidTab(tab)) {
      setActiveTab(tab);
    }
  }, []);

  const loadJobs = async () => {
    try {
      const { data: authData } = await supabase.auth.getUser();

      if (!authData.user) {
        router.push("/login");
        return;
      }

      const { data: reviewsData } = await supabase
        .from("reviews")
        .select("request_id")
        .eq("customer_user_id", authData.user.id);

      setReviewedRequestIds(
        (reviewsData || []).map((review) => review.request_id).filter(Boolean),
      );

      const [requestRows, offerRows] = await Promise.all([
        getOwnRepairRequests(authData.user.id),
        getOffersForCustomerRequests(authData.user.id),
      ]);

      setRequests(requestRows);
      setOffers(offerRows);

      const workshopUserIds = Array.from(
        new Set(
          offerRows.map((offer) => offer.workshop_user_id).filter(Boolean),
        ),
      );

      if (workshopUserIds.length > 0) {
        const { data: profilesData } = await supabase
          .from("profiles")
          .select("id, workshop_slug")
          .in("id", workshopUserIds);

        const slugMap: Record<string, string> = {};

        (profilesData || []).forEach((profile) => {
          if (profile.id && profile.workshop_slug) {
            slugMap[profile.id] = profile.workshop_slug;
          }
        });

        setWorkshopSlugs(slugMap);
      }

      const { data: appointmentsData, error: appointmentsError } =
        await supabase
          .from("repair_appointments")
          .select(
            "id, request_id, appointment_date, appointment_time, handover_method, pickup_address, customer_note, workshop_note, proposed_date, proposed_time, status, updated_at",
          )
          .eq("customer_id", authData.user.id)
          .order("updated_at", { ascending: false });

      if (appointmentsError) {
        console.error("Failed to load appointments:", appointmentsError);
      }

      setAppointments((appointmentsData || []) as RepairAppointment[]);

      const progressMap: Record<
        string,
        { latestStatus: string | null; count: number }
      > = {};

      const { data: unreadData } = await supabase.rpc(
        "get_unread_progress_updates_by_request",
      );

      const unreadMap: Record<string, number> = {};

      (unreadData || []).forEach((row: any) => {
        unreadMap[row.request_id] = row.unread_count;
      });

      const unreadRequestIds = Object.keys(unreadMap).filter(
        (requestId) => unreadMap[requestId] > 0,
      );

      if (unreadRequestIds.length > 0 && authData.user.id) {
        const { data: unreadUpdates, error: unreadUpdatesError } =
          await supabase
            .from("work_progress_updates")
            .select("id, request_id")
            .in("request_id", unreadRequestIds);

        if (unreadUpdatesError) {
          console.error(
            "Failed to load unread progress update ids:",
            unreadUpdatesError,
          );
        } else {
          const readsToInsert = (unreadUpdates || []).map((update) => ({
            update_id: update.id,
            user_id: authData.user.id,
            read_at: new Date().toISOString(),
          }));

          if (readsToInsert.length > 0) {
            const { error: progressReadError } = await supabase
              .from("work_progress_reads")
              .upsert(readsToInsert, {
                onConflict: "update_id,user_id",
              });

            if (progressReadError) {
              console.error(
                "Failed to mark progress updates as read:",
                progressReadError,
              );
            } else {
              window.dispatchEvent(new Event("progress-read-updated"));
              window.dispatchEvent(new Event("offers-read-updated"));
              setUnreadByRequestId({});
            }
          }
        }
      }

      if (unreadRequestIds.length === 0) {
        setUnreadByRequestId(unreadMap);
      }

      await Promise.all(
        requestRows.map(async (request) => {
          const { data } = await supabase
            .from("work_progress_updates")
            .select("status, created_at")
            .eq("request_id", request.id)
            .order("created_at", { ascending: false });

          progressMap[request.id] = {
            latestStatus: data?.[0]?.status || null,
            count: data?.length || 0,
          };
        }),
      );

      setProgressByRequestId(progressMap);
    } catch (error) {
      console.error("Failed to load jobs:", error);
      alert("Nu am putut încărca programările.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadJobs();
  }, []);

  useEffect(() => {
    markNotificationsAsRead({
      recipientRole: "customer",
      types: ["workshop_confirmed_appointment"],
    });
  }, []);

  useEffect(() => {
    const handleFocus = () => {
      loadJobs();
    };

    window.addEventListener("focus", handleFocus);

    return () => {
      window.removeEventListener("focus", handleFocus);
    };
  }, []);

  useEffect(() => {
    const channel = supabase
      .channel("customer-appointments-live")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "repair_appointments",
        },
        () => {
          loadJobs();
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const jobs = useMemo(() => {
    return requests
      .filter((request) => {
        const status = request.status || "";

        return ["matched", "in_progress", "completed"].includes(status);
      })
      .map((request) => {
        const acceptedOffer = offers.find(
          (offer) =>
            offer.id === request.accepted_offer_id ||
            (offer.request_id === request.id && offer.status === "accepted"),
        );

        return {
          request,
          acceptedOffer,
        };
      });
  }, [requests, offers]);

  const latestAppointmentByRequestId = new Map<string, RepairAppointment>();

  appointments.forEach((appointment) => {
    const current = latestAppointmentByRequestId.get(appointment.request_id);

    if (
      !current ||
      new Date(appointment.updated_at || 0).getTime() >
        new Date(current.updated_at || 0).getTime()
    ) {
      latestAppointmentByRequestId.set(appointment.request_id, appointment);
    }
  });

  const jobsWithAppointments = jobs.map((job) => {
    const appointment = latestAppointmentByRequestId.get(job.request.id);

    return {
      ...job,
      appointment,
    };
  });

  const scheduledJobs = jobsWithAppointments.filter(
    ({ request }) => request.status === "matched",
  );

  const inProgressJobs = jobsWithAppointments.filter(
    ({ request }) => request.status === "in_progress",
  );

  const completedJobs = jobsWithAppointments.filter(
    ({ request }) => request.status === "completed",
  );

  const visibleJobs =
    activeTab === "scheduled"
      ? scheduledJobs
      : activeTab === "in_progress"
        ? inProgressJobs
        : completedJobs;

  const acceptAppointmentProposal = async (appointmentId: string) => {
    try {
      const { error } = await supabase
        .from("repair_appointments")
        .update({
          status: "confirmed",
          updated_at: new Date().toISOString(),
        })
        .eq("id", appointmentId);

      if (error) throw error;

      await loadJobs();
    } catch (error) {
      console.error("Failed to accept appointment:", error);
      alert("Nu am putut confirma programarea.");
    }
  };

  const changeTab = (tab: JobsTab) => {
    setActiveTab(tab);
    router.replace(`/customer/my-jobs?tab=${tab}`, {
      scroll: false,
    });
  };

  return (
    <main className="min-h-screen bg-[#111111] px-4 py-5 text-white">
      <div className="mx-auto max-w-5xl">
        <div className="mb-5 flex items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.25em] text-orange-400">
              Client
            </p>
            <h1 className="mt-1 text-2xl font-bold">Programări</h1>
          </div>

          <button
            onClick={() => router.push("/customer/dashboard")}
            className="rounded-full border border-white/15 px-4 py-2 text-sm font-semibold text-white"
          >
            Dashboard
          </button>
        </div>

        <div className="mb-5 flex gap-2 overflow-x-auto pb-1">
          <TabButton
            label="Programate"
            count={scheduledJobs.length}
            active={activeTab === "scheduled"}
            onClick={() => changeTab("scheduled")}
          />

          <TabButton
            label="În lucru"
            count={inProgressJobs.length}
            active={activeTab === "in_progress"}
            onClick={() => changeTab("in_progress")}
          />

          <TabButton
            label="Finalizate"
            count={completedJobs.length}
            active={activeTab === "completed"}
            onClick={() => changeTab("completed")}
          />
        </div>

        {loading ? (
          <p className="text-white/60">Se încarcă programările...</p>
        ) : jobs.length === 0 ? (
          <div className="rounded-[22px] bg-white p-6 text-center text-black">
            <h2 className="text-xl font-bold">Nu ai programări încă</h2>
            <p className="mt-2 text-sm text-black/60">
              Când accepți o ofertă, lucrarea programată va apărea aici.
            </p>

            <button
              onClick={() => router.push("/offers")}
              className="mt-5 rounded-full bg-black px-5 py-3 text-sm font-semibold text-white"
            >
              Vezi ofertele
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            {visibleJobs.length === 0 && (
              <div className="rounded-[22px] bg-white p-6 text-center text-black">
                <h2 className="text-xl font-bold">Nimic aici momentan</h2>
                <p className="mt-2 text-sm text-black/60">
                  Când apare o lucrare în această etapă, o vei vedea aici.
                </p>
              </div>
            )}
            {visibleJobs.map(({ request, acceptedOffer, appointment }) => {
              const isAppointmentConfirmed =
                appointment?.status === "confirmed";
              const isAppointmentRequested =
                !appointment || appointment.status === "workshop_proposed";

              return (
                <div
                  key={request.id}
                  onClick={() => router.push(`/customer/my-jobs/${request.id}`)}
                  className="cursor-pointer overflow-hidden rounded-[30px] bg-white p-4 text-black shadow-xl transition"
                >
                  <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <CarHeader
                        images={request.images}
                        plate={request.license_plate}
                        platePosition="bottom"
                        brand={request.car_brand}
                        model={request.car_model}
                        year={request.car_year}
                        city={request.city}
                        variant="listLarge"
                        details={[
                          {
                            text:
                              activeTab === "scheduled"
                                ? appointment?.status === "confirmed"
                                  ? "Programare confirmată"
                                  : appointment?.status === "workshop_proposed"
                                    ? "Service-ul a propus altă dată"
                                    : "Necesită programare"
                                : activeTab === "in_progress"
                                  ? "În lucru"
                                  : "Finalizată",
                            color:
                              activeTab === "scheduled"
                                ? appointment?.status === "confirmed"
                                  ? "blue"
                                  : appointment?.status === "workshop_proposed"
                                    ? "orange"
                                    : "yellow"
                                : activeTab === "in_progress"
                                  ? "orange"
                                  : "green",
                          },
                        ]}
                      />
                    </div>
                  </div>

                  {acceptedOffer && (
                    <WorkshopSummaryCard
                      workshopUserId={acceptedOffer.workshop_user_id}
                      workshopName={acceptedOffer.workshop_name}
                      workshopLogoUrl={null}
                      workshopSlug={
                        workshopSlugs[acceptedOffer.workshop_user_id]
                      }
                      onClick={() => {
                        const slug =
                          workshopSlugs[acceptedOffer.workshop_user_id];

                        if (!slug) {
                          alert("Profilul service-ului nu este disponibil.");
                          return;
                        }

                        router.push(`/workshops/profile/${slug}`);
                      }}
                    />
                  )}

                  {acceptedOffer && (
                    <div
                      className="mt-5"
                      onClick={(event) => event.stopPropagation()}
                    >
                      <OfferSummaryCard
                        title={
                          activeTab === "scheduled"
                            ? isAppointmentConfirmed
                              ? "Programare confirmată"
                              : "Programare în așteptare"
                            : activeTab === "in_progress"
                              ? "Lucrare în lucru"
                              : "Lucrare finalizată"
                        }
                        price={acceptedOffer.price}
                        days={acceptedOffer.days}
                        appointmentDate={
                          appointment?.status === "workshop_proposed"
                            ? appointment.proposed_date ||
                              appointment.appointment_date
                            : appointment?.appointment_date ||
                              acceptedOffer.available_date ||
                              null
                        }
                        appointmentTime={
                          appointment?.status === "workshop_proposed"
                            ? appointment.proposed_time ||
                              appointment.appointment_time
                            : appointment?.appointment_time ||
                              acceptedOffer.available_time ||
                              null
                        }
                        handoverText={
                          appointment?.handover_method === "workshop_pickup"
                            ? "Predare: Service-ul ridică mașina"
                            : "Predare: Clientul aduce mașina"
                        }
                        statusText={
                          activeTab === "scheduled"
                            ? isAppointmentConfirmed
                              ? "Confirmată"
                              : "Așteaptă confirmare"
                            : activeTab === "in_progress"
                              ? "În lucru"
                              : "Finalizată"
                        }
                      />
                    </div>
                  )}

                  <div className="mt-5 rounded-2xl border border-black/10 bg-black/[0.03] p-3">
                    <p className="mb-2 text-xs font-semibold text-black/45">
                      📝 Descriere
                    </p>

                    <p className="text-sm leading-6 text-black/70">
                      {request.description || "Fără descriere."}
                    </p>
                  </div>

                  <div className="mt-6 space-y-3">
                    {activeTab === "scheduled" &&
                      appointment?.status === "workshop_proposed" && (
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();

                            if (!appointment) {
                              alert("Programarea nu a fost găsită.");
                              return;
                            }

                            acceptAppointmentProposal(appointment.id);
                          }}
                          className={`${interactiveButton} w-full rounded-[20px] bg-orange-500 px-4 py-5 text-center text-sm font-black text-white`}
                        >
                          Acceptă programarea
                        </button>
                      )}

                    <div className="grid grid-cols-2 gap-3">
                      <button
                        type="button"
                        disabled={!acceptedOffer}
                        onClick={(event) => {
                          event.stopPropagation();

                          if (!acceptedOffer) {
                            alert("Oferta acceptată nu a fost găsită.");
                            return;
                          }

                          router.push(
                            `/chat/${request.id}?offerId=${acceptedOffer.id}`,
                          );
                        }}
                        className={`${interactiveButton} rounded-[20px] bg-black px-4 py-5 text-center text-sm font-bold text-white disabled:opacity-40`}
                      >
                        💬 Chat
                      </button>

                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();

                          if (
                            activeTab === "scheduled" &&
                            appointment?.status !== "confirmed"
                          ) {
                            router.push(
                              `/customer/schedule-damage/${request.id}`,
                            );
                            return;
                          }

                          router.push(`/customer/my-jobs/${request.id}`);
                        }}
                        className={`${interactiveButton} rounded-[20px] bg-black px-4 py-5 text-center text-sm font-bold text-white`}
                      >
                        {activeTab === "scheduled" &&
                        appointment?.status !== "confirmed" ? (
                          <>📅 Modifică data</>
                        ) : (
                          <span className="inline-flex items-center justify-center gap-2">
                            <Eye size={17} strokeWidth={2.4} />
                            Urmărește
                          </span>
                        )}
                      </button>
                    </div>
                  </div>

                  {request.status === "completed" &&
                    (reviewedRequestIds.includes(request.id) ? (
                      <button
                        type="button"
                        disabled
                        className="rounded-2xl bg-emerald-100 px-4 py-4 text-base font-bold text-emerald-700"
                      >
                        ✓ Review trimis
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          router.push(`/review?id=${request.id}`);
                        }}
                        className="rounded-2xl bg-orange-500 px-4 py-4 text-base font-bold text-white"
                      >
                        ⭐ Lasă review
                      </button>
                    ))}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}

function getAppointmentBadgeClass(
  status?: string | null,
  proposedDate?: string | null,
  proposedTime?: string | null,
) {
  if (status === "confirmed") return "bg-green-100 text-green-700";
  if (status === "customer_proposed") return "bg-orange-500 text-white";

  if (status === "workshop_proposed") return "bg-yellow-100 text-yellow-700";
  if (status === "declined") return "bg-red-100 text-red-700";
  if (status === "cancelled") return "bg-gray-100 text-gray-700";

  return "bg-orange-100 text-orange-700";
}

function formatAppointmentDate(date: string) {
  return new Date(date).toLocaleDateString("ro-RO", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function formatJobStatus(status?: string | null) {
  switch (status) {
    case "Received":
    case "received":
      return "Primită";

    case "Diagnosis":
    case "diagnosis":
      return "Diagnoză";

    case "Parts ordered":
    case "parts_ordered":
      return "Piese comandate";

    case "In repair":
    case "in repair":
    case "in_repair":
      return "În reparație";

    case "Testing":
    case "testing":
      return "Testare";

    case "Ready":
    case "ready":
    case "Gata":
      return "Gata";

    case "in_progress":
      return "În lucru";

    case "painting":
      return "La vopsit";

    case "polishing":
      return "La polish";

    case "completed":
      return "Finalizată";

    case "matched":
      return "Necesită programare";

    default:
      return "Necesită programare";
  }
}

function getStatusClass(status?: string | null) {
  switch (status) {
    case "Received":
    case "received":
      return "bg-gray-100 text-gray-700";

    case "Diagnosis":
    case "diagnosis":
      return "bg-yellow-100 text-yellow-700";

    case "Parts ordered":
    case "parts_ordered":
      return "bg-indigo-100 text-indigo-700";

    case "In repair":
    case "in repair":
    case "in_repair":
      return "bg-orange-100 text-orange-700";

    case "Testing":
    case "testing":
      return "bg-blue-100 text-blue-700";

    case "Ready":
    case "ready":
    case "Gata":
      return "bg-green-100 text-green-700";

    case "in_progress":
      return "bg-blue-100 text-blue-700";

    case "painting":
      return "bg-orange-100 text-orange-700";

    case "polishing":
      return "bg-purple-100 text-purple-700";

    case "completed":
      return "bg-green-100 text-green-700";

    case "matched":
      return "bg-yellow-100 text-yellow-700";

    default:
      return "bg-orange-100 text-orange-700";
  }
}

function formatAppointmentStatus(status?: string | null) {
  switch (status) {
    case "workshop_proposed":
      return "Service-ul a propus o programare";

    case "customer_proposed":
      return "Așteaptă confirmarea service-ului";

    case "confirmed":
      return "Programare confirmată";

    case "declined":
      return "Refuzată";

    case "cancelled":
      return "Anulată";

    default:
      return "Programare";
  }
}

function TabButton({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`shrink-0 rounded-full px-4 py-2 text-sm font-bold transition ${
        active ? "bg-orange-500 text-black" : "bg-white/10 text-white"
      }`}
    >
      {label} ({count})
    </button>
  );
}
