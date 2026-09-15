import type { PreparedImage } from "@/lib/images/prepare-image-for-upload";
import { supabase } from "@/lib/supabase/client";
import type { RepairRequestImage } from "@/lib/supabase/repair-requests";

export const REPAIR_IMAGE_FINGERPRINT_VERSION = "sha256-prepared-v1";

export type PreparedRepairImageUpload = {
  originalName: string;
  preparedImage: PreparedImage;
};

async function fingerprintPreparedImage(file: File): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());

  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export async function removeRepairImageUploads(paths: string[]): Promise<void> {
  if (!paths.length) return;

  const { error } = await supabase.storage.from("repair-images").remove(paths);

  if (error) throw error;
}

export async function removeRepairImageUploadsBestEffort(
  paths: string[],
): Promise<void> {
  try {
    await removeRepairImageUploads(paths);
  } catch (cleanupError) {
    console.error("Repair image cleanup failed:", cleanupError);
  }
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

      const path = `${userId}/${crypto.randomUUID()}.${preparedImage.extension}`;
      const { error: uploadError } = await supabase.storage
        .from("repair-images")
        .upload(path, preparedImage.file, {
          contentType: preparedImage.contentType,
        });

      if (uploadError) throw uploadError;

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
    await removeRepairImageUploadsBestEffort(
      uploadedImages.flatMap((image) => (image.path ? [image.path] : [])),
    );
    throw error;
  }

  return uploadedImages;
}
