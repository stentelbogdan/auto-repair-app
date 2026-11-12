import { supabase } from "@/lib/supabase/client";

export async function getWorkshopBookedSlots(
  date: string,
  workshopId: string,
  excludeAppointmentId: string | null = null,
): Promise<string[]> {
  const { data, error } = await supabase.rpc("get_workshop_booked_slots", {
    p_workshop_id: workshopId,
    p_date: date,
    p_exclude_appointment_id: excludeAppointmentId,
  });
  if (error) throw error;
  return parseBookedSlots(data);
}

// Both controls use HH:mm. Accept SQL's equivalent zero-second representation,
// but never treat malformed/missing availability as an empty successful response.
export function parseBookedSlots(data: unknown): string[] {
  if (!Array.isArray(data)) throw new Error("Invalid booked slots response");
  return data.map((row: unknown) => {
    if (!row || typeof row !== "object" || !("slot_time" in row) ||
        typeof row.slot_time !== "string" ||
        !/^([01]\d|2[0-3]):[0-5]\d(?::00(?:\.0+)?)?$/.test(row.slot_time)) {
      throw new Error("Invalid booked slot");
    }
    return row.slot_time.slice(0, 5);
  });
}
