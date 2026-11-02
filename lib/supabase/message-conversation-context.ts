import { supabase } from "@/lib/supabase/client";

export type MessageConversationContext = {
  request_id: string;
  offer_id: string | null;
  car_brand: string;
  car_model: string;
  city: string;
  status: string;
  images: { name?: string; url?: string; dataUrl?: string }[];
  request_type: string | null;
  target_workshop_id: string | null;
};

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const invalid = () => new Error("Contextul conversației nu este disponibil.");
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export async function getMessageConversationContext(
  requestId: string,
  offerId: string | null,
): Promise<MessageConversationContext | null> {
  if (requestId === "draft") return null;
  if (!uuid.test(requestId) || (offerId !== null && !uuid.test(offerId))) throw invalid();

  const { data, error } = await supabase.rpc("get_message_conversation_context", {
    p_request_id: requestId,
    p_offer_id: offerId,
  });
  if (error) throw invalid();
  if (!Array.isArray(data)) throw invalid();
  if (data.length === 0) return null;
  if (data.length !== 1 || !record(data[0]) || !record(data[0].request_data)) throw invalid();
  const row = data[0].request_data;
  if (row.request_id !== requestId || row.offer_id !== offerId ||
    typeof row.car_brand !== "string" || typeof row.car_model !== "string" ||
    typeof row.city !== "string" || typeof row.status !== "string" ||
    (row.request_type !== null && typeof row.request_type !== "string") ||
    (row.target_workshop_id !== null &&
      (typeof row.target_workshop_id !== "string" || !uuid.test(row.target_workshop_id))) ||
    (offerId === null && (row.request_type !== "direct_message" || row.target_workshop_id === null)) ||
    !Array.isArray(row.images)) throw invalid();

  const images = row.images.map((image: unknown) => {
    if (!record(image)) throw invalid();
    const result: MessageConversationContext["images"][number] = {};
    for (const key of ["name", "url", "dataUrl"] as const) {
      if (image[key] !== undefined) {
        if (typeof image[key] !== "string") throw invalid();
        result[key] = image[key];
      }
    }
    return result;
  });
  return {
    request_id: requestId, offer_id: offerId,
    car_brand: row.car_brand, car_model: row.car_model, city: row.city, status: row.status,
    images, request_type: row.request_type, target_workshop_id: row.target_workshop_id,
  };
}

// Context only: never changes message authentication, subscriptions or read-state.
// INITIAL_SESSION supplies the initial identity. Auth callbacks stay synchronous;
// defer the RPC until outside the auth lock, and invalidate old work on every event.
export function observeMessageConversationContext(
  requestId: string,
  offerId: string | null,
  publish: (context: MessageConversationContext | null) => void,
): () => void {
  if (requestId === "draft") return () => {};
  let stopped = false;
  let generation = 0;
  let scheduled: ReturnType<typeof setTimeout> | undefined;
  publish(null);
  const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
    if (stopped) return;
    const current = ++generation;
    clearTimeout(scheduled);
    publish(null);
    if (!session?.user.id) return;
    scheduled = setTimeout(() => {
      if (stopped || current !== generation) return;
      void getMessageConversationContext(requestId, offerId).then(
        context => { if (!stopped && current === generation) publish(context); },
        () => { if (!stopped && current === generation) publish(null); },
      );
    }, 0);
  });
  return () => {
    stopped = true;
    generation += 1;
    clearTimeout(scheduled);
    subscription.unsubscribe();
  };
}
