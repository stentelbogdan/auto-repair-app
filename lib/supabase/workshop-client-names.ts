import { supabase } from "@/lib/supabase/client";

type WorkshopRequestClientNameRow = {
  request_id: string;
  client_name: string | null;
};

export async function getWorkshopRequestClientNames(
  requestIds: string[],
): Promise<Map<string, string>> {
  const uniqueRequestIds = [...new Set(requestIds.filter(Boolean))];
  const namesByRequestId = new Map<string, string>(
    uniqueRequestIds.map((requestId) => [requestId, "Client"]),
  );

  if (uniqueRequestIds.length === 0) {
    return namesByRequestId;
  }

  const { data, error } = await supabase.rpc(
    "get_workshop_request_client_names",
    { p_request_ids: uniqueRequestIds },
  );

  if (error) {
    if (process.env.NODE_ENV === "development") {
      console.error("Failed to load workshop request client names:", error);
    }

    return namesByRequestId;
  }

  ((data ?? []) as WorkshopRequestClientNameRow[]).forEach((row) => {
    const clientName = row.client_name?.trim();
    namesByRequestId.set(row.request_id, clientName || "Client");
  });

  return namesByRequestId;
}
