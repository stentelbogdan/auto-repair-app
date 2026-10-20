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
  status: string;
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

  return data as RepairAppointmentMutationRow;
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
