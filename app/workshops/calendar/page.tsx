"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";

type ProfileRow = {
  role: string[] | null;
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
  status: "requested" | "confirmed" | "declined" | "cancelled";
  updated_at: string | null;
};

type RepairRequest = {
  id: string;
  car_brand: string | null;
  car_model: string | null;
  car_year: string | null;
  city: string | null;
  description: string | null;
  status: string | null;
};

export default function WorkshopCalendarPage() {
  const router = useRouter();

  const [authorized, setAuthorized] = useState(false);
  const [checkingAccess, setCheckingAccess] = useState(true);
  const [loading, setLoading] = useState(true);

  const [appointments, setAppointments] = useState<RepairAppointment[]>([]);
  const [requestsById, setRequestsById] = useState<Record<string, RepairRequest>>(
    {},
  );

  useEffect(() => {
    const checkAndLoad = async () => {
      try {
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
        await loadCalendar(authData.user.id);
      } catch (error) {
        console.error("Calendar access error:", error);
        router.push("/login");
      } finally {
        setCheckingAccess(false);
        setLoading(false);
      }
    };

    checkAndLoad();
  }, [router]);

  const loadCalendar = async (workshopId: string) => {
    const { data: appointmentsData, error: appointmentsError } = await supabase
      .from("repair_appointments")
      .select(
        "id, request_id, appointment_date, appointment_time, handover_method, pickup_address, customer_note, workshop_note, proposed_date, proposed_time, status, updated_at",
      )
      .eq("workshop_id", workshopId)
      .in("status", ["requested", "confirmed"])
      .order("appointment_date", { ascending: true })
      .order("appointment_time", { ascending: true });

    if (appointmentsError) {
      console.error("Failed to load appointments:", appointmentsError);
      setAppointments([]);
      return;
    }

    const safeAppointments = (appointmentsData || []) as RepairAppointment[];
    setAppointments(safeAppointments);

    const requestIds = Array.from(
      new Set(safeAppointments.map((item) => item.request_id).filter(Boolean)),
    );

    if (requestIds.length === 0) {
      setRequestsById({});
      return;
    }

    const { data: requestsData, error: requestsError } = await supabase
      .from("repair_requests")
      .select("id, car_brand, car_model, car_year, city, description, status")
      .in("id", requestIds);

    if (requestsError) {
      console.error("Failed to load requests:", requestsError);
      setRequestsById({});
      return;
    }

    const map: Record<string, RepairRequest> = {};

    (requestsData || []).forEach((request) => {
      map[request.id] = request;
    });

    setRequestsById(map);
  };

  const groupedAppointments = useMemo(() => {
    const groups: Record<string, RepairAppointment[]> = {};

    appointments.forEach((appointment) => {
      if (!groups[appointment.appointment_date]) {
        groups[appointment.appointment_date] = [];
      }

      groups[appointment.appointment_date].push(appointment);
    });

    return Object.entries(groups);
  }, [appointments]);

  const updateAppointmentStatus = async (
    appointmentId: string,
    status: "confirmed" | "declined",
  ) => {
    try {
      const { error } = await supabase
        .from("repair_appointments")
        .update({
          status,
          updated_at: new Date().toISOString(),
        })
        .eq("id", appointmentId);

      if (error) throw error;

      setAppointments((current) =>
        status === "declined"
          ? current.filter((item) => item.id !== appointmentId)
          : current.map((item) =>
              item.id === appointmentId ? { ...item, status } : item,
            ),
      );
    } catch (error) {
      console.error("Failed to update appointment:", error);
      alert("Nu am putut actualiza programarea.");
    }
  };

  if (checkingAccess) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-black text-white">
        Se verifică accesul...
      </main>
    );
  }

  if (!authorized) return null;

  return (
    <main className="min-h-screen bg-black px-5 py-8 text-white">
      <div className="mx-auto max-w-5xl">
        <div className="mb-8 flex items-center justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.25em] text-orange-400">
              Service auto
            </p>
            <h1 className="mt-2 text-3xl font-black">Calendar programări</h1>
            <p className="mt-2 text-sm text-white/55">
              Vezi programările cerute de clienți și confirmă rapid intervalele.
            </p>
          </div>

          <button
            type="button"
            onClick={() => router.push("/workshops/dashboard")}
            className="rounded-full border border-white/15 px-4 py-2 text-sm font-bold text-white"
          >
            Dashboard
          </button>
        </div>

        {loading ? (
          <div className="rounded-[28px] border border-white/10 bg-white/[0.04] p-8 text-center text-white/60">
            Se încarcă programările...
          </div>
        ) : appointments.length === 0 ? (
          <div className="rounded-[28px] border border-white/10 bg-white/[0.04] p-8 text-center">
            <h2 className="text-2xl font-bold">Nu ai programări momentan</h2>
            <p className="mt-2 text-white/55">
              Când un client alege o dată, programarea va apărea aici.
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            {groupedAppointments.map(([date, dayAppointments]) => (
              <section
                key={date}
                className="overflow-hidden rounded-[28px] border border-white/10 bg-white/[0.04]"
              >
                <div className="border-b border-white/10 bg-white/[0.06] px-5 py-4">
                  <h2 className="text-xl font-black">
                    {formatDate(date)}
                  </h2>
                  <p className="mt-1 text-sm text-white/45">
                    {dayAppointments.length} programări
                  </p>
                </div>

                <div className="divide-y divide-white/10">
                  {dayAppointments.map((appointment) => {
                    const request = requestsById[appointment.request_id];

                    return (
                      <div key={appointment.id} className="p-5">
                        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                          <div>
                            <div className="flex items-center gap-3">
                              <span className="rounded-2xl bg-orange-500 px-4 py-2 text-sm font-black text-black">
                                {appointment.appointment_time}
                              </span>

                              <span
                                className={`rounded-full px-3 py-1 text-xs font-bold ${
                                  appointment.status === "confirmed"
                                    ? "bg-green-500/15 text-green-300"
                                    : "bg-yellow-500/15 text-yellow-300"
                                }`}
                              >
                                {appointment.status === "confirmed"
                                  ? "Confirmată"
                                  : "Așteaptă confirmare"}
                              </span>
                            </div>

                            <h3 className="mt-4 text-2xl font-black">
                              {request?.car_brand || "Mașină"}{" "}
                              {request?.car_model || ""}
                            </h3>

                            <p className="mt-1 text-sm text-white/50">
                              {request?.car_year || "-"} • {request?.city || "-"}
                            </p>

                            <p className="mt-3 text-sm leading-6 text-white/70">
                              {request?.description || "Fără descriere."}
                            </p>

                            <div className="mt-4 rounded-2xl bg-black/35 p-4 text-sm text-white/65">
                              <p>
                                {appointment.handover_method === "customer_dropoff"
                                  ? "Clientul aduce mașina la service"
                                  : "Service-ul ridică mașina"}
                              </p>

                              {appointment.pickup_address && (
                                <p className="mt-2">
                                  Adresă ridicare: {appointment.pickup_address}
                                </p>
                              )}

                              {appointment.customer_note && (
                                <p className="mt-2">
                                  Mesaj client: {appointment.customer_note}
                                </p>
                              )}
                            </div>
                          </div>

                          <div className="flex min-w-[180px] flex-col gap-2">
                            {appointment.status === "requested" && (
                              <>
                                <button
                                  type="button"
                                  onClick={() =>
                                    updateAppointmentStatus(
                                      appointment.id,
                                      "confirmed",
                                    )
                                  }
                                  className="rounded-2xl bg-green-500 px-4 py-3 text-sm font-black text-black"
                                >
                                  Confirmă
                                </button>

                                <button
                                  type="button"
                                  onClick={() => {
                                    if (
                                      confirm(
                                        "Sigur vrei să refuzi această programare?",
                                      )
                                    ) {
                                      updateAppointmentStatus(
                                        appointment.id,
                                        "declined",
                                      );
                                    }
                                  }}
                                  className="rounded-2xl border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm font-black text-red-300"
                                >
                                  Refuză
                                </button>
                              </>
                            )}

                            <button
                              type="button"
                              onClick={() =>
                                router.push(
                                  `/workshops/won-jobs/${appointment.request_id}`,
                                )
                              }
                              className="rounded-2xl border border-white/15 bg-white/5 px-4 py-3 text-sm font-bold text-white"
                            >
                              Deschide lucrarea
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}

function formatDate(date: string) {
  return new Date(date).toLocaleDateString("ro-RO", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}