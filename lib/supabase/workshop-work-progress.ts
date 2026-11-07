import { supabase } from "@/lib/supabase/client";

type LatestWorkProgress = { request_id: string; status: string };

export async function getWorkshopLatestWorkProgress(requestId: string): Promise<LatestWorkProgress | null> {
  const invalid = () => new Error("Stadiul lucrării nu a putut fi încărcat.");
  if (typeof requestId !== "string"
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestId)) {
    throw invalid();
  }
  const { data, error } = await supabase.rpc("get_workshop_latest_work_progress", {
    p_request_id: requestId,
  });
  if (error) throw error;
  if (!Array.isArray(data)) throw invalid();
  if (data.length === 0) return null;
  const row: unknown = data[0];
  if (data.length !== 1 || !row || typeof row !== "object" || Array.isArray(row)
    || !("request_id" in row) || row.request_id !== requestId.toLowerCase()
    || !("status" in row) || typeof row.status !== "string" || !row.status.trim()) {
    throw invalid();
  }
  // Preserve the stored stage; the existing page validates category compatibility.
  return { request_id: row.request_id, status: row.status };
}
