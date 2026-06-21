"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
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

  const [request, setRequest] = useState<RepairRequest | null>(null);
  const [offer, setOffer] = useState<RepairOffer | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [appointmentDate, setAppointmentDate] = useState("");
  const [appointmentTime, setAppointmentTime] = useState("");
  const [handoverMethod, setHandoverMethod] =
    useState<HandoverMethod>("customer_dropoff");
  const [pickupAddress, setPickupAddress] = useState("");
  const [customerNote, setCustomerNote] = useState("");

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

      if (!foundRequest.accepted_offer_id) {
        alert("Această lucrare nu are încă o ofertă acceptată.");
        router.push("/customer/my-jobs");
        return;
      }

      const foundOffer = offerRows.find(
        (offer) =>
          offer.id === foundRequest.accepted_offer_id ||
          (offer.request_id === foundRequest.id && offer.status === "accepted"),
      );

      if (!foundOffer) {
        alert("Oferta acceptată nu a fost găsită.");
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

      const { error } = await supabase.from("repair_appointments").insert({
        request_id: request.id,
        offer_id: offer.id,
        customer_id: authData.user.id,
        workshop_id: offer.workshop_user_id,
        appointment_date: appointmentDate,
        appointment_time: appointmentTime,
        handover_method: handoverMethod,
        pickup_address:
          handoverMethod === "workshop_pickup" ? pickupAddress.trim() : null,
        customer_note: customerNote.trim() || null,
        status: "requested",
      });

      if (error) {
        console.error("Failed to create appointment:", error);
        alert("Nu am putut trimite programarea.");
        return;
      }

      alert("Programarea a fost trimisă către service pentru confirmare.");
      router.push("/customer/my-jobs");
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
            className="rounded-full border border-white/15 px-4 py-2 text-sm font-semibold text-white"
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

            <div className="rounded-[26px] bg-white p-5 text-black">
              <label className="text-sm font-bold text-black/70">Data</label>
              <input
                type="date"
                min={minDate}
                value={appointmentDate}
                onChange={(event) => setAppointmentDate(event.target.value)}
                className="mt-2 w-full rounded-2xl border border-black/10 bg-gray-50 px-4 py-4 text-lg outline-none focus:border-orange-500"
              />

              <label className="mt-5 block text-sm font-bold text-black/70">
                Ora
              </label>

              <div className="mt-3 grid grid-cols-3 gap-2">
                {timeSlots.map((slot) => (
                  <button
                    key={slot}
                    type="button"
                    onClick={() => setAppointmentTime(slot)}
                    className={`rounded-2xl px-4 py-3 text-sm font-black ${
                      appointmentTime === slot
                        ? "bg-orange-500 text-black"
                        : "bg-black/[0.05] text-black"
                    }`}
                  >
                    {slot}
                  </button>
                ))}
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
