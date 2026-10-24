import type { PreparedImage } from "@/lib/images/prepare-image-for-upload";
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

type OperationResult<T> = {
  data: T;
  error: unknown | null;
};

export type RepairImageUploadDependencies = {
  reserve(fileExtension: PreparedImage["extension"]): PromiseLike<OperationResult<unknown>>;
  upload(
    objectPath: string,
    file: File,
    contentType: PreparedImage["contentType"],
  ): Promise<OperationResult<unknown>>;
  confirm(objectPath: string, uploadLeaseId: string): PromiseLike<OperationResult<unknown>>;
  abandon(objectPath: string, uploadLeaseId: string): PromiseLike<OperationResult<unknown>>;
  publicUrl(objectPath: string): string;
  fingerprint(file: File): Promise<string>;
  now(): number;
};

async function fingerprintPreparedImage(file: File): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());

  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function firstReservation(value: unknown): RepairImageUploadReservation | null {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (!candidate || typeof candidate !== "object") return null;

  const record = candidate as Record<string, unknown>;
  if (
    typeof record.object_path !== "string" ||
    !record.object_path ||
    typeof record.upload_lease_id !== "string" ||
    !record.upload_lease_id ||
    typeof record.upload_lease_expires_at !== "string" ||
    !record.upload_lease_expires_at
  ) {
    return null;
  }

  return {
    object_path: record.object_path,
    upload_lease_id: record.upload_lease_id,
    upload_lease_expires_at: record.upload_lease_expires_at,
  };
}

async function defaultDependencies(): Promise<RepairImageUploadDependencies> {
  const { supabase } = await import("@/lib/supabase/client");

  return {
    reserve: (fileExtension) =>
      supabase.rpc("reserve_repair_image_upload", {
        p_file_extension: fileExtension,
      }),
    upload: (objectPath, file, contentType) =>
      supabase.storage.from("repair-images").upload(objectPath, file, {
        contentType,
      }),
    confirm: (objectPath, uploadLeaseId) =>
      supabase.rpc("confirm_repair_image_upload", {
        p_object_path: objectPath,
        p_upload_lease_id: uploadLeaseId,
      }),
    abandon: (objectPath, uploadLeaseId) =>
      supabase.rpc("abandon_repair_image_upload", {
        p_object_path: objectPath,
        p_upload_lease_id: uploadLeaseId,
      }),
    publicUrl: (objectPath) =>
      supabase.storage.from("repair-images").getPublicUrl(objectPath).data
        .publicUrl,
    fingerprint: fingerprintPreparedImage,
    now: Date.now,
  };
}

/**
 * Compatibility shim for call sites that still attempt client-side cleanup.
 * Confirmed objects are retained for the trusted server-side safety window;
 * the browser must never delete Repair Image objects directly.
 */
export async function removeRepairImageUploads(paths: string[]): Promise<void> {
  void paths;
}

export async function removeRepairImageUploadsBestEffort(
  paths: string[],
): Promise<void> {
  await removeRepairImageUploads(paths);
}

export async function uploadPreparedRepairImages(
  preparedImages: PreparedRepairImageUpload[],
  userId: string,
  existingImages: Array<
    Pick<RepairRequestImage, "fingerprint" | "fingerprintVersion">
  > = [],
  suppliedDependencies?: RepairImageUploadDependencies,
): Promise<RepairRequestImage[]> {
  const dependencies = suppliedDependencies ?? (await defaultDependencies());
  const knownFingerprints = new Set(
    existingImages.flatMap((image) =>
      image.fingerprint &&
      image.fingerprintVersion === REPAIR_IMAGE_FINGERPRINT_VERSION
        ? [image.fingerprint]
        : [],
    ),
  );
  const uploadedImages: RepairRequestImage[] = [];

  for (const { originalName, preparedImage } of preparedImages) {
    const fingerprint = await dependencies.fingerprint(preparedImage.file);

    if (knownFingerprints.has(fingerprint)) continue;
    knownFingerprints.add(fingerprint);

    const reservationResult = await dependencies.reserve(
      preparedImage.extension,
    );
    if (reservationResult.error) throw reservationResult.error;

    const reservation = firstReservation(reservationResult.data);
    if (!reservation) {
      throw new Error("Rezervarea imaginii a returnat un rezultat invalid.");
    }
    if (!reservation.object_path.startsWith(`${userId}/`)) {
      throw new Error("Rezervarea imaginii nu aparține utilizatorului curent.");
    }

    const leaseExpiresAt = Date.parse(reservation.upload_lease_expires_at);
    if (
      !Number.isFinite(leaseExpiresAt) ||
      leaseExpiresAt <= dependencies.now()
    ) {
      const abandonment = await dependencies.abandon(
        reservation.object_path,
        reservation.upload_lease_id,
      );
      if (abandonment.error && process.env.NODE_ENV === "development") {
        console.warn("Repair image abandonment could not be recorded.");
      }
      throw new Error("Rezervarea imaginii a expirat înainte de upload.");
    }

    const path = reservation.object_path;
    try {
      const uploadResult = await dependencies.upload(
        path,
        preparedImage.file,
        preparedImage.contentType,
      );
      if (uploadResult.error) throw uploadResult.error;

      const confirmation = await dependencies.confirm(
        path,
        reservation.upload_lease_id,
      );
      if (confirmation.error) throw confirmation.error;
      if (confirmation.data !== "uploaded" && confirmation.data !== "attached") {
        throw new Error("Confirmarea imaginii a returnat un rezultat invalid.");
      }
    } catch (error) {
      const abandonment = await dependencies.abandon(
        path,
        reservation.upload_lease_id,
      );
      if (abandonment.error && process.env.NODE_ENV === "development") {
        console.warn("Repair image abandonment could not be recorded.");
      }
      throw error;
    }

    uploadedImages.push({
      name: originalName,
      url: dependencies.publicUrl(path),
      path,
      fingerprint,
      fingerprintVersion: REPAIR_IMAGE_FINGERPRINT_VERSION,
    });
  }

  return uploadedImages;
}
