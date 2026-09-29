import { supabase } from "@/lib/supabase/client";

const CONVERSATION_PEER_BATCH_SIZE = 500;

type ConversationPeerRow = {
  request_id: string;
  offer_id: string | null;
  peer_id: string;
  peer_display_name: string;
  peer_workshop_name: string | null;
};

type PublicWorkshopSummaryRow = {
  workshop_id: string;
  workshop_name: string | null;
  workshop_slug: string | null;
  workshop_logo_url: string | null;
};

export type ConversationPeer = {
  requestId: string;
  offerId: string | null;
  peerId: string;
  peerDisplayName: string;
  peerWorkshopName: string | null;
};

export type PublicWorkshopSummary = {
  workshopId: string;
  workshopName: string | null;
  workshopSlug: string | null;
  workshopLogoUrl: string | null;
};

export function getConversationPeerKey(
  requestId: string,
  offerId: string | null,
) {
  return `${requestId}::${offerId ?? "direct"}`;
}

export async function loadConversationPeers({
  directRequestIds,
  offerIds,
}: {
  directRequestIds: string[];
  offerIds: string[];
}): Promise<Map<string, ConversationPeer>> {
  const conversations: Array<{
    requestId: string | null;
    offerId: string | null;
  }> = [...new Set(directRequestIds)].map((requestId) => ({
    requestId,
    offerId: null,
  }));

  conversations.push(
    ...[...new Set(offerIds)].map((offerId) => ({
      requestId: null,
      offerId,
    })),
  );

  if (conversations.length === 0) {
    return new Map();
  }

  const peerMap = new Map<string, ConversationPeer>();

  for (
    let index = 0;
    index < conversations.length;
    index += CONVERSATION_PEER_BATCH_SIZE
  ) {
    const batch = conversations.slice(
      index,
      index + CONVERSATION_PEER_BATCH_SIZE,
    );
    const { data, error } = await supabase.rpc(
      "get_message_conversation_peers",
      {
        p_direct_request_ids: batch.flatMap((conversation) =>
          conversation.requestId ? [conversation.requestId] : [],
        ),
        p_offer_ids: batch.flatMap((conversation) =>
          conversation.offerId ? [conversation.offerId] : [],
        ),
      },
    );

    if (error) {
      throw new Error("Failed to load conversation peers.", { cause: error });
    }

    const rows = (data ?? []) as ConversationPeerRow[];

    for (const row of rows) {
      const peer: ConversationPeer = {
        requestId: row.request_id,
        offerId: row.offer_id,
        peerId: row.peer_id,
        peerDisplayName: row.peer_display_name,
        peerWorkshopName: row.peer_workshop_name,
      };

      peerMap.set(getConversationPeerKey(peer.requestId, peer.offerId), peer);
    }
  }

  return peerMap;
}

export async function loadPublicWorkshopSummaries(
  workshopIds: string[],
): Promise<Map<string, PublicWorkshopSummary>> {
  if (workshopIds.length === 0) {
    return new Map();
  }

  const { data, error } = await supabase.rpc(
    "get_public_workshop_summaries",
    { p_workshop_ids: workshopIds },
  );

  if (error) {
    throw new Error("Failed to load public workshop summaries.", {
      cause: error,
    });
  }

  const rows = (data ?? []) as PublicWorkshopSummaryRow[];

  return new Map(
    rows.map((row) => [
      row.workshop_id,
      {
        workshopId: row.workshop_id,
        workshopName: row.workshop_name,
        workshopSlug: row.workshop_slug,
        workshopLogoUrl: row.workshop_logo_url,
      },
    ]),
  );
}
