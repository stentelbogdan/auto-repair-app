import { supabase } from "@/lib/supabase/client";

const recordedRequestIds = new Set<string>();
const pendingRequests = new Map<string, Promise<boolean>>();

export async function recordWorkshopRequestView(
  requestId: string,
): Promise<boolean> {
  const normalizedRequestId = requestId.trim();

  if (!normalizedRequestId || recordedRequestIds.has(normalizedRequestId)) {
    return false;
  }

  const pendingRequest = pendingRequests.get(normalizedRequestId);

  if (pendingRequest) {
    await pendingRequest;
    return false;
  }

  const request = persistWorkshopRequestView(normalizedRequestId);
  pendingRequests.set(normalizedRequestId, request);

  try {
    return await request;
  } finally {
    pendingRequests.delete(normalizedRequestId);
  }
}

async function persistWorkshopRequestView(requestId: string) {
  try {
    const { data, error } = await supabase.rpc("record_repair_request_view", {
      p_request_id: requestId,
    });

    if (error) {
      if (process.env.NODE_ENV === "development") {
        console.error("Failed to record repair request view.", error);
      }

      return false;
    }

    recordedRequestIds.add(requestId);
    return data === true;
  } catch (error) {
    if (process.env.NODE_ENV === "development") {
      console.error("Failed to record repair request view.", error);
    }

    return false;
  }
}
