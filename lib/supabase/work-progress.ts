import { supabase } from "@/lib/supabase/client";

type SaveWorkProgressUpdateInput = {
  requestId: string;
  senderId: string;
  status: string;
  message: string;
  images: string[];
};

export async function saveWorkProgressUpdate({
  requestId,
  senderId,
  status,
  message,
  images,
}: SaveWorkProgressUpdateInput) {
  const { error: insertError } = await supabase
    .from("work_progress_updates")
    .insert({
      request_id: requestId,
      sender_id: senderId,
      sender_role: "workshop",
      status,
      message,
      images,
    });

  if (insertError) {
    throw insertError;
  }

  const requestStatus =
    status === "Ready" || status === "Gata" ? "completed" : "in_progress";

  const { data: updatedRequest, error: requestUpdateError } = await supabase
    .from("repair_requests")
    .update({ status: requestStatus })
    .eq("id", requestId)
    .select("id, status")
    .maybeSingle();

  if (requestUpdateError) {
    throw requestUpdateError;
  }

  if (!updatedRequest) {
    throw new Error("Starea lucrării nu a putut fi actualizată.");
  }

  return updatedRequest;
}
