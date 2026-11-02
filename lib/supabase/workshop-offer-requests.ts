import { getWorkshopRequestDetail, type WorkshopRequestDetail } from "./workshop-request-detail";

// One read per distinct request per refresh. No persistent authorization cache:
// a later refresh must observe revoked access as well as changed request data.
export async function loadWorkshopOfferRequests(
  requestIds: string[],
  isCancelled: () => boolean = () => false,
): Promise<Map<string, WorkshopRequestDetail | null>> {
  const ids = [...new Set(requestIds.filter(Boolean))];
  const results = new Map<string, WorkshopRequestDetail | null>();
  let next = 0;
  async function worker() {
    while (!isCancelled() && next < ids.length) {
      const id = ids[next++];
      try {
        results.set(id, await getWorkshopRequestDetail(id));
      } catch {
        // Absence, denied access and failed validation have the same neutral UI.
        results.set(id, null);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, ids.length) }, worker));
  return results;
}
