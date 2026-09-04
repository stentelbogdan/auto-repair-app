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
import { isTowingServiceDetailsV1 } from "@/lib/towing/towing-service-details";

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

  const roleFromUrl = searchParams.get("from");

  const isWorkshopMode = roleFromUrl === "workshop";
  const isInitialOfferMode =
    isWorkshopMode && searchParams.get("mode") === "initial-offer";

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
    return toLocalDateValue(new Date());
  }, []);

  const loadData = async () => {
    try {
      const { data: authData } = await supabase.auth.getUser();

      if (!authData.user) {
        router.push("/login");
        return;
      }

      // MOD SERVICE
      if (isWorkshopMode) {
        const { data: requestRow, error: requestError } = await supabase
          .from("repair_requests")
          .select("*")
          .eq("id", requestId)
          .maybeSingle();

        if (requestError) throw requestError;

        if (!requestRow) {
          alert("Lucrarea nu a fost găsită.");
          router.push("/workshops");
          return;
        }

        setRequest(requestRow as RepairRequest);

        // Oferta inițială încă nu există în baza de date.
        // Folosim temporar datele salvate în sessionStorage.
        if (isInitialOfferMode) {
          const savedDraft = sessionStorage.getItem(
            `availability-${requestId}`,
          );
          const parsedDraft = savedDraft ? JSON.parse(savedDraft) : {};
          const explicitHandoverMethod =
            parsedDraft.handoverMethod === "customer_dropoff" ||
            parsedDraft.handoverMethod === "workshop_pickup"
              ? parsedDraft.handoverMethod
              : null;
          const defaultHandoverMethod: HandoverMethod =
            requestRow.service_type === "towing"
              ? "workshop_pickup"
              : "customer_dropoff";
          const initialHandoverMethod =
            explicitHandoverMethod ?? defaultHandoverMethod;
          const towingDetails = isTowingServiceDetailsV1(
            requestRow.service_details,
          )
            ? requestRow.service_details
            : null;

          setHandoverMethod(initialHandoverMethod);
          setPickupAddress(
            typeof parsedDraft.pickupAddress === "string" &&
              parsedDraft.pickupAddress.trim()
              ? parsedDraft.pickupAddress
              : initialHandoverMethod === "workshop_pickup" && towingDetails
                ? `${towingDetails.pickup.address}, ${towingDetails.pickup.city}`
                : "",
          );

          setOffer({
            id: "",
            request_id: requestId,
            workshop_user_id: authData.user.id,
            price: parsedDraft.price || "",
            days: parsedDraft.days || "",
            message: parsedDraft.message || null,
            workshop_name: parsedDraft.workshopName || "Service",
            available_date: parsedDraft.date || null,
            available_time: parsedDraft.time || null,
            status: "draft",
            created_at: new Date().toISOString(),
          } as RepairOffer);

          if (parsedDraft.date) {
            setAppointmentDate(parsedDraft.date);
            setDateInput(parsedDraft.date.split("-").reverse().join("."));
          }

          if (parsedDraft.time) {
            setAppointmentTime(parsedDraft.time);
          }

          return;
        }

        // Modificarea unei programări existente
        if (!offerIdFromUrl) {
          alert("Oferta nu a fost găsită.");
          router.push("/workshops/my-offers");
          return;
        }

        const { data: offerRow, error: offerError } = await supabase
          .from("repair_offers")
          .select("*")
          .eq("id", offerIdFromUrl)
          .eq("request_id", requestId)
          .eq("workshop_user_id", authData.user.id)
          .maybeSingle();

        if (offerError) throw offerError;

        if (!offerRow) {
          alert("Oferta nu a fost găsită pentru acest service.");
          router.push("/workshops/my-offers");
          return;
        }

        setOffer(offerRow as RepairOffer);
        return;
      }

      // MOD CLIENT
      const [requestRows, offerRows] = await Promise.all([
        getOwnRepairRequests(authData.user.id),
        getOffersForCustomerRequests(authData.user.id),
      ]);

      const foundRequest = requestRows.find((item) => item.id === requestId);

      if (!foundRequest) {
        alert("Lucrarea nu a fost găsită.");
        router.push("/offers");
        return;
      }

      const foundOffer = offerRows.find(
        (currentOffer) =>
          currentOffer.id === offerIdFromUrl ||
          currentOffer.id === foundRequest.accepted_offer_id ||
          (currentOffer.request_id === foundRequest.id &&
            currentOffer.status === "accepted"),
      );

      if (!foundOffer) {
        alert("Oferta nu a fost găsită.");
        router.push("/offers");
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
    if (typeof window !== "undefined") {
      localStorage.setItem(
        "activeRole",
        isWorkshopMode ? "workshop" : "customer",
      );
    }

    loadData();
  }, [isWorkshopMode, offerIdFromUrl, requestId]);

  const loadBookedSlots = async (
    date: string,
    workshopId: string,
    excludeAppointmentId?: string | null,
  ) => {
    if (!date || !workshopId) {
      setBookedSlots([]);
      return;
    }

    try {
      setLoadingSlots(true);

      const { data, error } = await supabase.rpc("get_workshop_booked_slots", {
        p_workshop_id: workshopId,
        p_date: date,
        p_exclude_appointment_id: excludeAppointmentId ?? null,
      });

      if (error) {
        console.error("Failed to load booked slots:", error);
        setBookedSlots([]);
        return;
      }

      const slots: string[] = (data ?? []).flatMap(
        (row: { slot_time?: string | null }) =>
          row.slot_time ? [row.slot_time] : [],
      );

      setBookedSlots(slots);
    } finally {
      setLoadingSlots(false);
    }
  };

  useEffect(() => {
    if (!appointmentDate || !offer?.workshop_user_id) {
      setBookedSlots([]);
      return;
    }

    const loadSlots = async () => {
      let currentAppointmentId: string | null = null;

      if (!isInitialOfferMode && offer.id) {
        const { data: currentAppointment, error } = await supabase
          .from("repair_appointments")
          .select("id")
          .eq("offer_id", offer.id)
          .eq("request_id", requestId)
          .maybeSingle();

        if (error) {
          console.error("Failed to load current appointment:", error);
        }

        currentAppointmentId = currentAppointment?.id || null;
      }

      setAppointmentTime("");

      await loadBookedSlots(
        appointmentDate,
        offer.workshop_user_id,
        currentAppointmentId,
      );
    };

    void loadSlots();
  }, [
    appointmentDate,
    offer?.workshop_user_id,
    offer?.id,
    isInitialOfferMode,
    requestId,
  ]);

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

    const selectedDateTime = toLocalDateTime(
      appointmentDate,
      appointmentTime,
    );

    if (!selectedDateTime) {
      alert("Alege o dată și o oră valide.");
      return;
    }

    if (selectedDateTime.getTime() <= new Date().getTime()) {
      alert("Alege o dată și o oră care nu au trecut.");
      return;
    }

    let currentAppointmentId: string | null = null;

    if (!isInitialOfferMode && offer.id) {
      const { data: currentAppointment, error: currentAppointmentError } =
        await supabase
          .from("repair_appointments")
          .select("id")
          .eq("offer_id", offer.id)
          .eq("request_id", request.id)
          .maybeSingle();

      if (currentAppointmentError) {
        console.error(
          "Failed to load current appointment:",
          currentAppointmentError,
        );
        alert("Nu am putut verifica programarea curentă.");
        return;
      }

      currentAppointmentId = currentAppointment?.id || null;
    }

    const { data: bookedSlotsData, error: bookedSlotsError } =
      await supabase.rpc("get_workshop_booked_slots", {
        p_workshop_id: offer.workshop_user_id,
        p_date: appointmentDate,
        p_exclude_appointment_id: currentAppointmentId,
      });

    if (bookedSlotsError) {
      console.error("Failed to verify appointment slot:", bookedSlotsError);
      alert("Nu am putut verifica disponibilitatea intervalului.");
      return;
    }

    const slotIsOccupied = (bookedSlotsData ?? []).some(
      (row: { slot_time?: string | null }) => row.slot_time === appointmentTime,
    );

    if (slotIsOccupied) {
      alert(
        "Ora selectată nu mai este disponibilă. Alege o altă dată sau oră.",
      );

      await loadBookedSlots(
        appointmentDate,
        offer.workshop_user_id,
        currentAppointmentId,
      );

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

      if (isInitialOfferMode) {
        const savedDraft = sessionStorage.getItem(`availability-${request.id}`);
        const parsedDraft = savedDraft ? JSON.parse(savedDraft) : {};

        sessionStorage.setItem(
          `availability-${request.id}`,
          JSON.stringify({
            ...parsedDraft,
            date: appointmentDate,
            time: appointmentTime,
            handoverMethod,
            pickupAddress:
              handoverMethod === "workshop_pickup" ? pickupAddress.trim() : "",
          }),
        );

        router.push(
          `/workshops/${request.id}?date=${appointmentDate}&time=${appointmentTime}`,
        );

        return;
      }

      if (isWorkshopMode) {
        const { data: existingAppointment, error: appointmentLoadError } =
          await supabase
            .from("repair_appointments")
            .select("id")
            .eq("offer_id", offer.id)
            .eq("request_id", request.id)
            .eq("workshop_id", authData.user.id)
            .maybeSingle();

        if (appointmentLoadError) {
          console.error(
            "Failed to load existing appointment:",
            appointmentLoadError,
          );
          alert("Nu am putut găsi programarea.");
          return;
        }

        if (!existingAppointment) {
          alert("Programarea nu a fost găsită.");
          return;
        }

        console.log("SALVARE PROGRAMARE", {
          roleFromUrl,
          isWorkshopMode,
          statusTrimis: isWorkshopMode
            ? "workshop_proposed"
            : "customer_proposed",
          offerId: offer.id,
        });

        const { data: updatedAppointment, error: appointmentUpdateError } =
          await supabase
            .from("repair_appointments")
            .update({
              proposed_date: appointmentDate,
              proposed_time: appointmentTime,

              handover_method: handoverMethod,

              pickup_address:
                handoverMethod === "workshop_pickup"
                  ? pickupAddress.trim()
                  : null,

              customer_note: customerNote.trim() || null,
              workshop_note: null,

              status: "workshop_proposed",
              updated_at: new Date().toISOString(),
            })
            .eq("id", existingAppointment.id)
            .select(
              "id, proposed_date, proposed_time, status, workshop_id, customer_id",
            )
            .single();

        if (appointmentUpdateError) {
          console.error(
            "Failed to update workshop appointment:",
            appointmentUpdateError,
          );
          alert("Nu am putut trimite noua dată.");
          return;
        }

        if (!updatedAppointment) {
          alert("Programarea nu a fost actualizată.");
          return;
        }

        console.log("Programare actualizată:", updatedAppointment);

        router.replace("/workshops/my-offers?appointmentUpdated=1");
        return;
      }

      const { data: existingAppointment, error: appointmentLoadError } =
        await supabase
          .from("repair_appointments")
          .select("id")
          .eq("offer_id", offer.id)
          .eq("request_id", request.id)
          .eq("customer_id", authData.user.id)
          .maybeSingle();

      if (appointmentLoadError) {
        console.error(
          "Failed to load existing appointment:",
          appointmentLoadError,
        );
        alert("Nu am putut găsi programarea.");
        return;
      }

      if (!existingAppointment) {
        alert("Programarea nu a fost găsită.");
        return;
      }

      const { error: appointmentUpdateError } = await supabase
        .from("repair_appointments")
        .update({
          proposed_date: appointmentDate,
          proposed_time: appointmentTime,

          handover_method: handoverMethod,

          pickup_address:
            handoverMethod === "workshop_pickup" ? pickupAddress.trim() : null,

          customer_note: customerNote.trim() || null,
          workshop_note: null,

          status: "customer_proposed",
          updated_at: new Date().toISOString(),
        })
        .eq("id", existingAppointment.id);

      if (appointmentUpdateError) {
        console.error(
          "Failed to update customer appointment:",
          appointmentUpdateError,
        );
        alert("Nu am putut trimite noua dată.");
        return;
      }

      router.replace("/offers?appointmentUpdated=1");
      return;
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
            onClick={() => {
              if (isInitialOfferMode) {
                router.push(`/workshops/${requestId}`);
                return;
              }

              router.push(isWorkshopMode ? "/workshops/my-offers" : "/offers");
            }}
            className="rounded-full border border-white/15 px-4 py-2 text-xs font-medium text-white"
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

                      const isoDate = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

                      if (isoDate < toLocalDateValue(new Date())) {
                        setDateError("Data nu poate fi în trecut.");
                        setAppointmentDate("");
                        return;
                      }

                      setAppointmentDate(isoDate);
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

                      if (isoDate && isoDate < toLocalDateValue(new Date())) {
                        setDateError("Data nu poate fi în trecut.");
                        setAppointmentDate("");
                        return;
                      }

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
                  const isPast = isPastDateTime(
                    appointmentDate,
                    slot,
                    new Date(),
                  );

                  return (
                    <button
                      key={slot}
                      type="button"
                      disabled={
                        !appointmentDate || isBooked || isPast || loadingSlots
                      }
                      onClick={() => setAppointmentTime(slot)}
                      className={`rounded-2xl px-4 py-3 text-sm font-black transition ${
                        appointmentTime === slot
                          ? "bg-orange-500 text-black"
                          : isBooked
                            ? "cursor-not-allowed bg-black/10 text-black/30 line-through"
                            : !appointmentDate || isPast || loadingSlots
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
              {saving
                ? "Se salvează..."
                : isInitialOfferMode
                  ? "Continuă către ofertă"
                  : isWorkshopMode
                    ? "Trimite noua dată"
                    : "Trimite programarea"}
            </button>
          </div>
        )}
      </div>
    </main>
  );
}

function toLocalDateValue(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function toLocalDateTime(dateValue: string, timeValue: string) {
  const [year, month, day] = dateValue.split("-").map(Number);
  const [hour, minute] = timeValue.split(":").map(Number);

  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day) ||
    !Number.isInteger(hour) ||
    !Number.isInteger(minute)
  ) {
    return null;
  }

  const date = new Date(year, month - 1, day, hour, minute, 0, 0);

  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day ||
    date.getHours() !== hour ||
    date.getMinutes() !== minute
  ) {
    return null;
  }

  return date;
}

function isPastDateTime(dateValue: string, timeValue: string, now: Date) {
  if (!dateValue) return false;

  const dateTime = toLocalDateTime(dateValue, timeValue);
  return dateTime ? dateTime.getTime() <= now.getTime() : false;
}
