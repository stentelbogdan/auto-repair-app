import { supabase } from "@/lib/supabase/client";
import type {
  RepairServiceDetails,
  StructuredServiceDetails,
} from "@/lib/supabase/repair-requests";
import type {
  MechanicalServiceDetails,
} from "@/lib/mechanical/mechanical-service-details";
import type { MechanicalCategoryId } from "@/lib/mechanical/mechanical-categories";
import { formatLicensePlateForDb } from "@/lib/utils/licensePlate";
import {
  prepareImageForUpload,
  type PreparedImage,
} from "@/lib/images/prepare-image-for-upload";

export type EditableRepairImage = {
  name?: string;
  url?: string;
  thumbUrl?: string;
  dataUrl?: string;
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
  service_type: "bodywork" | "mechanical" | null;
  description: string | null;
  images: EditableRepairImage[] | null;
  status: string;
  accepted_offer_id: string | null;
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
    });

export async function getEditableRepairRequest(
  requestId: string,
  userId: string,
): Promise<LoadedEditableRepairRequest | null> {
  const { data: request, error: requestError } = await supabase
    .from("repair_requests")
    .select(
      "id, user_id, car_brand, car_model, car_year, city, license_plate, damage_type, service_details, service_type, description, images, status, accepted_offer_id",
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

  const uploadedImages: EditableRepairImage[] = [];

  for (const { originalName, preparedImage } of preparedImages) {
    const fileName = `${userId}/${Date.now()}-${Math.random()
      .toString(36)
      .slice(2)}.${preparedImage.extension}`;

    const { error: uploadError } = await supabase.storage
      .from("repair-images")
      .upload(fileName, preparedImage.file, {
        contentType: preparedImage.contentType,
      });

    if (uploadError) {
      throw uploadError;
    }

    const { data: publicUrlData } = supabase.storage
      .from("repair-images")
      .getPublicUrl(fileName);

    uploadedImages.push({
      name: originalName,
      url: publicUrlData.publicUrl,
    });
  }

  return uploadedImages;
}

export async function updateEditableRepairRequest(
  input: UpdateEditableRepairRequestInput,
): Promise<void> {
  const { error } = await supabase
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
    .eq("user_id", input.userId);

  if (error) {
    throw error;
  }
}

export async function deleteEditableRepairRequest(input: {
  requestId: string;
  userId: string;
  hasOffers: boolean;
}): Promise<"closed" | "deleted"> {
  if (input.hasOffers) {
    const { error } = await supabase
      .from("repair_requests")
      .update({
        status: "closed",
      })
      .eq("id", input.requestId)
      .eq("user_id", input.userId)
      .eq("status", "open");

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
