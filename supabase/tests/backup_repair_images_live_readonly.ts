import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  chmod,
  mkdir,
  readFile,
  rename,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const LIVE_PROJECT_REF = "ouoiykudvcoqbkybkqvs";
const TEST_PROJECT_REF = "bstjobvvxxfqqwyjoimx";
const LIVE_SUPABASE_URL = `https://${LIVE_PROJECT_REF}.supabase.co`;
const BUCKET = "repair-images";
const PAGE_SIZE = 1000;

type InventoryBaseline = {
  objectCount: number;
  totalBytes: number;
};

type RemoteObject = {
  path: string;
  id: string;
  updatedAt: string;
  size: number;
};

type ManifestRecord = RemoteObject & {
  sha256: string;
};

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Required server-side variable ${name} is missing.`);
  return value;
}

function parseArguments(): { backupDirectory: string; inventoryFile: string } {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== "--backup-dir") {
    throw new Error(
      "Usage: node --experimental-strip-types backup_repair_images_live_readonly.ts --backup-dir <absolute-path>",
    );
  }

  const backupDirectory = path.resolve(args[1]);
  if (!path.isAbsolute(args[1])) {
    throw new Error("The backup directory argument must be an absolute path.");
  }

  return {
    backupDirectory,
    inventoryFile: path.join(backupDirectory, "repair-images-inventory.csv"),
  };
}

function parseCsv(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (quoted) {
      if (character === '"' && input[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
    } else if (character === '"') {
      quoted = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n") {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }

  if (quoted) throw new Error("The inventory CSV contains an unterminated field.");
  if (field !== "" || row.length > 0) {
    row.push(field.replace(/\r$/, ""));
    rows.push(row);
  }

  return rows;
}

function unsignedInteger(value: string | undefined, field: string): number {
  if (!value || !/^(0|[1-9][0-9]*)$/.test(value)) {
    throw new Error(`Inventory field ${field} is not an unsigned integer.`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`Inventory field ${field} exceeds JavaScript safe integers.`);
  }
  return parsed;
}

async function readInventoryBaseline(file: string): Promise<InventoryBaseline> {
  const records = parseCsv(await readFile(file, "utf8"));
  if (records.length !== 2) {
    throw new Error("The inventory CSV must contain one header and one data row.");
  }

  const [headers, values] = records;
  if (headers.length !== values.length || new Set(headers).size !== headers.length) {
    throw new Error("The inventory CSV structure is invalid.");
  }
  const row = Object.fromEntries(headers.map((header, index) => [header, values[index]]));

  assert.equal(row.inventory_status, "LIVE_INVENTORY_READY");
  assert.equal(unsignedInteger(row.repair_images_bucket_count, "repair_images_bucket_count"), 1);
  assert.equal(
    unsignedInteger(row.objects_without_numeric_size, "objects_without_numeric_size"),
    0,
    "Every Storage object must have a numeric size before backup.",
  );

  return {
    objectCount: unsignedInteger(row.storage_object_count, "storage_object_count"),
    totalBytes: unsignedInteger(row.storage_total_bytes, "storage_total_bytes"),
  };
}

function decodeJwtClaims(key: string): Record<string, unknown> | null {
  const parts = key.split(".");
  if (parts.length !== 3) return null;
  try {
    return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as Record<
      string,
      unknown
    >;
  } catch {
    throw new Error("The configured service-role JWT cannot be decoded.");
  }
}

function validateServerConfiguration(serviceRoleKey: string): void {
  assert.notEqual(LIVE_PROJECT_REF, TEST_PROJECT_REF);
  assert.equal(requiredEnvironment("SUPABASE_URL"), LIVE_SUPABASE_URL);
  assert.equal(
    requiredEnvironment("REPAIR_IMAGE_LIVE_SERVICE_ROLE_KEY_CONFIRMED"),
    LIVE_PROJECT_REF,
    "Manual service-role provenance confirmation is missing.",
  );

  if (serviceRoleKey.startsWith("sb_secret_")) return;
  if (serviceRoleKey.startsWith("sb_publishable_")) {
    throw new Error("A publishable Supabase key cannot be used for this backup.");
  }

  const claims = decodeJwtClaims(serviceRoleKey);
  if (!claims || claims.role !== "service_role") {
    throw new Error("The configured JWT does not have the service_role claim.");
  }
  if (claims.ref === TEST_PROJECT_REF) {
    throw new Error("The configured key explicitly belongs to the TEST project.");
  }
  if (claims.ref !== undefined && claims.ref !== LIVE_PROJECT_REF) {
    throw new Error("The configured key belongs to an unapproved project.");
  }
}

function safeObjectPath(objectPath: string): void {
  if (
    objectPath === "" ||
    objectPath.startsWith("/") ||
    objectPath.includes("\\") ||
    objectPath.includes("\0") ||
    objectPath.split("/").some((part) => part === "" || part === "." || part === "..")
  ) {
    throw new Error("Storage contains an object path unsafe for local extraction.");
  }
}

function metadataSize(metadata: Record<string, unknown> | null): number {
  const value = metadata?.size;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error("Storage list returned an object without a valid numeric size.");
  }
  return parsed;
}

async function listAllObjects(client: SupabaseClient): Promise<RemoteObject[]> {
  const bucket = client.storage.from(BUCKET);
  const directories = [""];
  const visitedDirectories = new Set<string>();
  const objects = new Map<string, RemoteObject>();

  while (directories.length > 0) {
    const prefix = directories.shift() ?? "";
    if (visitedDirectories.has(prefix)) continue;
    visitedDirectories.add(prefix);

    for (let offset = 0; ; offset += PAGE_SIZE) {
      const { data, error } = await bucket.list(prefix, {
        limit: PAGE_SIZE,
        offset,
        sortBy: { column: "name", order: "asc" },
      });
      if (error) throw new Error(`Storage list() failed: ${error.message}`);
      if (!data) throw new Error("Storage list() returned no result.");

      for (const entry of data) {
        const objectPath = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
        safeObjectPath(objectPath);
        if (entry.id === null) {
          directories.push(objectPath);
          continue;
        }
        if (!entry.updated_at) {
          throw new Error("Storage list() returned a file without updated_at.");
        }
        if (objects.has(objectPath)) {
          throw new Error("Storage list() returned a duplicate object path.");
        }
        objects.set(objectPath, {
          path: objectPath,
          id: entry.id,
          updatedAt: entry.updated_at,
          size: metadataSize(entry.metadata),
        });
      }

      if (data.length < PAGE_SIZE) break;
    }
  }

  return [...objects.values()].sort((left, right) =>
    left.path.localeCompare(right.path, "en"),
  );
}

function snapshotHash(objects: RemoteObject[]): string {
  return createHash("sha256")
    .update(objects.map((object) => JSON.stringify(object)).join("\n"))
    .digest("hex");
}

function totalSize(objects: RemoteObject[]): number {
  return objects.reduce((total, object) => total + object.size, 0);
}

function safeError(error: unknown, secret: string): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replaceAll(secret, "[REDACTED]");
}

async function main(): Promise<void> {
  let stage = "local preflight";
  const { backupDirectory, inventoryFile } = parseArguments();
  const destination = path.join(backupDirectory, "storage", BUCKET);
  const staging = path.join(
    backupDirectory,
    "storage",
    `.${BUCKET}.partial-${process.pid}`,
  );
  const serviceRoleKey = requiredEnvironment("SUPABASE_SERVICE_ROLE_KEY");

  try {
    validateServerConfiguration(serviceRoleKey);
    const backupStat = await stat(backupDirectory);
    assert.ok(backupStat.isDirectory(), "The approved backup directory is missing.");
    await stat(inventoryFile);
    const baseline = await readInventoryBaseline(inventoryFile);

    await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
    try {
      await stat(destination);
      throw new Error("The final Storage backup directory already exists.");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    await mkdir(staging, { mode: 0o700 });
    await chmod(staging, 0o700);

    const client = createClient(LIVE_SUPABASE_URL, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    stage = "initial Storage list()";
    const initialObjects = await listAllObjects(client);
    assert.equal(initialObjects.length, baseline.objectCount, "Storage object count drifted.");
    assert.equal(totalSize(initialObjects), baseline.totalBytes, "Storage byte total drifted.");

    stage = "Storage download()";
    const manifest: ManifestRecord[] = [];
    for (const remoteObject of initialObjects) {
      const { data, error } = await client.storage.from(BUCKET).download(
        remoteObject.path,
        { cacheNonce: `live-backup-${Date.now()}-${manifest.length}` },
        { cache: "no-store" },
      );
      if (error) throw new Error(`Storage download() failed: ${error.message}`);
      if (!data) throw new Error("Storage download() returned no file data.");

      const bytes = Buffer.from(await data.arrayBuffer());
      assert.equal(bytes.length, remoteObject.size, "Downloaded object size mismatch.");
      const localFile = path.resolve(staging, remoteObject.path);
      const expectedPrefix = `${path.resolve(staging)}${path.sep}`;
      if (!localFile.startsWith(expectedPrefix)) {
        throw new Error("Storage object path escaped the local backup directory.");
      }
      await mkdir(path.dirname(localFile), { recursive: true, mode: 0o700 });
      await writeFile(localFile, bytes, { flag: "wx", mode: 0o600 });
      manifest.push({
        ...remoteObject,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      });
    }

    assert.equal(manifest.length, baseline.objectCount);
    assert.equal(
      manifest.reduce((total, record) => total + record.size, 0),
      baseline.totalBytes,
    );

    stage = "final Storage list()";
    const finalObjects = await listAllObjects(client);
    assert.equal(
      snapshotHash(finalObjects),
      snapshotHash(initialObjects),
      "Storage changed while the backup was being downloaded.",
    );

    stage = "local manifest finalization";
    const manifestText = `${manifest.map((record) => JSON.stringify(record)).join("\n")}\n`;
    const manifestHash = createHash("sha256").update(manifestText).digest("hex");
    await writeFile(path.join(staging, "MANIFEST.jsonl"), manifestText, {
      flag: "wx",
      mode: 0o600,
    });
    await writeFile(
      path.join(staging, "SUMMARY.json"),
      `${JSON.stringify(
        {
          projectRef: LIVE_PROJECT_REF,
          bucket: BUCKET,
          objectCount: manifest.length,
          totalBytes: baseline.totalBytes,
          storageSnapshotSha256: snapshotHash(initialObjects),
          manifestSha256: manifestHash,
        },
        null,
        2,
      )}\n`,
      { flag: "wx", mode: 0o600 },
    );
    await writeFile(
      path.join(staging, "MANIFEST.sha256"),
      `${manifestHash}  MANIFEST.jsonl\n`,
      { flag: "wx", mode: 0o600 },
    );

    await rename(staging, destination);
    console.log(
      `LIVE Storage backup PASS: ${manifest.length} objects, ${baseline.totalBytes} bytes.`,
    );
    console.log(`Backup directory: ${destination}`);
  } catch (error) {
    throw new Error(
      `LIVE Storage backup failed at stage "${stage}": ${safeError(error, serviceRoleKey)}`,
    );
  }
}

await main();
