import { supabase } from "@/lib/supabase/client";
import { normalizeProgressStatus } from "@/lib/work-progress/workflows";

type SaveWorkProgressUpdateInput = {
  requestId: string;
  senderId: string;
  status: string;
  message: string;
  images: string[];
};

export async function saveWorkProgressUpdate({
  requestId,
  status,
  message,
  images,
}: SaveWorkProgressUpdateInput) {
  const stage = typeof status === "string" ? normalizeProgressStatus(status) : null;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestId)
    || !stage || typeof message !== "string" || !Array.isArray(images)
    || !images.every(image => typeof image === "string" && image.trim().length > 0)) {
    throw new Error("Datele progresului sunt invalide.");
  }

  // senderId stays in the caller contract; only auth.uid() authorizes the write.
  const { data, error } = await supabase.rpc("save_work_progress_update", {
    p_request_id: requestId,
    p_status: stage,
    p_message: message,
    p_images: images,
  });
  if (error) throw error;

  const requestStatus = stage === "Ready" ? "completed" : "in_progress";
  const row: unknown = Array.isArray(data) && data.length === 1 ? data[0] : null;
  if (!row || typeof row !== "object" || !("id" in row) || !("status" in row)
    || row.id !== requestId.toLowerCase() || row.status !== requestStatus) {
    throw new Error("Starea lucrării nu a putut fi actualizată.");
  }

  // No follow-up SELECT: an unreadable response must not retry a committed save.
  return { id: row.id, status: row.status };
}
