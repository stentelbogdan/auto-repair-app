import type { TowingScheduleType } from "@/lib/supabase/repair-requests";

export function getTowingScheduleDisplay(
  scheduleType: TowingScheduleType | null | undefined,
  requestedAt: string | null | undefined,
  requestedTimezone: string | null | undefined,
): string | null {
  if (scheduleType === "asap") {
    return "Cât mai repede";
  }

  const timezone = requestedTimezone?.trim();

  if (scheduleType !== "scheduled" || !requestedAt || !timezone) {
    return null;
  }

  const requestedDate = new Date(requestedAt);

  if (Number.isNaN(requestedDate.getTime())) {
    return null;
  }

  try {
    const parts = new Intl.DateTimeFormat("ro-RO", {
      timeZone: timezone,
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(requestedDate);
    const values = new Map(parts.map((part) => [part.type, part.value]));
    const day = values.get("day");
    const month = values.get("month");
    const year = values.get("year");
    const hour = values.get("hour");
    const minute = values.get("minute");

    if (!day || !month || !year || !hour || !minute) {
      return null;
    }

    return `${day}.${month}.${year} · ${hour}:${minute}`;
  } catch {
    return null;
  }
}
