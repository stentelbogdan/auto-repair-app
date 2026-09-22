import type { RepairServiceType } from "@/lib/repair-requests/service-types";
import { supabase } from "@/lib/supabase/client";
import type { RepairRequestRow } from "@/lib/supabase/repair-requests";

export type WorkshopDiscoveryServiceType = Extract<
  RepairServiceType,
  "bodywork" | "mechanical" | "wheels" | "towing"
>;

export type WorkshopDiscoveryCursor = {
  createdAt: string;
  requestId: string;
};

export type WorkshopDiscoveryFeedItem = {
  requestId: string;
  requestData: RepairRequestRow;
  distanceKm: number | null;
  createdAt: string;
};

export type WorkshopDiscoveryFeedPage = {
  items: WorkshopDiscoveryFeedItem[];
  nextCursor: WorkshopDiscoveryCursor | null;
  hasMore: boolean;
};

export type WorkshopDiscoveryCounts = Record<
  WorkshopDiscoveryServiceType,
  number
>;

type WorkshopDiscoveryFeedRow = {
  request_id: unknown;
  request_data: unknown;
  distance_km: unknown;
  created_at: unknown;
};

type WorkshopDiscoveryCountRow = {
  service_type: unknown;
  request_count: unknown;
};

const SERVICE_TYPES: WorkshopDiscoveryServiceType[] = [
  "bodywork",
  "mechanical",
  "wheels",
  "towing",
];

function normalizeDistanceKm(value: unknown) {
  if (value === null) return null;

  const distance =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim() !== ""
        ? Number(value)
        : Number.NaN;

  return Number.isFinite(distance) ? distance : null;
}

function parseFeedRow(row: WorkshopDiscoveryFeedRow) {
  if (
    typeof row.request_id !== "string" ||
    typeof row.created_at !== "string" ||
    !row.request_data ||
    typeof row.request_data !== "object" ||
    Array.isArray(row.request_data)
  ) {
    throw new Error("Invalid workshop discovery feed response.");
  }

  const requestData = row.request_data as RepairRequestRow;
  if (requestData.id !== row.request_id) {
    throw new Error("Workshop discovery request ID mismatch.");
  }

  return {
    requestId: row.request_id,
    requestData,
    distanceKm: normalizeDistanceKm(row.distance_km),
    createdAt: row.created_at,
  } satisfies WorkshopDiscoveryFeedItem;
}

export async function fetchWorkshopDiscoveryFeed(input: {
  serviceType: WorkshopDiscoveryServiceType;
  pageSize?: number;
  cursor?: WorkshopDiscoveryCursor | null;
}): Promise<WorkshopDiscoveryFeedPage> {
  const pageSize = input.pageSize ?? 20;
  const { data, error } = await supabase.rpc("get_workshop_discovery_feed", {
    p_service_type: input.serviceType,
    p_page_size: pageSize + 1,
    p_cursor_created_at: input.cursor?.createdAt ?? null,
    p_cursor_id: input.cursor?.requestId ?? null,
    p_radius_override_mode: "default",
    p_radius_override_km: null,
  });

  if (error) throw error;

  const parsed = ((data ?? []) as WorkshopDiscoveryFeedRow[]).map(parseFeedRow);
  const items = parsed.slice(0, pageSize);
  const lastItem = items.at(-1);

  return {
    items,
    hasMore: parsed.length > pageSize,
    nextCursor: lastItem
      ? { createdAt: lastItem.createdAt, requestId: lastItem.requestId }
      : null,
  };
}

export async function fetchWorkshopDiscoveryCounts(): Promise<WorkshopDiscoveryCounts> {
  const counts: WorkshopDiscoveryCounts = {
    bodywork: 0,
    mechanical: 0,
    wheels: 0,
    towing: 0,
  };
  const { data, error } = await supabase.rpc("get_workshop_discovery_counts", {
    p_radius_override_mode: "default",
    p_radius_override_km: null,
  });

  if (error) throw error;

  for (const row of (data ?? []) as WorkshopDiscoveryCountRow[]) {
    if (
      typeof row.service_type !== "string" ||
      !SERVICE_TYPES.includes(row.service_type as WorkshopDiscoveryServiceType)
    ) {
      throw new Error("Invalid workshop discovery counts response.");
    }

    const count = Number(row.request_count);
    if (!Number.isFinite(count) || count < 0) {
      throw new Error("Invalid workshop discovery count.");
    }

    counts[row.service_type as WorkshopDiscoveryServiceType] = Math.floor(count);
  }

  return counts;
}
