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
  const [activeTab, setActiveTab] = useState<
    "needs_schedule" | "scheduled" | "in_progress" | "completed"
  >("needs_schedule");

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

      setUnreadByRequestId(unreadMap);

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

  const needsScheduleJobs = jobsWithAppointments.filter(
    ({ request, appointment }) =>
      request.status === "matched" &&
      (!appointment || ["declined", "cancelled"].includes(appointment.status)),
  );

  const scheduledJobs = jobsWithAppointments.filter(
    ({ request, appointment }) =>
      request.status === "matched" &&
      appointment &&
      ["requested", "confirmed"].includes(appointment.status),
  );

  const inProgressJobs = jobsWithAppointments.filter(
    ({ request }) => request.status === "in_progress",
  );

  const completedJobs = jobsWithAppointments.filter(
    ({ request }) => request.status === "completed",
  );

  const visibleJobs =
    activeTab === "needs_schedule"
      ? needsScheduleJobs
      : activeTab === "scheduled"
        ? scheduledJobs
        : activeTab === "in_progress"
          ? inProgressJobs
          : completedJobs;

  const acceptAppointmentProposal = async (appointmentId: string) => {
    const appointment = appointments.find((a) => a.id === appointmentId);

    if (!appointment) return;

    if (!appointment.proposed_date || !appointment.proposed_time) {
      alert("Nu există o dată propusă de service.");
      return;
    }

    try {
      const { error } = await supabase
        .from("repair_appointments")
        .update({
          status: "confirmed",
          appointment_date: appointment.proposed_date,
          appointment_time: appointment.proposed_time,
          proposed_date: null,
          proposed_time: null,
          workshop_note: null,
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
            label="Necesită programare"
            count={needsScheduleJobs.length}
            active={activeTab === "needs_schedule"}
            onClick={() => setActiveTab("needs_schedule")}
          />

          <TabButton
            label="Programate"
            count={scheduledJobs.length}
            active={activeTab === "scheduled"}
            onClick={() => setActiveTab("scheduled")}
          />

          <TabButton
            label="În lucru"
            count={inProgressJobs.length}
            active={activeTab === "in_progress"}
            onClick={() => setActiveTab("in_progress")}
          />

          <TabButton
            label="Finalizate"
            count={completedJobs.length}
            active={activeTab === "completed"}
            onClick={() => setActiveTab("completed")}
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
              const image =
                request.images?.[0]?.url || request.images?.[0]?.dataUrl || "";

              return (
                <div
                  key={request.id}
                  onClick={() => router.push(`/customer/my-jobs/${request.id}`)}
                  className="overflow-hidden rounded-[26px] bg-white text-black shadow-lg transition active:scale-[0.99]"
                >
                  <div className="flex gap-4 p-4">
                    <div className="h-24 w-24 shrink-0 overflow-hidden rounded-3xl bg-black/10">
                      {image ? (
                        <img
                          src={image}
                          alt={`${request.car_brand} ${request.car_model}`}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-xs text-black/40">
                          No photo
                        </div>
                      )}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="flex items-center gap-2">
                            <h2 className="text-xl font-black leading-tight">
                              {request.car_brand} {request.car_model}
                            </h2>

                            {(unreadByRequestId[request.id] || 0) > 0 && (
                              <span className="rounded-full bg-orange-500 px-2 py-1 text-[10px] font-black text-white">
                                NOU
                              </span>
                            )}
                          </div>
                          <p className="mt-1 text-sm text-black/55">
                            {request.car_year} • {request.city}
                          </p>
                        </div>

                        <span
                          className={`shrink-0 rounded-full px-3 py-1 text-xs font-bold ${
                            appointment
                              ? getAppointmentBadgeClass(
                                  appointment.status,
                                  appointment.proposed_date,
                                  appointment.proposed_time,
                                )
                              : getStatusClass(
                                  progressByRequestId[request.id]
                                    ?.latestStatus || request.status,
                                )
                          }`}
                        >
                          {appointment
                            ? appointment.status === "confirmed"
                              ? "Programată"
                              : appointment.proposed_date &&
                                  appointment.proposed_time &&
                                  appointment.status === "requested"
                                ? "Dată propusă"
                                : "Așteaptă confirmare"
                            : formatJobStatus(
                                progressByRequestId[request.id]?.latestStatus ||
                                  request.status,
                              )}
                        </span>
                      </div>

                      {acceptedOffer && (
                        <div className="mt-3 rounded-2xl bg-black/[0.04] p-3">
                          <p className="text-xs text-black/45">Service</p>
                          <p className="font-semibold">
                            {acceptedOffer.workshop_name}
                          </p>

                          <div className="mt-2 flex items-center justify-between text-sm">
                            <span className="text-black/55">
                              {acceptedOffer.days}{" "}
                              {String(acceptedOffer.days) === "1"
                                ? "zi"
                                : "zile"}
                            </span>
                            <span className="font-bold">
                              €{acceptedOffer.price}
                            </span>
                          </div>
                        </div>
                      )}

                      {appointment && (
                        <div
                          className={`mt-3 rounded-2xl p-3 ${
                            appointment.status === "declined"
                              ? "bg-red-50"
                              : "bg-orange-50"
                          }`}
                        >
                          <p
                            className={`text-xs font-bold uppercase tracking-[0.18em] ${
                              appointment.status === "declined"
                                ? "text-red-600"
                                : "text-orange-600"
                            }`}
                          >
                            {appointment.status === "declined"
                              ? "Programare refuzată"
                              : "Programare"}
                          </p>

                          {appointment.status !== "declined" && (
                            <>
                              <div className="mt-3 rounded-2xl border border-orange-200 bg-gradient-to-r from-orange-50 to-orange-100 p-3">
                                <p className="text-base font-black text-black">
                                  📅{" "}
                                  {formatAppointmentDate(
                                    appointment.appointment_date,
                                  )}
                                </p>

                                <p className="mt-1 text-sm font-semibold text-black/65">
                                  🕐 Ora {appointment.appointment_time}
                                </p>
                              </div>

                              <p className="mt-1 text-sm text-black/55">
                                {appointment.handover_method ===
                                "customer_dropoff"
                                  ? "Aduci mașina la service"
                                  : "Service-ul ridică mașina"}
                              </p>
                            </>
                          )}

                          {appointment.status === "declined" && (
                            <div className="mt-3 rounded-2xl border border-red-200 bg-white p-3">
                              <p className="font-semibold text-red-700">
                                ⚠️ Service-ul nu poate prelua mașina la data
                                selectată.
                              </p>

                              <p className="mt-1 text-sm text-red-600">
                                Alege o altă dată pentru reprogramare.
                              </p>
                            </div>
                          )}

                          <span className="mt-2 inline-flex rounded-full bg-black px-3 py-1 text-[11px] font-bold text-white">
                            {formatAppointmentStatus(appointment.status)}
                          </span>

                          {appointment.proposed_date &&
                            appointment.proposed_time &&
                            appointment.status === "requested" && (
                              <div className="mt-3 rounded-2xl border border-orange-200 bg-white p-3">
                                <p className="text-xs font-black uppercase tracking-[0.16em] text-orange-600">
                                  NOUĂ DATĂ PROPUSĂ
                                </p>

                                <div className="mt-3 rounded-2xl border border-orange-300 bg-gradient-to-r from-orange-50 to-orange-100 p-3">
                                  <p className="text-base font-black text-black">
                                    📅{" "}
                                    {formatAppointmentDate(
                                      appointment.proposed_date,
                                    )}
                                  </p>

                                  <p className="mt-1 text-sm font-semibold text-black/65">
                                    🕐 Ora {appointment.proposed_time}
                                  </p>
                                </div>

                                <div className="mt-3 flex flex-wrap gap-2">
                                  <button
                                    type="button"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      acceptAppointmentProposal(appointment.id);
                                    }}
                                    className="rounded-2xl bg-green-500 px-4 py-3 text-sm font-black text-black"
                                  >
                                    Accept noua dată
                                  </button>

                                  <button
                                    type="button"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      router.push(
                                        `/customer/schedule-damage/${request.id}`,
                                      );
                                    }}
                                    className="rounded-2xl bg-black px-4 py-3 text-sm font-black text-white"
                                  >
                                    Aleg altă dată
                                  </button>
                                </div>
                              </div>
                            )}
                        </div>
                      )}

                      {progressByRequestId[request.id] && (
                        <div className="mt-3 flex flex-wrap gap-2">
                          <span className="rounded-full bg-orange-100 px-3 py-1 text-[11px] font-bold text-orange-700">
                            {progressByRequestId[request.id].latestStatus ||
                              "Waiting"}
                          </span>

                          <span className="rounded-full bg-black px-3 py-1 text-[11px] font-bold text-white">
                            {progressByRequestId[request.id].count} update-uri
                          </span>
                        </div>
                      )}

                      <p className="mt-3 line-clamp-2 text-sm text-black/65">
                        {request.description || "Fără descriere."}
                      </p>

                      <div className="mt-4">
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
                          className="rounded-2xl bg-black px-4 py-3 text-sm font-bold text-white disabled:opacity-40"
                        >
                          Chat cu service-ul
                        </button>

                        {activeTab === "needs_schedule" && (
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              router.push(
                                `/customer/schedule-damage/${request.id}`,
                              );
                            }}
                            className="mt-3 rounded-2xl bg-orange-500 px-4 py-3 text-sm font-bold text-white"
                          >
                            📅 Programează acum
                          </button>
                        )}

                        {request.status === "completed" &&
                          (reviewedRequestIds.includes(request.id) ? (
                            <button
                              type="button"
                              disabled
                              className="mt-3 rounded-2xl bg-emerald-100 px-4 py-3 text-sm font-bold text-emerald-700"
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
                              className="mt-3 rounded-2xl bg-orange-500 px-4 py-3 text-sm font-bold text-white"
                            >
                              ⭐ Lasă review
                            </button>
                          ))}
                      </div>
                    </div>
                  </div>
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
  if (status === "requested" && proposedDate && proposedTime)
    return "bg-orange-500 text-white";
  if (status === "requested") return "bg-yellow-100 text-yellow-700";
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
    case "requested":
      return "Așteaptă confirmare";

    case "confirmed":
      return "Confirmată";

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
