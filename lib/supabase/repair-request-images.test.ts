import assert from "node:assert/strict";
import test from "node:test";
import type { PreparedImage } from "@/lib/images/prepare-image-for-upload";
import {
  REPAIR_IMAGE_FINGERPRINT_VERSION,
  removeRepairImageUploads,
  removeRepairImageUploadsBestEffort,
  uploadPreparedRepairImages,
  type PreparedRepairImageUpload,
  type RepairImageUploadDependencies,
  // Node's built-in TypeScript runner requires the source extension.
  // @ts-expect-error TS5097 is intentionally limited to this local test import.
} from "./repair-request-images.ts";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const PATH = `${USER_ID}/22222222-2222-4222-8222-222222222222.jpg`;
const LEASE_ID = "33333333-3333-4333-8333-333333333333";
const NOW = Date.parse("2026-10-24T12:00:00.000Z");

type TestOptions = {
  reserveData?: unknown;
  reserveError?: unknown;
  uploadError?: unknown;
  confirmData?: unknown;
  confirmError?: unknown;
  abandonError?: unknown;
  fingerprint?: string;
};

function prepared(name = "damage.jpg"): PreparedRepairImageUpload {
  const file = new File(["prepared-image"], name, { type: "image/jpeg" });
  return {
    originalName: name,
    preparedImage: {
      file,
      originalName: name,
      contentType: "image/jpeg",
      extension: "jpg",
      preset: "repairRequest",
      width: 100,
      height: 100,
      originalWidth: 100,
      originalHeight: 100,
      originalSize: file.size,
      finalSize: file.size,
      targetSizeMet: true,
    } as unknown as PreparedImage,
  };
}

function mockDependencies(options: TestOptions = {}) {
  const calls: Array<{ operation: string; args?: unknown[] }> = [];
  const dependencies: RepairImageUploadDependencies = {
    async reserve(extension) {
      calls.push({ operation: "reserve", args: [extension] });
      return {
        data:
          options.reserveData === undefined
            ? {
                object_path: PATH,
                upload_lease_id: LEASE_ID,
                upload_lease_expires_at: "2026-10-24T12:15:00.000Z",
              }
            : options.reserveData,
        error: options.reserveError ?? null,
      };
    },
    async upload(path, _file, contentType) {
      calls.push({ operation: "upload", args: [path, contentType] });
      return { data: {}, error: options.uploadError ?? null };
    },
    async confirm(path, leaseId) {
      calls.push({ operation: "confirm", args: [path, leaseId] });
      return {
        data: options.confirmData === undefined ? "uploaded" : options.confirmData,
        error: options.confirmError ?? null,
      };
    },
    async abandon(path, leaseId) {
      calls.push({ operation: "abandon", args: [path, leaseId] });
      return { data: "reserved", error: options.abandonError ?? null };
    },
    publicUrl(path) {
      calls.push({ operation: "publicUrl", args: [path] });
      return `https://example.invalid/storage/${path}`;
    },
    async fingerprint() {
      calls.push({ operation: "fingerprint" });
      return options.fingerprint ?? "a".repeat(64);
    },
    now: () => NOW,
  };
  return { dependencies, calls };
}

function operations(calls: Array<{ operation: string }>) {
  return calls.map((call) => call.operation);
}

test("reserves, uploads, confirms, and preserves image metadata", async () => {
  const { dependencies, calls } = mockDependencies();
  const result = await uploadPreparedRepairImages(
    [prepared()],
    USER_ID,
    [],
    dependencies,
  );

  assert.deepEqual(operations(calls), [
    "fingerprint",
    "reserve",
    "upload",
    "confirm",
    "publicUrl",
  ]);
  assert.deepEqual(result, [
    {
      name: "damage.jpg",
      url: `https://example.invalid/storage/${PATH}`,
      path: PATH,
      fingerprint: "a".repeat(64),
      fingerprintVersion: REPAIR_IMAGE_FINGERPRINT_VERSION,
    },
  ]);
});

test("a refused reservation stops before Storage", async () => {
  const denied = new Error("Authentication required");
  const { dependencies, calls } = mockDependencies({ reserveError: denied });
  await assert.rejects(
    uploadPreparedRepairImages([prepared()], USER_ID, [], dependencies),
    denied,
  );
  assert.deepEqual(operations(calls), ["fingerprint", "reserve"]);
});

test("an ambiguous reservation response fails closed", async () => {
  const { dependencies, calls } = mockDependencies({ reserveData: null });
  await assert.rejects(
    uploadPreparedRepairImages([prepared()], USER_ID, [], dependencies),
    /rezultat invalid/i,
  );
  assert.deepEqual(operations(calls), ["fingerprint", "reserve"]);
});

test("a reservation for another owner is rejected before Storage", async () => {
  const { dependencies, calls } = mockDependencies({
    reserveData: {
      object_path: "44444444-4444-4444-8444-444444444444/image.jpg",
      upload_lease_id: LEASE_ID,
      upload_lease_expires_at: "2026-10-24T12:15:00.000Z",
    },
  });
  await assert.rejects(
    uploadPreparedRepairImages([prepared()], USER_ID, [], dependencies),
    /nu aparține/i,
  );
  assert.deepEqual(operations(calls), ["fingerprint", "reserve"]);
});

test("an expired lease is abandoned and never uploaded", async () => {
  const { dependencies, calls } = mockDependencies({
    reserveData: {
      object_path: PATH,
      upload_lease_id: LEASE_ID,
      upload_lease_expires_at: "2026-10-24T11:59:59.000Z",
    },
  });
  await assert.rejects(
    uploadPreparedRepairImages([prepared()], USER_ID, [], dependencies),
    /a expirat/i,
  );
  assert.deepEqual(operations(calls), ["fingerprint", "reserve", "abandon"]);
});

test("a Storage failure records logical abandonment", async () => {
  const storageError = new Error("Storage unavailable");
  const { dependencies, calls } = mockDependencies({ uploadError: storageError });
  await assert.rejects(
    uploadPreparedRepairImages([prepared()], USER_ID, [], dependencies),
    storageError,
  );
  assert.deepEqual(operations(calls), [
    "fingerprint",
    "reserve",
    "upload",
    "abandon",
  ]);
});

test("a confirmation failure records logical abandonment", async () => {
  const confirmationError = new Error("Lease mismatch");
  const { dependencies, calls } = mockDependencies({
    confirmError: confirmationError,
  });
  await assert.rejects(
    uploadPreparedRepairImages([prepared()], USER_ID, [], dependencies),
    confirmationError,
  );
  assert.deepEqual(operations(calls), [
    "fingerprint",
    "reserve",
    "upload",
    "confirm",
    "abandon",
  ]);
});

test("an ambiguous confirmation response is never reported as success", async () => {
  const { dependencies, calls } = mockDependencies({ confirmData: null });
  await assert.rejects(
    uploadPreparedRepairImages([prepared()], USER_ID, [], dependencies),
    /rezultat invalid/i,
  );
  assert.deepEqual(operations(calls), [
    "fingerprint",
    "reserve",
    "upload",
    "confirm",
    "abandon",
  ]);
});

test("an abandonment failure cannot turn an upload failure into success", async () => {
  const storageError = new Error("Storage unavailable");
  const { dependencies, calls } = mockDependencies({
    uploadError: storageError,
    abandonError: new Error("Abandonment unavailable"),
  });
  await assert.rejects(
    uploadPreparedRepairImages([prepared()], USER_ID, [], dependencies),
    storageError,
  );
  assert.equal(operations(calls).includes("publicUrl"), false);
});

test("existing metadata and duplicate prepared files suppress uploads", async () => {
  const fingerprint = "b".repeat(64);
  const { dependencies, calls } = mockDependencies({ fingerprint });
  const result = await uploadPreparedRepairImages(
    [prepared("first.jpg"), prepared("second.jpg")],
    USER_ID,
    [
      {
        fingerprint,
        fingerprintVersion: REPAIR_IMAGE_FINGERPRINT_VERSION,
      },
    ],
    dependencies,
  );
  assert.deepEqual(result, []);
  assert.deepEqual(operations(calls), ["fingerprint", "fingerprint"]);
});

test("legacy cleanup exports never issue browser-side Storage deletion", async () => {
  await removeRepairImageUploads([PATH]);
  await removeRepairImageUploadsBestEffort([PATH]);
});
