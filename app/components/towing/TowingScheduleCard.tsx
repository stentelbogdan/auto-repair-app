import type { TowingScheduleType } from "@/lib/supabase/repair-requests";
import { getTowingScheduleDisplay } from "@/lib/towing/towing-schedule-display";

type TowingScheduleCardProps = {
  scheduleType: TowingScheduleType | null | undefined;
  requestedAt: string | null | undefined;
  requestedTimezone: string | null | undefined;
  className?: string;
};

export default function TowingScheduleCard({
  scheduleType,
  requestedAt,
  requestedTimezone,
  className = "",
}: TowingScheduleCardProps) {
  const display = getTowingScheduleDisplay(
    scheduleType,
    requestedAt,
    requestedTimezone,
  );

  if (!display) return null;

  return (
    <div
      className={`rounded-2xl border border-black/10 bg-black/[0.03] ${className}`}
    >
      <p className="text-[13px] font-bold uppercase tracking-wide text-orange-600">
        Solicitare transport
      </p>

      {display.kind === "scheduled" ? (
        <div className="mt-1 space-y-1 text-sm font-bold text-black/75">
          <p>DATA: {display.date}</p>
          <p>ORA: {display.time}</p>
        </div>
      ) : (
        <p className="mt-1 text-sm font-bold text-black/75">{display.label}</p>
      )}
    </div>
  );
}
