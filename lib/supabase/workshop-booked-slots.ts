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

// A fresh read before offer creation also covers stale drafts / direct form URLs.
// This is not a reservation; SQL remains the authority for concurrent collisions.
export async function assertWorkshopSlotAvailable(date: string, time: string, workshopId: string) {
  let slots: string[], candidate: string;
  try {
    candidate = parseBookedSlots([{ slot_time: time }])[0];
    slots = await getWorkshopBookedSlots(date, workshopId);
  } catch {
    throw new Error("Nu am putut verifica disponibilitatea orei. Oferta nu a fost trimisă. Reîncearcă.");
  }
  if (slots.includes(candidate)) {
    throw new Error("Ora selectată este ocupată. Alege altă oră înainte de a trimite oferta.");
  }
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
