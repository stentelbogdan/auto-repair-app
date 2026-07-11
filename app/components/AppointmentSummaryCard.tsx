import { CalendarDays, ChevronRight, Clock3 } from "lucide-react";

type AppointmentSummaryCardProps = {
  date?: string | null;
  time?: string | null;
  editable?: boolean;
  onClick?: () => void;
  helperText?: string;
  className?: string;
};

export default function AppointmentSummaryCard({
  date,
  time,
  editable = false,
  onClick,
  helperText = "Vezi toate programările și orele disponibile.",
  className = "",
}: AppointmentSummaryCardProps) {
  const hasAppointment = Boolean(date && time);

  const content = (
    <>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-orange-600">
          PROGRAMARE
        </p>

        <div className="mt-3 rounded-2xl bg-white px-4 py-4 shadow-sm">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              {hasAppointment ? (
                <>
                  <div className="flex items-center gap-2">
                    <CalendarDays
                      size={15}
                      strokeWidth={2.2}
                      className="shrink-0 text-orange-500"
                    />

                    <span className="text-sm font-bold text-black">
                      {formatDisplayDate(date)}
                    </span>
                  </div>

                  <div className="mt-1 flex items-center gap-2">
                    <Clock3
                      size={15}
                      strokeWidth={2.2}
                      className="shrink-0 text-orange-500"
                    />

                    <span className="text-sm font-bold text-black">
                      {time}
                    </span>
                  </div>
                </>
              ) : (
                <p className="text-sm font-bold text-black">
                  Alege data și ora
                </p>
              )}

              {helperText && (
                <p className="mt-3 text-xs leading-5 text-black/45">
                  {helperText}
                </p>
              )}
            </div>

            {editable && (
              <ChevronRight
                size={22}
                strokeWidth={2.8}
                className="shrink-0 text-black/45"
              />
            )}
          </div>
        </div>
      </div>
    </>
  );

  const wrapperClassName = [
    "rounded-2xl border border-orange-200 bg-orange-50 p-4",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  if (editable && onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={`${wrapperClassName} w-full text-left transition active:scale-[0.99]`}
      >
        {content}
      </button>
    );
  }

  return <div className={wrapperClassName}>{content}</div>;
}

function formatDisplayDate(value?: string | null) {
  if (!value) return "";

  const cleanValue = value.includes("T") ? value.split("T")[0] : value;
  const parts = cleanValue.split("-");

  if (parts.length !== 3) {
    return value;
  }

  const [year, month, day] = parts;

  return `${day}-${month}-${year}`;
}