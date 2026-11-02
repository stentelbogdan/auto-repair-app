import { supabase } from "@/lib/supabase/client";

export type RepairAppointmentMutationRow = {
  id: string;
  request_id: string;
  offer_id: string | null;
  customer_id: string;
  workshop_id: string;
  appointment_date: string;
  appointment_time: string;
  handover_method: "customer_dropoff" | "workshop_pickup";
  pickup_address: string | null;
  customer_note: string | null;
  workshop_note: string | null;
  proposed_date: string | null;
  proposed_time: string | null;
  status: "customer_proposed" | "workshop_proposed" | "confirmed" | "declined";
  updated_at: string;
};

async function runAppointmentRpc(
  name:
    | "customer_propose_repair_appointment"
    | "workshop_propose_repair_appointment"
    | "customer_accept_workshop_appointment"
    | "workshop_resolve_customer_appointment",
  parameters: Record<string, unknown>,
) {
  const { data, error } = await supabase.rpc(name, parameters).single();

  if (error) throw error;
  if (!data) {
    throw new Error("RPC-ul programării nu a returnat o programare validă.");
  }

  const row: unknown = data;
  const invalid = () => new Error("Răspunsul programării nu poate fi verificat. Reîncarcă înainte de o nouă încercare.");
  if (!row || typeof row !== "object" || Array.isArray(row)) throw invalid();
  const value = row as Record<string, unknown>;
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  for (const key of ["id", "request_id", "offer_id", "customer_id", "workshop_id"]) {
    if (typeof value[key] !== "string" || !uuid.test(value[key])) throw invalid();
  }
  for (const key of ["pickup_address", "customer_note", "workshop_note", "proposed_date", "proposed_time"]) {
    if (value[key] !== null && typeof value[key] !== "string") throw invalid();
  }
  if (value.id !== parameters.p_appointment_id ||
      typeof value.updated_at !== "string" || !Number.isFinite(Date.parse(value.updated_at)) ||
      value.updated_at === parameters.p_expected_updated_at ||
      typeof value.appointment_date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value.appointment_date) ||
      typeof value.appointment_time !== "string" || !value.appointment_time.trim() ||
      (value.handover_method !== "customer_dropoff" && value.handover_method !== "workshop_pickup")) throw invalid();
  const expectedStatus = name === "customer_propose_repair_appointment" ? "customer_proposed"
    : name === "workshop_propose_repair_appointment" ? "workshop_proposed"
    : name === "customer_accept_workshop_appointment" ? "confirmed" : parameters.p_decision;
  if (value.status !== expectedStatus) throw invalid();
  if (expectedStatus === "confirmed" && (value.proposed_date !== null || value.proposed_time !== null)) throw invalid();
  if (name.endsWith("propose_repair_appointment") &&
      (value.proposed_date !== parameters.p_proposed_date || value.proposed_time !== String(parameters.p_proposed_time).trim())) throw invalid();
  return value as RepairAppointmentMutationRow;
}

// No automatic mutation retry: a transport error may follow a committed result.
export function appointmentMutationErrorMessage(error: unknown): string {
  const code = error && typeof error === "object" && "code" in error ? error.code : null;
  if (code === "PT409" || code === "23505") return "Intervalul ales este ocupat. Reîncarcă disponibilitatea și alege alt interval.";
  if (code === "40001" || code === "55P03" || code === "40P01") return "Programarea a fost modificată sau este în curs de actualizare. Reîncarcă înainte de o nouă încercare.";
  if (code === "42501" || code === "55000") return "Această operațiune nu mai este permisă pentru programare. Reîncarcă datele.";
  return "Rezultatul operațiunii nu poate fi confirmat. Reîncarcă programarea înainte de o nouă încercare.";
}

export function customerProposeRepairAppointment(input: {
  appointmentId: string;
  expectedUpdatedAt: string;
  proposedDate: string;
  proposedTime: string;
  handoverMethod: "customer_dropoff" | "workshop_pickup";
  pickupAddress: string | null;
  customerNote: string | null;
}) {
  return runAppointmentRpc("customer_propose_repair_appointment", {
    p_appointment_id: input.appointmentId,
    p_expected_updated_at: input.expectedUpdatedAt,
    p_proposed_date: input.proposedDate,
    p_proposed_time: input.proposedTime,
    p_handover_method: input.handoverMethod,
    p_pickup_address: input.pickupAddress,
    p_customer_note: input.customerNote,
  });
}

export function workshopProposeRepairAppointment(input: {
  appointmentId: string;
  expectedUpdatedAt: string;
  proposedDate: string;
  proposedTime: string;
  workshopNote: string | null;
}) {
  return runAppointmentRpc("workshop_propose_repair_appointment", {
    p_appointment_id: input.appointmentId,
    p_expected_updated_at: input.expectedUpdatedAt,
    p_proposed_date: input.proposedDate,
    p_proposed_time: input.proposedTime,
    p_workshop_note: input.workshopNote,
  });
}

export function customerAcceptWorkshopAppointment(input: {
  appointmentId: string;
  expectedUpdatedAt: string;
}) {
  return runAppointmentRpc("customer_accept_workshop_appointment", {
    p_appointment_id: input.appointmentId,
    p_expected_updated_at: input.expectedUpdatedAt,
  });
}

export function workshopResolveCustomerAppointment(input: {
  appointmentId: string;
  expectedUpdatedAt: string;
  decision: "confirmed" | "declined";
}) {
  return runAppointmentRpc("workshop_resolve_customer_appointment", {
    p_appointment_id: input.appointmentId,
    p_expected_updated_at: input.expectedUpdatedAt,
    p_decision: input.decision,
  });
}
