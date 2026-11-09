"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import AppointmentDateTimePicker, {
  toLocalDateTime,
  toLocalDateValue,
} from "@/app/components/AppointmentDateTimePicker";
import { supabase } from "@/lib/supabase/client";
import { getWorkshopBookedSlots } from "@/lib/supabase/workshop-booked-slots";
import {
  customerProposeRepairAppointment,
  workshopProposeRepairAppointment,
  appointmentMutationErrorMessage,
} from "@/lib/supabase/repair-appointments";
import {
  getOwnRepairRequests,
  type RepairRequestRow,
} from "@/lib/supabase/repair-requests";
import {
  getOffersForCustomerRequests,
  type RepairOfferRow,
} from "@/lib/supabase/repair-offers";
import { isTowingServiceDetailsV1 } from "@/lib/towing/towing-service-details";
import { getTowingRequestedDateTime } from "@/lib/towing/towing-schedule-display";
import {
  getWorkshopRequestDetail,
  type WorkshopRequestDetail,
} from "@/lib/supabase/workshop-request-detail";

type HandoverMethod = "customer_dropoff" | "workshop_pickup";

type RepairRequest = RepairRequestRow | WorkshopRequestDetail;
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

  const isWorkshopEditMode = isWorkshopMode && !isInitialOfferMode;

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
  const [slotsError, setSlotsError] = useState("");
  const [loadedSlotsContext, setLoadedSlotsContext] = useState("");
  const slotsAttemptRef = useRef(0);
  const slotsContext = JSON.stringify([
    requestId, appointmentDate, offer?.workshop_user_id, offer?.id, isInitialOfferMode,
  ]);
  const slotsUnavailable = loadingSlots || Boolean(slotsError) ||
    !appointmentDate || !offer?.workshop_user_id || loadedSlotsContext !== slotsContext;
  const changeAppointmentDate = (date: string) => {
    if (date !== appointmentDate) {
      slotsAttemptRef.current += 1;
      setLoadedSlotsContext("");
      setAppointmentTime("");
    }
    setAppointmentDate(date);
  };
  const preserveInitialTimeRef = useRef(false);
  const prefilledAppointmentContextRef = useRef<string | null>(null);

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
        const requestRow = await getWorkshopRequestDetail(requestId);

        if (!requestRow) {
          alert("Lucrarea nu a fost găsită.");
          router.push("/workshops");
          return;
        }

        setRequest(requestRow);

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
            requestRow.service_type === "towing"
              ? "workshop_pickup"
              : explicitHandoverMethod ?? defaultHandoverMethod;
          const towingDetails = isTowingServiceDetailsV1(
            requestRow.service_details,
          )
            ? requestRow.service_details
            : null;
          const towingPickupAddress = towingDetails
            ? `${towingDetails.pickup.address}, ${towingDetails.pickup.city}`
            : "";
          const requestedDateTime = getTowingRequestedDateTime(
            requestRow.towing_schedule_type,
            requestRow.towing_requested_at,
            requestRow.towing_requested_timezone,
          );
          const initialDate = parsedDraft.date || requestedDateTime?.date || "";
          const initialTime = parsedDraft.time || requestedDateTime?.time || "";

          setHandoverMethod(initialHandoverMethod);
          setPickupAddress(
            requestRow.service_type === "towing"
              ? towingPickupAddress
              : typeof parsedDraft.pickupAddress === "string" &&
                  parsedDraft.pickupAddress.trim()
                ? parsedDraft.pickupAddress
                : initialHandoverMethod === "workshop_pickup" && towingDetails
                  ? towingPickupAddress
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
            available_date: initialDate || null,
            available_time: initialTime || null,
            status: "draft",
            created_at: new Date().toISOString(),
          } as RepairOffer);

          if (initialDate) {
            setAppointmentDate(initialDate);
            setDateInput(initialDate.split("-").reverse().join("."));
          }

          if (initialTime) {
            preserveInitialTimeRef.current =
              requestRow.service_type === "towing";
            setAppointmentTime(initialTime);
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

        const prefillContext = `${requestId}:${offerRow.id}:workshop`;

        if (prefilledAppointmentContextRef.current !== prefillContext) {
          const { data: currentAppointment, error: appointmentError } =
            await supabase
              .from("repair_appointments")
              .select(
                "offer_id, request_id, proposed_date, proposed_time, appointment_date, appointment_time",
              )
              .eq("offer_id", offerRow.id)
              .eq("request_id", requestId)
              .eq("workshop_id", authData.user.id)
              .maybeSingle();

          if (appointmentError) throw appointmentError;

          const initialDateTime =
            currentAppointment?.proposed_date &&
            currentAppointment.proposed_time
              ? {
                  date: currentAppointment.proposed_date,
                  time: currentAppointment.proposed_time,
                }
              : currentAppointment?.appointment_date &&
                  currentAppointment.appointment_time
                ? {
                    date: currentAppointment.appointment_date,
                    time: currentAppointment.appointment_time,
                  }
                : offerRow.available_date && offerRow.available_time
                  ? {
                      date: offerRow.available_date,
                      time: offerRow.available_time,
                    }
                  : null;

          prefilledAppointmentContextRef.current = prefillContext;

          if (initialDateTime) {
            preserveInitialTimeRef.current = true;
            setAppointmentDate(initialDateTime.date);
            setDateInput(initialDateTime.date.split("-").reverse().join("."));
            setAppointmentTime(initialDateTime.time);
          }
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

      const prefillContext = `${foundRequest.id}:${foundOffer.id}`;

      if (prefilledAppointmentContextRef.current !== prefillContext) {
        const { data: currentAppointment, error: appointmentError } =
          await supabase
            .from("repair_appointments")
            .select(
              "offer_id, request_id, proposed_date, proposed_time, appointment_date, appointment_time",
            )
            .eq("offer_id", foundOffer.id)
            .eq("request_id", foundRequest.id)
            .maybeSingle();

        if (appointmentError) throw appointmentError;

        const initialDateTime =
          currentAppointment?.proposed_date &&
          currentAppointment.proposed_time
            ? {
                date: currentAppointment.proposed_date,
                time: currentAppointment.proposed_time,
              }
            : currentAppointment?.appointment_date &&
                currentAppointment.appointment_time
              ? {
                  date: currentAppointment.appointment_date,
                  time: currentAppointment.appointment_time,
                }
              : foundOffer.available_date && foundOffer.available_time
                ? {
                    date: foundOffer.available_date,
                    time: foundOffer.available_time,
                  }
                : null;

        prefilledAppointmentContextRef.current = prefillContext;

        if (initialDateTime) {
          preserveInitialTimeRef.current = true;
          setAppointmentDate(initialDateTime.date);
          setDateInput(initialDateTime.date.split("-").reverse().join("."));
          setAppointmentTime(initialDateTime.time);
        }
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
    excludeAppointmentId: string | null,
    attempt: number,
  ): Promise<string[] | null> => {
    if (attempt !== slotsAttemptRef.current) return null;
    setLoadingSlots(true);
    setLoadedSlotsContext("");
    setSlotsError("");
    try {
      const slots = await getWorkshopBookedSlots(date, workshopId, excludeAppointmentId);
      if (attempt !== slotsAttemptRef.current) return null;
      setBookedSlots(slots);
      setLoadedSlotsContext(slotsContext);
      return slots;
    } catch {
      if (attempt === slotsAttemptRef.current) {
        setSlotsError("Nu am putut încărca orele ocupate. Reîncearcă verificarea disponibilității.");
      }
      return null;
    } finally {
      if (attempt === slotsAttemptRef.current) setLoadingSlots(false);
    }
  };

  useEffect(() => {
    const attempt = ++slotsAttemptRef.current;
    setLoadedSlotsContext("");
    setSlotsError("");
    if (!appointmentDate || !offer?.workshop_user_id) {
      setLoadingSlots(false);
      return;
    }
    setLoadingSlots(true);
    const loadSlots = async () => {
      try {
        let currentAppointmentId: string | null = null;
        if (!isInitialOfferMode && offer.id) {
          const { data: currentAppointment, error } = await supabase
            .from("repair_appointments")
            .select("id")
            .eq("offer_id", offer.id)
            .eq("request_id", requestId)
            .maybeSingle();
          if (error) throw error;
          currentAppointmentId = currentAppointment?.id || null;
        }
        if (attempt !== slotsAttemptRef.current) return;
        if (preserveInitialTimeRef.current) {
          preserveInitialTimeRef.current = false;
        } else {
          setAppointmentTime("");
        }
        await loadBookedSlots(appointmentDate, offer.workshop_user_id, currentAppointmentId, attempt);
      } catch {
        if (attempt === slotsAttemptRef.current) {
          setSlotsError("Nu am putut verifica programarea curentă. Reîncarcă pagina pentru a reîncerca.");
          setLoadingSlots(false);
        }
      }
    };
    void loadSlots();
    return () => { slotsAttemptRef.current += 1; };
  }, [
    appointmentDate,
    offer?.workshop_user_id,
    offer?.id,
    isInitialOfferMode,
    requestId,
    request?.service_type,
  ]);

  const submitAppointment = async () => {
    if (!request || !offer || saving) return;
    if (slotsUnavailable) {
      alert(slotsError || "Așteaptă verificarea disponibilității pentru data selectată.");
      return;
    }
    const attempt = ++slotsAttemptRef.current;

    const towingDetails =
      request.service_type === "towing" &&
      isTowingServiceDetailsV1(request.service_details)
        ? request.service_details
        : null;
    const towingPickupAddress = towingDetails
      ? `${towingDetails.pickup.address}, ${towingDetails.pickup.city}`
      : null;
    const effectiveHandoverMethod: HandoverMethod =
      request.service_type === "towing" ? "workshop_pickup" : handoverMethod;
    const effectivePickupAddress =
      request.service_type === "towing" ? towingPickupAddress : pickupAddress;

    if (request.service_type === "towing" && !effectivePickupAddress) {
      alert("Adresa de preluare a cererii Towing nu este disponibilă.");
      return;
    }

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
    setLoadingSlots(true);
    setLoadedSlotsContext("");
    try {
      if (!isInitialOfferMode && offer.id) {
        const { data: currentAppointment, error } = await supabase
          .from("repair_appointments")
          .select("id")
          .eq("offer_id", offer.id)
          .eq("request_id", request.id)
          .maybeSingle();
        if (error) throw error;
        currentAppointmentId = currentAppointment?.id || null;
      }
    } catch {
      if (attempt === slotsAttemptRef.current) {
        setSlotsError("Nu am putut verifica programarea curentă. Reîncarcă pagina pentru a reîncerca.");
        setLoadingSlots(false);
      }
      return;
    }

    const slots = await loadBookedSlots(
      appointmentDate, offer.workshop_user_id, currentAppointmentId, attempt,
    );
    if (!slots || attempt !== slotsAttemptRef.current) return;
    if (slots.includes(appointmentTime)) {
      alert("Ora selectată nu mai este disponibilă. Alege o altă dată sau oră.");
      setAppointmentTime("");
      return;
    }

    if (
      effectiveHandoverMethod === "workshop_pickup" &&
      (effectivePickupAddress?.trim().length ?? 0) < 5
    ) {
      alert("Introdu adresa de ridicare.");
      return;
    }

    setSaving(true);

    try {
      const { data: authData } = await supabase.auth.getUser();

      if (attempt !== slotsAttemptRef.current) return;

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
            handoverMethod: effectiveHandoverMethod,
            pickupAddress:
              effectiveHandoverMethod === "workshop_pickup"
                ? effectivePickupAddress?.trim() || ""
                : "",
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
            .select("id, updated_at, workshop_note")
            .eq("offer_id", offer.id)
            .eq("request_id", request.id)
            .eq("workshop_id", authData.user.id)
            .maybeSingle();

        if (attempt !== slotsAttemptRef.current) return;

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

        let updatedAppointment;
        try {
          updatedAppointment = await workshopProposeRepairAppointment({
            appointmentId: existingAppointment.id,
            expectedUpdatedAt: existingAppointment.updated_at,
            proposedDate: appointmentDate,
            proposedTime: appointmentTime,
            workshopNote: existingAppointment.workshop_note,
          });
        } catch (appointmentUpdateError) {
          console.error(
            "Failed to update workshop appointment:",
            appointmentUpdateError,
          );
          alert(appointmentMutationErrorMessage(appointmentUpdateError));
          return;
        }

        if (!updatedAppointment) {
          alert("Programarea nu a fost actualizată.");
          return;
        }

        router.replace(offer.status === "accepted"
          ? `/workshops/won-jobs?tab=${request.status === "in_progress" ? "workshop" : "appointments"}&appointmentUpdated=1`
          : "/workshops/my-offers?appointmentUpdated=1");
        return;
      }

      const { data: existingAppointment, error: appointmentLoadError } =
        await supabase
          .from("repair_appointments")
          .select("id, updated_at")
          .eq("offer_id", offer.id)
          .eq("request_id", request.id)
          .eq("customer_id", authData.user.id)
          .maybeSingle();

      if (attempt !== slotsAttemptRef.current) return;

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

      try {
        await customerProposeRepairAppointment({
          appointmentId: existingAppointment.id,
          expectedUpdatedAt: existingAppointment.updated_at,
          proposedDate: appointmentDate,
          proposedTime: appointmentTime,
          handoverMethod: effectiveHandoverMethod,
          pickupAddress:
            effectiveHandoverMethod === "workshop_pickup"
              ? effectivePickupAddress?.trim() || null
              : null,
          customerNote: customerNote.trim() || null,
        });
      } catch (appointmentUpdateError) {
        console.error(
          "Failed to update customer appointment:",
          appointmentUpdateError,
        );
        alert(appointmentMutationErrorMessage(appointmentUpdateError));
        return;
      }

      router.replace(offer.status === "accepted"
        ? `/customer/my-jobs?tab=${request.status === "in_progress" ? "in_progress" : "scheduled"}&appointmentUpdated=1&focusRequest=${request.id}`
        : "/offers?appointmentUpdated=1");
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
                {request.service_type === "towing" ? (
                  offer.price !== null &&
                  offer.price !== undefined &&
                  offer.price !== "" && (
                    <p className="mt-1 text-sm text-black/60">
                      €{offer.price}
                    </p>
                  )
                ) : (
                  <p className="mt-1 text-sm text-black/60">
                    €{offer.price} • {offer.days}{" "}
                    {String(offer.days) === "1" ? "zi" : "zile"}
                  </p>
                )}
              </div>
            </div>

            <AppointmentDateTimePicker
              date={appointmentDate}
              dateInput={dateInput}
              dateError={dateError}
              time={appointmentTime}
              timeSlots={timeSlots}
              timeSelectionMode={
                request.service_type === "towing" ? "wheel" : "grid"
              }
              disabledTimes={bookedSlots}
              loadingTimes={slotsUnavailable || saving}
              minDate={minDate}
              onDateChange={changeAppointmentDate}
              onDateInputChange={setDateInput}
              onDateErrorChange={setDateError}
              onTimeChange={setAppointmentTime}
            />

            {slotsError && (
              <p role="alert" className="rounded-2xl bg-red-50 p-4 text-sm text-red-700">
                {slotsError} Reîncarcă pagina pentru a reîncerca.
              </p>
            )}

            {!isWorkshopEditMode && (
              <div className="rounded-[26px] bg-white p-5 text-black">
                {request.service_type !== "towing" && (
                  <>
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
                          onChange={(event) =>
                            setPickupAddress(event.target.value)
                          }
                          placeholder="Ex: Strada Principală 10, Iași"
                          className="mt-2 w-full rounded-2xl border border-black/10 bg-gray-50 px-4 py-4 outline-none focus:border-orange-500"
                        />
                      </div>
                    )}
                  </>
                )}

                <div
                  className={request.service_type === "towing" ? "" : "mt-4"}
                >
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
            )}

            <button
              type="button"
              disabled={saving || slotsUnavailable}
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
