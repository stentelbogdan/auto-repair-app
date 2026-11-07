import { supabase } from "@/lib/supabase/client";

export type WorkshopWorkProgressHistoryRow = {
  id: string;
  request_id: string;
  status: string | null;
  message: string | null;
  images: unknown;
  created_at: string;
};

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isJson(value: unknown): boolean {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJson);
  return typeof value === "object" && Object.values(value).every(isJson);
}

export async function getWorkshopWorkProgressHistory(requestId: string): Promise<WorkshopWorkProgressHistoryRow[]> {
  const invalid = () => new Error("Dosarul foto al lucrării nu a putut fi încărcat.");
  if (typeof requestId !== "string" || !uuid.test(requestId)) throw invalid();
  const { data, error } = await supabase.rpc("get_workshop_work_progress_history", {
    p_request_id: requestId,
  });
  if (error) throw error;
  if (!Array.isArray(data)) throw invalid();
  const seen = new Set<string>();
  return data.map((row: unknown) => {
    if (!row || typeof row !== "object" || Array.isArray(row)
      || !("id" in row) || typeof row.id !== "string" || !uuid.test(row.id)
      || !("request_id" in row) || row.request_id !== requestId.toLowerCase()
      || !("status" in row) || (row.status !== null && typeof row.status !== "string")
      || !("message" in row) || (row.message !== null && typeof row.message !== "string")
      || !("images" in row) || !isJson(row.images)
      || !("created_at" in row) || typeof row.created_at !== "string"
      || !/^\d{4}-\d{2}-\d{2}T/.test(row.created_at) || !Number.isFinite(Date.parse(row.created_at))
      || seen.has(row.id.toLowerCase())) throw invalid();
    seen.add(row.id.toLowerCase());
    // Preserve server order, legacy stages, message whitespace and stored JSON references.
    return { id: row.id, request_id: row.request_id, status: row.status,
      message: row.message, images: row.images, created_at: row.created_at };
  });
}
