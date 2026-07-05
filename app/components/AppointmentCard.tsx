import { CalendarDays, Clock3 } from "lucide-react";

type AppointmentCardProps = {
  title?: string;
  date?: string | null;
  time?: string | null;
  handoverText?: string | null;
  statusText?: string | null;
  className?: string;
};

export default function AppointmentCard({
  title = "Detalii programare",
  date,
  time,
  handoverText = "Predare: Clientul aduce mașina",
  statusText = "Așteaptă confirmare",
  className = "",
}: AppointmentCardProps) {
  if (!date && !time) return null;

  return (
    <div className={`mt-4 rounded-[24px] bg-orange-50 p-5 ${className}`}>
      <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-orange-600">
        {title}
      </p>

      <div className="mt-4 rounded-[22px] border border-orange-300 bg-gradient-to-r from-orange-100 via-orange-50 to-orange-100 p-5">
        {date && (
          <div className="flex items-center gap-3 text-black">
            <CalendarDays
              size={16}
              strokeWidth={2.4}
              className="text-slate-400"
            />

            <span className="text-base font-semibold">
              {formatDate(date)}
            </span>
          </div>
        )}

        {time && (
          <div className="mt-3 flex items-center gap-3 text-black/70">
            <Clock3
              size={16}
              strokeWidth={2.4}
              className="text-slate-400"
            />

            <span className="text-base font-semibold">
              Ora {time.slice(0, 5)}
            </span>
          </div>
        )}
      </div>

      {handoverText && (
        <p className="mt-4 text-sm text-black/55">
          {handoverText}
        </p>
      )}

      {statusText && (
        <span className="mt-3 inline-flex rounded-full bg-black px-4 py-1.5 text-[13px] font-semibold text-white">
          {statusText}
        </span>
      )}
    </div>
  );
}

function formatDate(date: string) {
  if (!date) return "";

  if (date.includes("-")) {
    return date.split("-").reverse().join(".");
  }

  return date;
}