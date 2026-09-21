import { supabase } from "@/lib/supabase/client";
import type {
  RepairRequestImage,
  RepairServiceDetails,
  StructuredServiceDetails,
} from "@/lib/supabase/repair-requests";
import type {
  MechanicalServiceDetails,
} from "@/lib/mechanical/mechanical-service-details";
import type { MechanicalCategoryId } from "@/lib/mechanical/mechanical-categories";
import type { RepairServiceType } from "@/lib/repair-requests/service-types";
import type { TowingServiceDetailsV1 } from "@/lib/towing/towing-service-details";
import type { TowingRoutePaths } from "@/lib/towing/towing-route";
import type { TowingScheduleType } from "@/lib/supabase/repair-requests";
import { formatLicensePlateForDb } from "@/lib/utils/licensePlate";
import {
  prepareImageForUpload,
  type PreparedImage,
} from "@/lib/images/prepare-image-for-upload";
import { uploadPreparedRepairImages } from "@/lib/supabase/repair-request-images";
import type {
  GeoLocation,
  RepairRequestDiscoveryLocation,
} from "@/lib/geo/geo-location";

export const REPAIR_REQUEST_EDIT_BLOCKED_ERROR_CODE = "PT409";

export function isRepairRequestEditBlockedError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === REPAIR_REQUEST_EDIT_BLOCKED_ERROR_CODE
  );
}

export type EditableRepairImage = Omit<RepairRequestImage, "name"> & {
  name?: string;
};

export type EditableRepairRequest = {
  id: string;
  user_id: string;
  car_brand: string;
  car_model: string;
  car_year: string;
  city: string;
  license_plate: string | null;
  damage_type: string;
  service_details: RepairServiceDetails | null;
  service_type: RepairServiceType | null;
  description: string | null;
  images: EditableRepairImage[] | null;
  status: string;
  accepted_offer_id: string | null;
  pickup_lat: number | null;
  pickup_lng: number | null;
  destination_lat: number | null;
  destination_lng: number | null;
  route_distance_meters: number | null;
  route_duration_seconds: number | null;
  route_paths: TowingRoutePaths | null;
  towing_schedule_type: TowingScheduleType | null;
  towing_requested_at: string | null;
  towing_requested_timezone: string | null;
};

export type LoadedEditableRepairRequest = {
  request: EditableRepairRequest;
  offersCount: number;
};

function logPreparedImage(preparedImage: PreparedImage) {
  if (process.env.NODE_ENV !== "development") return;

  const formatSize = (bytes: number) =>
    `${(bytes / (1024 * 1024)).toFixed(2)} MB`;

  console.info(
    `[IMAGE-PREP]\noriginal: ${preparedImage.originalWidth}x${preparedImage.originalHeight} / ${formatSize(preparedImage.originalSize)}\nfinal: ${preparedImage.width}x${preparedImage.height} / ${formatSize(preparedImage.finalSize)}\ntargetSizeMet: ${preparedImage.targetSizeMet}\ncontext: edit-request`,
  );
}

type UpdateEditableRepairRequestBase = {
  requestId: string;
  userId: string;
  licensePlate: string;
  description: string;
  images: EditableRepairImage[];
  locationChange?: GeoLocation;
};

export type UpdateEditableRepairRequestInput =
  | (UpdateEditableRepairRequestBase & {
      serviceType: "bodywork";
      serviceDetails: StructuredServiceDetails;
    })
  | (UpdateEditableRepairRequestBase & {
      serviceType: "mechanical";
      serviceDetails: MechanicalServiceDetails;
      damageType: MechanicalCategoryId;
    })
  | {
      serviceType: "wheels";
      requestId: string;
      userId: string;
      serviceDetails: RepairServiceDetails | null;
      description: string;
      images: EditableRepairImage[];
      locationChange?: GeoLocation;
    }
  | {
      serviceType: "towing";
      requestId: string;
      userId: string;
      carBrand: string;
      carModel: string;
      carYear: string;
      licensePlate: string;
      city: string;
      serviceDetails: TowingServiceDetailsV1;
      pickupLat: number | null;
      pickupLng: number | null;
      discoveryLocation: RepairRequestDiscoveryLocation | null;
      destinationLat: number | null;
      destinationLng: number | null;
      routeDistanceMeters: number | null;
      routeDurationSeconds: number | null;
      routePaths: TowingRoutePaths | null;
      towingScheduleType: TowingScheduleType;
      towingRequestedAt: string | null;
      towingRequestedTimezone: string | null;
      description: string;
      images: EditableRepairImage[];
    };

export async function getEditableRepairRequest(
  requestId: string,
  userId: string,
): Promise<LoadedEditableRepairRequest | null> {
  const { data: request, error: requestError } = await supabase
    .from("repair_requests")
    .select(
      "id, user_id, car_brand, car_model, car_year, city, license_plate, damage_type, service_details, service_type, description, images, status, accepted_offer_id, pickup_lat, pickup_lng, destination_lat, destination_lng, route_distance_meters, route_duration_seconds, route_paths, towing_schedule_type, towing_requested_at, towing_requested_timezone",
    )
    .eq("id", requestId)
    .eq("user_id", userId)
    .maybeSingle<EditableRepairRequest>();

  if (requestError) {
    throw requestError;
  }

  if (!request) {
    return null;
  }

  const { count, error: offersError } = await supabase
    .from("repair_offers")
    .select("id", {
      count: "exact",
      head: true,
    })
    .eq("request_id", requestId);

  if (offersError) {
    throw offersError;
  }

  return {
    request,
    offersCount: count ?? 0,
  };
}

export async function uploadEditableRepairImages(
  files: File[],
  userId: string,
  existingImages: EditableRepairImage[] = [],
): Promise<EditableRepairImage[]> {
  const preparedImages: Array<{
    originalName: string;
    preparedImage: PreparedImage;
  }> = [];

  // Prepare every new file before uploading any of them.
  for (const file of files) {
    const preparedImage = await prepareImageForUpload(file, {
      preset: "request",
    });

    logPreparedImage(preparedImage);
    preparedImages.push({
      originalName: file.name,
      preparedImage,
    });
  }

  return uploadPreparedRepairImages(preparedImages, userId, existingImages);
}

export async function updateEditableRepairRequest(
  input: UpdateEditableRepairRequestInput,
): Promise<void> {
  if (input.serviceType === "towing") {
    const { data, error } = await supabase.rpc(
      "update_towing_repair_request_with_discovery_location",
      {
        p_request_id: input.requestId,
        p_update: {
        car_brand: input.carBrand,
        car_model: input.carModel,
        car_year: input.carYear,
        license_plate: formatLicensePlateForDb(input.licensePlate),
        city: input.city,
        service_details: input.serviceDetails,
        pickup_lat: input.pickupLat,
        pickup_lng: input.pickupLng,
        destination_lat: input.destinationLat,
        destination_lng: input.destinationLng,
        route_distance_meters: input.routeDistanceMeters,
        route_duration_seconds: input.routeDurationSeconds,
        route_paths: input.routePaths,
        towing_schedule_type: input.towingScheduleType,
        towing_requested_at: input.towingRequestedAt,
        towing_requested_timezone: input.towingRequestedTimezone,
        description: input.description,
        images: input.images,
        },
        p_discovery: input.discoveryLocation
          ? {
              locality: input.discoveryLocation.locality,
              postal_code: input.discoveryLocation.postalCode,
              country_code: input.discoveryLocation.countryCode,
              lat: input.discoveryLocation.lat,
              lng: input.discoveryLocation.lng,
              source: input.discoveryLocation.source,
            }
          : null,
      },
    );

    if (error) throw error;
    if (!data) throw new Error("Cererea nu mai poate fi actualizată.");
    return;
  }

  if (input.locationChange) {
    const location = input.locationChange;
    const pUpdate = {
      service_type: input.serviceType,
      city: location.locality,
      ...(input.serviceDetails === null
        ? {}
        : { service_details: input.serviceDetails }),
      description: input.description,
      images: input.images,
      ...(input.serviceType === "wheels"
        ? {}
        : {
            license_plate: formatLicensePlateForDb(input.licensePlate),
            ...(input.serviceType === "mechanical"
              ? { damage_type: input.damageType }
              : {}),
          }),
    };
    const { data, error } = await supabase.rpc(
      "update_repair_request_with_discovery_location",
      {
        p_request_id: input.requestId,
        p_update: pUpdate,
        p_discovery: {
          locality: location.locality,
          postal_code: location.postalCode,
          country_code: location.countryCode,
          lat: location.lat,
          lng: location.lng,
          source: "locality",
        },
      },
    );

    if (error) throw error;
    if (!data) throw new Error("Cererea nu mai poate fi actualizată.");
    return;
  }

  if (input.serviceType === "wheels") {
    const { data, error } = await supabase
      .from("repair_requests")
      .update({
        service_details: input.serviceDetails,
        description: input.description,
        images: input.images,
      })
      .eq("id", input.requestId)
      .eq("user_id", input.userId)
      .eq("status", "open")
      .is("accepted_offer_id", null)
      .select("id")
      .maybeSingle<{ id: string }>();

    if (error) {
      throw error;
    }

    if (!data?.id) {
      throw new Error("Cererea nu mai poate fi actualizată.");
    }

    return;
  }

  const { data, error } = await supabase
    .from("repair_requests")
    .update({
      license_plate: formatLicensePlateForDb(input.licensePlate),
      service_details: input.serviceDetails,
      description: input.description,
      images: input.images,
      ...(input.serviceType === "mechanical"
        ? { damage_type: input.damageType }
        : {}),
    })
    .eq("id", input.requestId)
    .eq("user_id", input.userId)
    .eq("status", "open")
    .is("accepted_offer_id", null)
    .select("id")
    .maybeSingle<{ id: string }>();

  if (error) {
    throw error;
  }

  if (!data?.id) {
    throw new Error("Cererea nu mai poate fi actualizată.");
  }
}

export async function deleteEditableRepairRequest(input: {
  requestId: string;
  userId: string;
  hasOffers: boolean;
}): Promise<"closed" | "deleted"> {
  if (input.hasOffers) {
    const { error } = await supabase.rpc("close_repair_request", {
      p_request_id: input.requestId,
    });

    if (error) {
      throw error;
    }

    return "closed";
  }

  const { error } = await supabase
    .from("repair_requests")
    .delete()
    .eq("id", input.requestId)
    .eq("user_id", input.userId)
    .eq("status", "open");

  if (error) {
    throw error;
  }

  return "deleted";
}
