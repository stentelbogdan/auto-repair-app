"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import {
  getOwnRepairRequests,
  type RepairRequestRow,
} from "@/lib/supabase/repair-requests";
import {
  getOffersForCustomerRequests,
  type RepairOfferRow,
} from "@/lib/supabase/repair-offers";

type HandoverMethod = "customer_dropoff" | "workshop_pickup";

type RepairRequest = RepairRequestRow;
type RepairOffer = RepairOfferRow;

const timeSlots = [
  "08:00",
  "09:00",
  "10:00",
  "11:00",
  "12:00",
  "13:00",
  "14:00",
  "15:00",
  "16:00",
];

export default function ScheduleDamagePage() {
  const router = useRouter();
  const params = useParams();
  const requestId = String(params.id);
  const searchParams = useSearchParams();
  const offerIdFromUrl = searchParams.get("offerId");

  const [request, setRequest] = useState<RepairRequest | null>(null);
  const [offer, setOffer] = useState<RepairOffer | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [appointmentDate, setAppointmentDate] = useState("");
  const [dateInput, setDateInput] = useState("");
  const [dateError, setDateError] = useState("");
  const [appointmentTime, setAppointmentTime] = useState("");
  const [handoverMethod, setHandoverMethod] =
    useState<HandoverMethod>("customer_dropoff");
  const [pickupAddress, setPickupAddress] = useState("");
  const [customerNote, setCustomerNote] = useState("");
  const [bookedSlots, setBookedSlots] = useState<string[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);

  const minDate = useMemo(() => {
    const date = new Date();
    date.setDate(date.getDate() + 1);
    return date.toISOString().split("T")[0];
  }, []);

  const loadData = async () => {
    try {
      const { data: authData } = await supabase.auth.getUser();

      if (!authData.user) {
        router.push("/login");
        return;
      }

      const [requestRows, offerRows] = await Promise.all([
        getOwnRepairRequests(authData.user.id),
        getOffersForCustomerRequests(authData.user.id),
      ]);

      console.log("requestId din URL:", requestId);
      console.log(
        "requestRows:",
        requestRows.map((item) => item.id),
      );

      const foundRequest = requestRows.find((item) => item.id === requestId);

      if (!foundRequest) {
        alert("Lucrarea nu a fost găsită.");
        router.push("/customer/my-jobs");
        return;
      }

      const foundOffer = offerRows.find(
        (offer) =>
          offer.id === offerIdFromUrl ||
          offer.id === foundRequest.accepted_offer_id ||
          (offer.request_id === foundRequest.id && offer.status === "accepted"),
      );

      if (!foundOffer) {
        alert("Oferta nu a fost găsită.");
        router.push("/customer/my-jobs");
        return;
      }

      setRequest(foundRequest);
      setOffer(foundOffer);
    } catch (error) {
      console.error("Failed to load schedule page:", error);
      alert("Nu am putut încărca pagina de programare.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const loadBookedSlots = async (date: string, workshopId: string) => {
    if (!date || !workshopId) {
      setBookedSlots([]);
      return;
    }

    try {
      setLoadingSlots(true);

      const { data, error } = await supabase
        .from("repair_appointments")
        .select("appointment_time")
        .eq("workshop_id", workshopId)
        .eq("appointment_date", date)
        .in("status", ["requested", "confirmed"]);

      if (error) {
        console.error("Failed to load booked slots:", error);
        setBookedSlots([]);
        return;
      }

      setBookedSlots(
        (data || [])
          .map((appointment) => appointment.appointment_time)
          .filter(Boolean),
      );
    } finally {
      setLoadingSlots(false);
    }
  };

  useEffect(() => {
    if (!appointmentDate || !offer?.workshop_user_id) {
      setBookedSlots([]);
      return;
    }

    setAppointmentTime("");
    loadBookedSlots(appointmentDate, offer.workshop_user_id);
  }, [appointmentDate, offer?.workshop_user_id]);

  const submitAppointment = async () => {
    if (!request || !offer) return;

    if (!appointmentDate) {
      alert("Alege data programării.");
      return;
    }

    if (!appointmentTime) {
      alert("Alege ora programării.");
      return;
    }

    if (bookedSlots.includes(appointmentTime)) {
      alert("Acest interval a fost ocupat. Alege altă oră.");
      return;
    }

    const { data: existingAppointments, error: existingAppointmentsError } =
      await supabase
        .from("repair_appointments")
        .select("id")
        .eq("workshop_id", offer.workshop_user_id)
        .eq("appointment_date", appointmentDate)
        .eq("appointment_time", appointmentTime)
        .in("status", ["requested", "confirmed"])
        .limit(1);

    if (existingAppointmentsError) {
      console.error(
        "Failed to verify appointment slot:",
        existingAppointmentsError,
      );
      alert("Nu am putut verifica disponibilitatea intervalului.");
      return;
    }

    if ((existingAppointments || []).length > 0) {
      alert("Acest interval tocmai a fost ocupat. Alege altă oră.");
      await loadBookedSlots(appointmentDate, offer.workshop_user_id);
      setAppointmentTime("");
      return;
    }

    if (
      handoverMethod === "workshop_pickup" &&
      pickupAddress.trim().length < 5
    ) {
      alert("Introdu adresa de ridicare.");
      return;
    }

    setSaving(true);

    try {
      const { data: authData } = await supabase.auth.getUser();

      if (!authData.user) {
        router.push("/login");
        return;
      }

      const { error: offerUpdateError } = await supabase
        .from("repair_offers")
        .update({ status: "accepted" })
        .eq("id", offer.id);

      if (offerUpdateError) {
        console.error("Failed to accept offer:", offerUpdateError);
        alert("Nu am putut accepta oferta.");
        return;
      }

      const { error: requestUpdateError } = await supabase
        .from("repair_requests")
        .update({
          status: "matched",
          accepted_offer_id: offer.id,
        })
        .eq("id", request.id);

      if (requestUpdateError) {
        console.error("Failed to update request:", requestUpdateError);
        alert("Oferta a fost acceptată, dar nu am putut actualiza lucrarea.");
        return;
      }

      const { error } = await supabase.from("repair_appointments").insert({
        request_id: request.id,
        offer_id: offer.id,
        customer_id: authData.user.id,
        workshop_id: offer.workshop_user_id,

        appointment_date: appointmentDate,
        appointment_time: appointmentTime,

        original_date: offer.available_date,
        original_time: offer.available_time,

        handover_method: handoverMethod,
        pickup_address:
          handoverMethod === "workshop_pickup" ? pickupAddress.trim() : null,
        customer_note: customerNote.trim() || null,

        status: "customer_proposed",
      });

      if (error) {
        console.error("Failed to create appointment:", error);
        alert("Nu am putut trimite programarea.");
        return;
      }

      router.replace("/customer/dashboard?appointmentSent=1");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <main className="min-h-screen bg-[#111111] px-4 py-6 text-white">
        <p className="text-white/60">Se încarcă...</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#111111] px-4 py-5 text-white">
      <div className="mx-auto max-w-3xl">
        <div className="mb-5 flex items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.25em] text-orange-400">
              Programare daună
            </p>
            <h1 className="mt-1 text-2xl font-black">Alege data și ora</h1>
          </div>

          <button
            onClick={() => router.push("/customer/my-jobs")}
            className="rounded-full border border-white/15 px-4 py-2 text-sm text-xs font-medium text-white"
          >
            Înapoi
          </button>
        </div>

        {request && offer && (
          <div className="space-y-4">
            <div className="rounded-[26px] bg-white p-5 text-black">
              <p className="text-sm text-black/50">Lucrare</p>
              <h2 className="mt-1 text-2xl font-black">
                {request.car_brand} {request.car_model}
              </h2>
              <p className="mt-1 text-sm text-black/55">
                {request.car_year} • {request.city}
              </p>

              <div className="mt-4 rounded-2xl bg-black/[0.04] p-4">
                <p className="text-xs text-black/45">Service</p>
                <p className="font-bold">{offer.workshop_name}</p>
                <p className="mt-1 text-sm text-black/60">
                  €{offer.price} • {offer.days}{" "}
                  {String(offer.days) === "1" ? "zi" : "zile"}
                </p>
              </div>
            </div>

            <div className="overflow-hidden rounded-[26px] bg-white p-5 text-black">
              <label className="text-sm font-bold text-black/70">Data</label>

              <div className="relative mt-2">
                <input
                  type="text"
                  inputMode="numeric"
                  placeholder="zz.ll.aaaa"
                  value={dateInput}
                  onChange={(e) => {
                    let value = e.target.value.replace(/\D/g, "");

                    if (value.length > 8) value = value.slice(0, 8);

                    let formatted = value;

                    if (value.length >= 3) {
                      formatted = `${value.slice(0, 2)}.${value.slice(2)}`;
                    }

                    if (value.length >= 5) {
                      formatted = `${value.slice(0, 2)}.${value.slice(2, 4)}.${value.slice(4)}`;
                    }

                    setDateInput(formatted);
                    setDateError("");

                    const dayText = value.slice(0, 2);
                    const monthText = value.slice(2, 4);

                    if (dayText.length === 2) {
                      const day = Number(dayText);

                      if (day < 1 || day > 31) {
                        setDateError("Introdu o dată validă.");
                        setAppointmentDate("");
                        return;
                      }
                    }

                    if (monthText.length === 2) {
                      const month = Number(monthText);

                      if (month < 1 || month > 12) {
                        setDateError("Introdu o dată validă.");
                        setAppointmentDate("");
                        return;
                      }
                    }

                    if (value.length === 8) {
                      const day = Number(value.slice(0, 2));
                      const month = Number(value.slice(2, 4));
                      const year = Number(value.slice(4, 8));

                      const selectedDate = new Date(year, month - 1, day);
                      const isRealDate =
                        selectedDate.getFullYear() === year &&
                        selectedDate.getMonth() === month - 1 &&
                        selectedDate.getDate() === day;

                      if (
                        day < 1 ||
                        day > 31 ||
                        month < 1 ||
                        month > 12 ||
                        year < new Date().getFullYear() ||
                        year > 2100 ||
                        !isRealDate
                      ) {
                        setDateError("Introdu o dată validă.");
                        setAppointmentDate("");
                        return;
                      }

                      setAppointmentDate(
                        `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
                      );
                    }
                  }}
                  className={`h-14 w-full rounded-2xl border px-4 pr-14 text-base outline-none transition-colors ${
                    dateError
                      ? "border-red-500 ring-2 ring-red-100 bg-red-50"
                      : "border-black/10 bg-white"
                  }`}
                />

                <div className="absolute right-4 top-1/2 h-8 w-8 -translate-y-1/2">
                  <div
                    className={`pointer-events-none absolute inset-0 flex items-center justify-center text-xl ${
                      dateError ? "text-red-500" : "text-black/60"
                    }`}
                  >
                    📅
                  </div>

                  <input
                    type="date"
                    min={minDate}
                    value={appointmentDate}
                    onChange={(e) => {
                      setDateError("");
                      const isoDate = e.target.value;

                      setAppointmentDate(isoDate);
                      setDateInput(isoDate.split("-").reverse().join("."));
                    }}
                    className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                  />
                </div>
              </div>

              {dateError && (
                <p className="mt-2 text-xs font-semibold text-red-500">
                  {dateError}
                </p>
              )}

              <label className="mt-5 block text-sm font-bold text-black/70">
                Ora
              </label>

              <div className="mt-3 grid grid-cols-3 gap-2">
                {timeSlots.map((slot) => {
                  const isBooked = bookedSlots.includes(slot);

                  return (
                    <button
                      key={slot}
                      type="button"
                      disabled={!appointmentDate || isBooked || loadingSlots}
                      onClick={() => setAppointmentTime(slot)}
                      className={`rounded-2xl px-4 py-3 text-sm font-black transition ${
                        appointmentTime === slot
                          ? "bg-orange-500 text-black"
                          : isBooked
                            ? "cursor-not-allowed bg-black/10 text-black/30 line-through"
                            : !appointmentDate || loadingSlots
                              ? "cursor-not-allowed bg-black/[0.04] text-black/30"
                              : "bg-black/[0.05] text-black"
                      }`}
                    >
                      {slot}
                      {isBooked && (
                        <span className="block text-[10px]">Ocupat</span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="rounded-[26px] bg-white p-5 text-black">
              <p className="text-sm font-bold text-black/70">
                Cum predai mașina?
              </p>

              <div className="mt-3 grid gap-3">
                <button
                  type="button"
                  onClick={() => setHandoverMethod("customer_dropoff")}
                  className={`rounded-2xl border p-4 text-left ${
                    handoverMethod === "customer_dropoff"
                      ? "border-orange-500 bg-orange-50"
                      : "border-black/10 bg-gray-50"
                  }`}
                >
                  <p className="font-black">Aduc eu mașina la service</p>
                  <p className="mt-1 text-sm text-black/55">
                    Te prezinți la service la data și ora aleasă.
                  </p>
                </button>

                <button
                  type="button"
                  onClick={() => setHandoverMethod("workshop_pickup")}
                  className={`rounded-2xl border p-4 text-left ${
                    handoverMethod === "workshop_pickup"
                      ? "border-orange-500 bg-orange-50"
                      : "border-black/10 bg-gray-50"
                  }`}
                >
                  <p className="font-black">Service-ul ridică mașina</p>
                  <p className="mt-1 text-sm text-black/55">
                    Completezi adresa de unde poate fi ridicată mașina.
                  </p>
                </button>
              </div>

              {handoverMethod === "workshop_pickup" && (
                <div className="mt-4">
                  <label className="text-sm font-bold text-black/70">
                    Adresă ridicare
                  </label>
                  <input
                    value={pickupAddress}
                    onChange={(event) => setPickupAddress(event.target.value)}
                    placeholder="Ex: Strada Principală 10, Iași"
                    className="mt-2 w-full rounded-2xl border border-black/10 bg-gray-50 px-4 py-4 outline-none focus:border-orange-500"
                  />
                </div>
              )}

              <div className="mt-4">
                <label className="text-sm font-bold text-black/70">
                  Mesaj opțional
                </label>
                <textarea
                  value={customerNote}
                  onChange={(event) => setCustomerNote(event.target.value)}
                  placeholder="Ex: Pot ajunge după ora 09:30 sau mașina are nevoie de platformă..."
                  className="mt-2 min-h-28 w-full rounded-2xl border border-black/10 bg-gray-50 px-4 py-4 outline-none focus:border-orange-500"
                />
              </div>
            </div>

            <button
              type="button"
              disabled={saving}
              onClick={submitAppointment}
              className="w-full rounded-[22px] bg-orange-500 py-4 text-lg font-black text-black disabled:opacity-50"
            >
              {saving ? "Se trimite..." : "Trimite programarea"}
            </button>
          </div>
        )}
      </div>
    </main>
  );
}
