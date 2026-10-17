import { handleRepairImageCleanupRequest } from "@/lib/supabase/repair-image-cleanup-route";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: Request) {
  return handleRepairImageCleanupRequest(request);
}
