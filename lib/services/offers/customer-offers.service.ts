import { supabase } from "@/lib/supabase/client";
import { getOwnRepairRequests } from "@/lib/supabase/repair-requests";
import type {
  CustomerAppointmentStatus,
  CustomerOfferItem,
  CustomerOfferRepairRequest,
  CustomerRepairAppointment,
} from "@/lib/services/offers/customer-offers.types";

type CustomerOfferRow = {
  id: string;
  request_id: string;
  workshop_user_id: string;
  workshop_name: string | null;
  price: string | number;
  days: string | number;
  message: string | null;
  created_at: string;
  status: string | null;
  customer_read_at: string | null;
  available_date: string | null;
  available_time: string | null;
};

type AppointmentRow = {
  id: string;
  request_id: string;
  offer_id: string | null;
  status: string | null;
  appointment_date: string | null;
  appointment_time: string | null;
  proposed_date: string | null;
  proposed_time: string | null;
};

type WorkshopProfileRow = {
  id: string;
  workshop_slug: string | null;
  workshop_name: string | null;
  workshop_logo_url: string | null;
};

export type LoadCustomerOffersResult = {
  items: CustomerOfferItem[];
  markedOffersAsRead: boolean;
};

async function loadPendingOfferRows(
  requestIds: string[],
): Promise<CustomerOfferRow[]> {
  if (requestIds.length === 0) {
    return [];
  }

  const { data, error } = await supabase
    .from("repair_offers")
    .select(
      `
        id,
        request_id,
        workshop_user_id,
        workshop_name,
        price,
        days,
        message,
        created_at,
        status,
        customer_read_at,
        available_date,
        available_time
      `,
    )
    .in("request_id", requestIds)
    .eq("status", "pending")
    .order("created_at", { ascending: false });

  if (error) {
    throw error;
  }

  return (data ?? []) as CustomerOfferRow[];
}

async function loadAppointmentMap(
  offerIds: string[],
): Promise<Map<string, CustomerRepairAppointment>> {
  const appointmentMap = new Map<string, CustomerRepairAppointment>();

  if (offerIds.length === 0) {
    return appointmentMap;
  }

  const { data, error } = await supabase
    .from("repair_appointments")
    .select(
      `
        id,
        request_id,
        offer_id,
        status,
        appointment_date,
        appointment_time,
        proposed_date,
        proposed_time
      `,
    )
    .in("offer_id", offerIds);

  /*
   * Păstrăm comportamentul anterior:
   * ofertele se afișează și dacă programările nu pot fi încărcate.
   */
  if (error) {
    console.error("Failed to load customer offer appointments:", error);

    return appointmentMap;
  }

  ((data ?? []) as AppointmentRow[]).forEach((appointment) => {
    if (!appointment.offer_id) {
      return;
    }

    appointmentMap.set(appointment.offer_id, {
      id: appointment.id,
      requestId: appointment.request_id,
      offerId: appointment.offer_id,

      status: appointment.status
        ? (appointment.status as CustomerAppointmentStatus)
        : null,

      appointmentDate: appointment.appointment_date || null,

      appointmentTime: appointment.appointment_time || null,

      proposedDate: appointment.proposed_date || null,

      proposedTime: appointment.proposed_time || null,
    });
  });

  return appointmentMap;
}

async function loadWorkshopProfileMap(
  workshopUserIds: string[],
): Promise<Map<string, WorkshopProfileRow>> {
  if (workshopUserIds.length === 0) {
    return new Map();
  }

  const { data, error } = await supabase
    .from("profiles")
    .select("id, workshop_slug, workshop_name, workshop_logo_url")
    .in("id", workshopUserIds);

  /*
   * Profilul service-ului este informație suplimentară.
   * Oferta poate fi afișată și dacă această interogare eșuează.
   */
  if (error) {
    console.error("Failed to load customer offer workshop profiles:", error);

    return new Map();
  }

  return new Map(
    ((data ?? []) as WorkshopProfileRow[]).map((profile) => [
      profile.id,
      profile,
    ]),
  );
}

async function markOfferRowsAsRead(
  offerRows: CustomerOfferRow[],
): Promise<boolean> {
  const unreadOfferIds = offerRows
    .filter((offer) => !offer.customer_read_at)
    .map((offer) => offer.id);

  if (unreadOfferIds.length === 0) {
    return false;
  }

  const { error } = await supabase
    .from("repair_offers")
    .update({
      customer_read_at: new Date().toISOString(),
    })
    .in("id", unreadOfferIds);

  /*
   * Marcarea drept citit nu trebuie să împiedice
   * afișarea ofertelor.
   */
  if (error) {
    console.error("Failed to mark customer offers as read:", error);

    return false;
  }

  return true;
}

function createRequestMap(
  requests: Awaited<ReturnType<typeof getOwnRepairRequests>>,
): Map<string, CustomerOfferRepairRequest> {
  const requestMap = new Map<string, CustomerOfferRepairRequest>();

  requests.forEach((request) => {
    requestMap.set(request.id, {
      id: request.id,
      licensePlate: request.license_plate,
      carBrand: request.car_brand,
      carModel: request.car_model,
      carYear: request.car_year,
      city: request.city,
      damageType: request.damage_type,
      serviceDetails: request.service_details,
      description: request.description || "",

      images: Array.isArray(request.images) ? request.images : [],

      status: request.status,
      acceptedOfferId: request.accepted_offer_id,
    });
  });

  return requestMap;
}

function buildCustomerOfferItems(input: {
  offerRows: CustomerOfferRow[];
  requestMap: Map<string, CustomerOfferRepairRequest>;
  appointmentMap: Map<string, CustomerRepairAppointment>;
  workshopProfileMap: Map<string, WorkshopProfileRow>;
}): CustomerOfferItem[] {
  const { offerRows, requestMap, appointmentMap, workshopProfileMap } = input;

  return offerRows.flatMap((offer) => {
    const matchingRequest = requestMap.get(offer.request_id);

    if (!matchingRequest) {
      return [];
    }

    const workshopProfile = workshopProfileMap.get(offer.workshop_user_id);

    const item: CustomerOfferItem = {
      offer: {
        id: offer.id,
        requestId: offer.request_id,
        workshopUserId: offer.workshop_user_id,

        workshopSlug: workshopProfile?.workshop_slug || null,

        price: String(offer.price),
        days: String(offer.days),
        message: offer.message || "",

        workshopName:
          workshopProfile?.workshop_name || offer.workshop_name || "Service",

        createdAt: offer.created_at,
        status: offer.status || undefined,

        workshopLogoUrl: workshopProfile?.workshop_logo_url || null,

        availableDate: offer.available_date || null,

        availableTime: offer.available_time || null,
      },

      request: matchingRequest,

      appointment: appointmentMap.get(offer.id) || null,
    };

    return [item];
  });
}

export async function loadCustomerOffers(
  userId: string,
): Promise<LoadCustomerOffersResult> {
  const requestRows = await getOwnRepairRequests(userId);

  const activeRequests = requestRows.filter((request) => {
    const status = request.status || "open";

    return status !== "completed";
  });

  const requestIds = activeRequests.map((request) => request.id);

  if (requestIds.length === 0) {
    return {
      items: [],
      markedOffersAsRead: false,
    };
  }

  const offerRows = await loadPendingOfferRows(requestIds);

  if (offerRows.length === 0) {
    return {
      items: [],
      markedOffersAsRead: false,
    };
  }

  const offerIds = offerRows.map((offer) => offer.id);

  const workshopUserIds = Array.from(
    new Set(offerRows.map((offer) => offer.workshop_user_id).filter(Boolean)),
  );

  /*
   * Aceste trei operații sunt independente,
   * deci le rulăm în paralel.
   */
  const [appointmentMap, workshopProfileMap, markedOffersAsRead] =
    await Promise.all([
      loadAppointmentMap(offerIds),

      loadWorkshopProfileMap(workshopUserIds),

      markOfferRowsAsRead(offerRows),
    ]);

  const requestMap = createRequestMap(activeRequests);

  const items = buildCustomerOfferItems({
    offerRows,
    requestMap,
    appointmentMap,
    workshopProfileMap,
  });

  return {
    items,
    markedOffersAsRead,
  };
}
