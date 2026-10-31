// Browser-side auxiliary protocol only. No direct Supabase writes or Broadcast.
const ENDPOINT = "/api/repair-requests/images/notify-change";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type Session = { user: { id: string }; access_token: string } | null;
export type PreparedUploadNotification = { confirm(): Promise<void> };
export type PreparedRequestPhotoNotification = { confirm(requestId: unknown): Promise<void> };
type Dependencies = {
  enabled: boolean;
  supabaseUrl: string | undefined;
  projectRef: string | undefined;
  session(): PromiseLike<Session>;
  fetch: typeof fetch;
  timeoutMs?: number;
};

async function readTicket(response: Response, signal: AbortSignal): Promise<string | null> {
  if (!response.body) return null;
  const reader = response.body.getReader();
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener("abort", cancel, { once: true });
  if (signal.aborted) cancel();
  try {
    const decoder = new TextDecoder("utf-8", { fatal: true });
    let text = "", size = 0;
    while (!signal.aborted) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > 1024) return null;
      text += decoder.decode(part.value, { stream: true });
    }
    if (signal.aborted) return null;
    const value = JSON.parse(text + decoder.decode());
    return value && typeof value === "object" && !Array.isArray(value)
      && Object.keys(value).length === 2 && value.status === "prepared"
      && typeof value.ticket === "string" && UUID.test(value.ticket) ? value.ticket : null;
  } finally {
    signal.removeEventListener("abort", cancel);
    cancel();
  }
}

function createPhotoNotificationProtocol(deps: Dependencies) {
  // The server remains authoritative for Preview, flags, identity and SQL proof.
  const enabled = deps.enabled === true
    && deps.supabaseUrl === "https://bstjobvvxxfqqwyjoimx.supabase.co"
    && deps.projectRef === "bstjobvvxxfqqwyjoimx";
  const timeoutMs = Number.isFinite(deps.timeoutMs)
    ? Math.max(1, Math.min(deps.timeoutMs!, 5000)) : 2500;

  async function bounded<T>(work: (signal: AbortSignal) => Promise<T>): Promise<T | null> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        Promise.resolve().then(() => work(controller.signal)),
        new Promise<null>(resolve => {
          timer = setTimeout(() => { controller.abort(); resolve(null); }, timeoutMs);
        }),
      ]);
    } catch { return null; }
    finally { clearTimeout(timer); controller.abort(); }
  }

  async function request(body: object, ownerId: string, signal: AbortSignal) {
    const session = await deps.session();
    // A late getSession result must never start a request after the deadline.
    if (signal.aborted || session?.user.id !== ownerId || !session.access_token) return null;
    const response = await deps.fetch(ENDPOINT, {
      method: "POST", redirect: "error", cache: "no-store", credentials: "omit", signal,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify(body),
    });
    if (signal.aborted) { void response.body?.cancel().catch(() => {}); return null; }
    return response;
  }

  return {
    async prepare(body: { action: "prepare"; kind: "upload"; objectName: string }
      | { action: "prepare"; kind: "request_images"; requestId: string | null }, ownerId: string) {
      if (!enabled || !UUID.test(ownerId)) return null;
      const ticket = await bounded(async signal => {
        const response = await request(body, ownerId, signal);
        if (!response) return null;
        if (response.status !== 200) { void response.body?.cancel().catch(() => {}); return null; }
        return readTicket(response, signal);
      });
      if (!ticket) return null;
      let attempted = false;
      return {
        async confirm(requestId?: unknown) {
          if (attempted) return;
          attempted = true; // Includes failures, expired tickets and concurrent calls: no retry.
          const creation = body.kind === "request_images";
          if (creation && (typeof requestId !== "string" || !UUID.test(requestId))) return;
          if (body.kind === "request_images" && body.requestId !== null && requestId !== body.requestId) return;
          await bounded(async signal => {
            const response = await request({ action: "confirm", ticket, ...(creation ? { requestId } : {}) }, ownerId, signal);
            // No notification response is evidence of upload success or delivery.
            // Consume no raw error bodies; all statuses leave the main result alone.
            void response?.body?.cancel().catch(() => {});
          });
        },
      };
    },
  };
}

export function createUploadPhotoNotifications(deps: Dependencies) {
  const protocol = createPhotoNotificationProtocol(deps);
  return {
    async prepareUpload(path: string, ownerId: string): Promise<PreparedUploadNotification | null> {
      const parts = path.split("/");
      if (parts.length !== 2 || parts[0] !== ownerId || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(parts[1])) return null;
      return protocol.prepare({ action: "prepare", kind: "upload", objectName: parts[1] }, ownerId);
    },
  };
}

export function createRequestPhotoNotifications(deps: Dependencies) {
  const protocol = createPhotoNotificationProtocol(deps);
  return {
    async prepareCreation(ownerId: string): Promise<PreparedRequestPhotoNotification | null> {
      return protocol.prepare({ action: "prepare", kind: "request_images", requestId: null }, ownerId);
    },
  };
}

export function createEditedRequestPhotoNotifications(deps: Dependencies) {
  const protocol = createPhotoNotificationProtocol(deps);
  return {
    async prepareUpdate(ownerId: string, requestId: string, before: unknown[], next: unknown[]): Promise<PreparedUploadNotification | null> {
      // Local intent only; the gate verifies ownership and a changed database
      // snapshot. Neither the lists nor their contents are sent to this endpoint.
      try {
        if (!UUID.test(requestId) || JSON.stringify(before) === JSON.stringify(next)) return null;
        const notification = await protocol.prepare({ action: "prepare", kind: "request_images", requestId }, ownerId);
        return notification ? { confirm: () => notification.confirm(requestId) } : null;
      } catch { return null; }
    },
  };
}
