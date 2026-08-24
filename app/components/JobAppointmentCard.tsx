"use client";

import { MessageCircle, Wrench } from "lucide-react";
import CarHeader from "@/app/components/CarHeader";
import OfferSummaryCard from "@/app/components/OfferSummaryCard";
import RequestClientName from "@/app/components/RequestClientName";
import { interactiveButton } from "@/lib/ui";
import type { MechanicalServiceDetailGroup } from "@/lib/mechanical/mechanical-service-details";

type JobImage = {
  name?: string;
  dataUrl?: string;
  url?: string;
};

type JobAppointmentCardProps = {
  requestId: string;
  offerId: string;

  images?: JobImage[];
  licensePlate?: string | null;
  carBrand?: string | null;
  carModel?: string | null;
  carYear?: string | null;
  city?: string | null;
  affectedParts?: string[];
  damageTypes?: string[];
  mechanicalDetails?: MechanicalServiceDetailGroup[];
  description?: string | null;
  clientName?: string | null;

  price?: string | number | null;
  days?: string | number | null;

  appointmentDate?: string | null;
  appointmentTime?: string | null;
  handoverText?: string;
  statusText?: string;
  badgeText?: string;
  badgeColor?: "yellow" | "orange" | "gray" | "green" | "blue" | "red";
  requestTypeLabel?: string;

  message?: string | null;

  onChat: () => void;
  onStartJob: () => void;
};

export default function JobAppointmentCard({
  images = [],
  licensePlate,
  carBrand,
  carModel,
  carYear,
  city,
  affectedParts = [],
  damageTypes = [],
  mechanicalDetails = [],
  description,
  clientName,
  price,
  days,
  appointmentDate,
  appointmentTime,
  handoverText = "Predare: Clientul aduce mașina",
  statusText = "Confirmată",
  badgeText = "Programare confirmată",
  badgeColor = "blue",
  requestTypeLabel,
  message,
  onChat,
  onStartJob,
}: JobAppointmentCardProps) {
  return (
    <article className="overflow-hidden rounded-[30px] bg-white p-4 text-black shadow-xl">
      <CarHeader
        images={images}
        plate={licensePlate}
        platePosition="bottom"
        brand={carBrand || "Mașină"}
        model={carModel || ""}
        year={carYear || ""}
        city={city || ""}
        variant="listLarge"
        affectedParts={affectedParts}
        damageTypes={damageTypes}
        mechanicalDetails={mechanicalDetails}
        details={[
          {
            text: badgeText,
            color: badgeColor,
          },
          ...(requestTypeLabel
            ? [{ text: requestTypeLabel, color: "orange" as const }]
            : []),
        ]}
      />

      <RequestClientName name={clientName} />

      <div className="mt-5">
        <OfferSummaryCard
          title="Programare confirmată"
          price={price}
          days={days}
          appointmentDate={appointmentDate}
          appointmentTime={appointmentTime}
          handoverText={handoverText}
          statusText={statusText}
        />
      </div>

      <div className="mt-5 rounded-2xl border border-black/10 bg-black/[0.03] p-3">
        <p className="mb-2 text-[13px] font-semibold leading-[18px] text-black/60">
          📝 Descriere
        </p>

        <p className="text-[15px] leading-6 text-black/70">
          {description || "Fără descriere."}
        </p>
      </div>

      {message && (
        <div className="mt-4 rounded-2xl border border-black/10 bg-black/[0.03] p-3">
          <p className="mb-2 text-[13px] font-semibold leading-[18px] text-black/60">
            Mesaj ofertă
          </p>

          <p className="text-[15px] leading-6 text-black/70">{message}</p>
        </div>
      )}

      <div className="mt-6 grid grid-cols-2 gap-3">
        <button
          type="button"
          onClick={onChat}
          className={`${interactiveButton} inline-flex items-center justify-center gap-2 rounded-[20px] bg-black px-4 py-5 text-sm font-bold text-white`}
        >
          <MessageCircle size={18} strokeWidth={2.4} />
          Chat
        </button>

        <button
          type="button"
          onClick={onStartJob}
          className={`${interactiveButton} inline-flex items-center justify-center gap-2 rounded-[20px] bg-black px-4 py-5 text-sm font-bold text-white`}
        >
          <Wrench size={18} strokeWidth={2.4} />
          Începe lucrarea
        </button>
      </div>
    </article>
  );
}
