import { Clock3 } from "lucide-react";
import AppointmentCard from "@/app/components/AppointmentCard";
import { interactiveCard } from "@/lib/ui";

type OfferSummaryCardProps = {
  price?: string | number | null;
  days?: string | number | null;
  appointmentDate?: string | null;
  appointmentTime?: string | null;
  handoverText?: string | null;
  statusText?: string | null;
  title?: string;
};

export default function OfferSummaryCard({
  price,
  days,
  appointmentDate,
  appointmentTime,
  handoverText = "Predare: Clientul aduce mașina",
  statusText = "Așteaptă confirmare",
  title = "Oferta primită",
}: OfferSummaryCardProps) {
  return (
    <div
      onClick={(event) => event.stopPropagation()}
      className="mt-4 rounded-2xl bg-gray-100 p-4"
    >
      <div className="flex items-start justify-between gap-4">
        <p className="text-sm text-black/40">{title}</p>

        <div className="text-right">
          {price !== null && price !== undefined && price !== "" && (
            <p className="text-[38px] font-black leading-none text-black">
              €{price}
            </p>
          )}

          {days && (
            <p className="mt-0.5 flex items-center justify-end gap-1 text-[13px] font-medium leading-none text-black/55">
              <Clock3 size={15} strokeWidth={2.3} className="text-orange-400" />
              {days}
            </p>
          )}
        </div>
      </div>

      <AppointmentCard
        date={appointmentDate}
        time={appointmentTime}
        handoverText={handoverText}
        statusText={statusText}
      />
    </div>
  );
}
