import type { PreparedImage } from "@/lib/images/prepare-image-for-upload";
import { supabase } from "@/lib/supabase/client";
import type { RepairRequestImage } from "@/lib/supabase/repair-requests";

export const REPAIR_IMAGE_FINGERPRINT_VERSION = "sha256-prepared-v1";

export type PreparedRepairImageUpload = {
  originalName: string;
  preparedImage: PreparedImage;
};

type RepairImageUploadReservation = {
  object_path: string;
  upload_lease_id: string;
  upload_lease_expires_at: string;
};

async function fingerprintPreparedImage(file: File): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());

  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function firstReservation(
  value: RepairImageUploadReservation[] | RepairImageUploadReservation | null,
): RepairImageUploadReservation | null {
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

export async function uploadPreparedRepairImages(
  preparedImages: PreparedRepairImageUpload[],
  userId: string,
  existingImages: Array<
    Pick<RepairRequestImage, "fingerprint" | "fingerprintVersion">
  > = [],
): Promise<RepairRequestImage[]> {
  const knownFingerprints = new Set(
    existingImages.flatMap((image) =>
      image.fingerprint &&
      image.fingerprintVersion === REPAIR_IMAGE_FINGERPRINT_VERSION
        ? [image.fingerprint]
        : [],
    ),
  );
  const uploadedImages: RepairRequestImage[] = [];

  try {
    for (const { originalName, preparedImage } of preparedImages) {
      const fingerprint = await fingerprintPreparedImage(preparedImage.file);

      if (knownFingerprints.has(fingerprint)) continue;
      knownFingerprints.add(fingerprint);

      const { data: reservationData, error: reservationError } =
        await supabase.rpc("reserve_repair_image_upload", {
          p_file_extension: preparedImage.extension,
        });
      if (reservationError) throw reservationError;

      const reservation = firstReservation(
        reservationData as
          | RepairImageUploadReservation[]
          | RepairImageUploadReservation
          | null,
      );
      if (!reservation) throw new Error("Rezervarea imaginii nu a fost creată.");
      if (!reservation.object_path.startsWith(`${userId}/`)) {
        throw new Error("Rezervarea imaginii nu aparține utilizatorului curent.");
      }

      const path = reservation.object_path;
      try {
        const { error: uploadError } = await supabase.storage
          .from("repair-images")
          .upload(path, preparedImage.file, {
            contentType: preparedImage.contentType,
          });
        if (uploadError) throw uploadError;

        const { error: confirmationError } = await supabase.rpc(
          "confirm_repair_image_upload",
          {
            p_object_path: path,
            p_upload_lease_id: reservation.upload_lease_id,
          },
        );
        if (confirmationError) throw confirmationError;
      } catch (error) {
        const { error: abandonError } = await supabase.rpc(
          "abandon_repair_image_upload",
          {
            p_object_path: path,
            p_upload_lease_id: reservation.upload_lease_id,
          },
        );
        if (abandonError && process.env.NODE_ENV === "development") {
          console.warn("Repair image abandonment could not be recorded.", abandonError);
        }
        throw error;
      }

      const { data } = supabase.storage.from("repair-images").getPublicUrl(path);

      uploadedImages.push({
        name: originalName,
        url: data.publicUrl,
        path,
        fingerprint,
        fingerprintVersion: REPAIR_IMAGE_FINGERPRINT_VERSION,
      });
    }
  } catch (error) {
    // Confirmed but unattached uploads remain registered and are cleaned only
    // after the server-side safety window.
    throw error;
  }

  return uploadedImages;
}
