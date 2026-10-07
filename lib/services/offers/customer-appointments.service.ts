import { finalizeCustomerRepairOffer } from "@/lib/supabase/repair-offers";
import type { CustomerOfferItem } from "@/lib/services/offers/customer-offers.types";

export type ConfirmCustomerAppointmentInput = {
  item: CustomerOfferItem;
};

export type ConfirmCustomerAppointmentResult = {
  offerId: string;
  requestId: string;
  appointmentId: string;
  confirmedDate: string;
  confirmedTime: string;
};

function getConfirmedDateAndTime(item: CustomerOfferItem): {
  confirmedDate: string;
  confirmedTime: string;
} {
  const { offer, appointment } = item;

  if (!appointment?.id) {
    throw new Error(
      "Programarea asociată acestei oferte nu a fost găsită.",
    );
  }

  if (
    appointment.status !== "workshop_proposed" &&
    appointment.status !== "requested"
  ) {
    throw new Error(
      "Această programare nu mai poate fi confirmată de client.",
    );
  }

  const confirmedDate =
    appointment.proposedDate ||
    appointment.appointmentDate ||
    offer.availableDate;

  const confirmedTime =
    appointment.proposedTime ||
    appointment.appointmentTime ||
    offer.availableTime;

  if (!confirmedDate || !confirmedTime) {
    throw new Error(
      "Programarea nu are o dată și o oră valide.",
    );
  }

  return {
    confirmedDate,
    confirmedTime,
  };
}

export async function confirmCustomerAppointment({
  item,
}: ConfirmCustomerAppointmentInput): Promise<ConfirmCustomerAppointmentResult> {
  const { offer, request, appointment } = item;

  if (!offer.id) {
    throw new Error("Oferta nu are un ID valid.");
  }

  if (!request.id) {
    throw new Error("Cererea asociată ofertei nu a fost găsită.");
  }

  if (!appointment?.id) {
    throw new Error(
      "Programarea asociată acestei oferte nu a fost găsită.",
    );
  }

  const { confirmedDate, confirmedTime } =
    getConfirmedDateAndTime(item);

  await finalizeCustomerRepairOffer({
    offerId: offer.id,
    requestId: request.id,
  });

  return {
    offerId: offer.id,
    requestId: request.id,
    appointmentId: appointment.id,
    confirmedDate,
    confirmedTime,
  };
}
