import { supabase } from "@/lib/supabase/client";

export type RepairRequestMetrics = {
  viewCount: number;
  offerCount: number;
};

type RepairRequestMetricsRow = {
  request_id: string;
  view_count: number | string | null;
  offer_count: number | string | null;
};

export async function getWorkshopRequestMetrics(
  requestIds: string[],
): Promise<Map<string, RepairRequestMetrics>> {
  const uniqueRequestIds = [...new Set(requestIds.filter(Boolean))];
  const metricsByRequestId = new Map<string, RepairRequestMetrics>(
    uniqueRequestIds.map((requestId) => [
      requestId,
      { viewCount: 0, offerCount: 0 },
    ]),
  );

  if (uniqueRequestIds.length === 0) {
    return metricsByRequestId;
  }

  const { data, error } = await supabase.rpc(
    "get_workshop_request_metrics",
    { p_request_ids: uniqueRequestIds },
  );

  if (error) {
    throw error;
  }

  ((data ?? []) as RepairRequestMetricsRow[]).forEach((row) => {
    metricsByRequestId.set(row.request_id, {
      viewCount: toSafeCount(row.view_count),
      offerCount: toSafeCount(row.offer_count),
    });
  });

  return metricsByRequestId;
}

function toSafeCount(value: number | string | null) {
  const count = Number(value ?? 0);
  return Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
}
