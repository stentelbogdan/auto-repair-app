import type { RepairServiceDetails } from "@/lib/supabase/repair-requests";
import type { RepairServiceType } from "@/lib/repair-requests/service-types";

export type CustomerOfferImage = {
  name: string;
  url?: string;
  dataUrl?: string;
};

export type CustomerOfferRepairRequest = {
  id: string;
  licensePlate?: string | null;
  carBrand: string;
  carModel: string;
  carYear: string;
  city: string;
  damageType: string;
  serviceType?: RepairServiceType | null;
  serviceDetails?: RepairServiceDetails | null;
  description: string;
  images: CustomerOfferImage[];
  status?: string;
  acceptedOfferId?: string | null;
};

export type CustomerRepairOffer = {
  id: string;
  requestId: string;
  workshopUserId: string;
  workshopSlug: string | null;
  price: string;
  days: string;
  message: string;
  workshopName: string;
  createdAt: string;
  status?: string;
  workshopLogoUrl: string | null;
  availableDate: string | null;
  availableTime: string | null;
};

export type CustomerAppointmentStatus =
  | "workshop_proposed"
  | "customer_proposed"
  | "requested"
  | "confirmed"
  | "declined"
  | "cancelled";

export type CustomerRepairAppointment = {
  id: string;
  requestId: string;
  offerId: string | null;
  status: CustomerAppointmentStatus | null;
  appointmentDate: string | null;
  appointmentTime: string | null;
  proposedDate: string | null;
  proposedTime: string | null;
  handoverMethod: "customer_dropoff" | "workshop_pickup" | null;
  pickupAddress: string | null;
};

export type CustomerOfferItem = {
  offer: CustomerRepairOffer;
  request: CustomerOfferRepairRequest;
  appointment: CustomerRepairAppointment | null;
};
