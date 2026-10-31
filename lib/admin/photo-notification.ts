// Testable transport and validation. Production entrypoints live in the server-only wrapper.
export const PHOTO_SQL_VERSION = "4g-v1";
const TEST_URL = "https://bstjobvvxxfqqwyjoimx.supabase.co";
const TEST_REF = "bstjobvvxxfqqwyjoimx";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export type PhotoNotificationInput =
  | { action: "prepare"; kind: "upload"; objectName: string }
  | { action: "prepare"; kind: "request_images"; requestId: string | null }
  | { action: "confirm"; ticket: string; requestId?: string };
export type PhotoNotificationEnvironment = Record<string, string | undefined>;
type Transport = { env: PhotoNotificationEnvironment; fetch: typeof fetch; timeoutMs?: number };
function record(value: unknown): value is Record<string, unknown> { return !!value && typeof value === "object" && !Array.isArray(value); }
function keys(value: Record<string, unknown>, expected: string[]) {
  return Object.keys(value).length === expected.length && expected.every(k => Object.hasOwn(value,k));
}
export function parsePhotoNotification(value: unknown): PhotoNotificationInput | null {
  if (!record(value)) return null;
  if (value.action === "prepare" && value.kind === "upload" && keys(value,["action","kind","objectName"]) &&
      typeof value.objectName === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(value.objectName)) return value as PhotoNotificationInput;
  if (value.action === "prepare" && value.kind === "request_images" && keys(value,["action","kind","requestId"]) &&
      (value.requestId === null || (typeof value.requestId === "string" && UUID.test(value.requestId)))) return value as PhotoNotificationInput;
  if (value.action === "confirm" && typeof value.ticket === "string" && UUID.test(value.ticket) &&
      (keys(value,["action","ticket"]) || (keys(value,["action","ticket","requestId"]) &&
        typeof value.requestId === "string" && UUID.test(value.requestId)))) return value as PhotoNotificationInput;
  return null;
}
export function photoNotificationEnabled(env: PhotoNotificationEnvironment): boolean {
  return typeof window === "undefined" && env.VERCEL_ENV === "preview"
    && env.ADMIN_PHOTO_NOTIFICATION_ENABLED === "true"
    && env.ADMIN_PHOTO_SQL_CONTRACT === PHOTO_SQL_VERSION
    && env.SUPABASE_URL === TEST_URL && env.NEXT_PUBLIC_SUPABASE_URL === TEST_URL
    && env.NEXT_PUBLIC_AUTOREPAIR_SUPABASE_PROJECT_REF === TEST_REF
    && !!env.SUPABASE_SERVICE_ROLE_KEY && !!env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
}
async function bounded<T>(deps: Transport, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([Promise.resolve().then(() => work(controller.signal)), new Promise<never>((_,reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new Error("NOTIFICATION_TIMEOUT")); },
        Math.max(1, Math.min(deps.timeoutMs ?? 2500, 5000)));
    })]);
  } finally { clearTimeout(timer); controller.abort(); }
}
async function jsonLimited(response: Response, limit: number, signal: AbortSignal): Promise<unknown> {
  if (!response.body) throw new Error("EMPTY_RESPONSE");
  const reader=response.body.getReader(); const decoder=new TextDecoder("utf-8",{fatal:true});
  let size=0, text="";
  const cancel = () => { void reader.cancel().catch(()=>{}); };
  signal.addEventListener("abort", cancel, {once:true});
  if (signal.aborted) cancel();
  try {
    while (true) {
      const part=await reader.read(); if(part.done) break;
      size+=part.value.byteLength; if(size>limit) throw new Error("BODY_LIMIT");
      text+=decoder.decode(part.value,{stream:true});
    }
    return JSON.parse(text+decoder.decode());
  } finally { signal.removeEventListener("abort",cancel); cancel(); }
}
export function createPhotoEmitter(deps: Transport) {
  // Every exception, including configuration access and synchronous fetch failure,
  // is contained. "accepted" means transport acceptance, NOT delivered/deleted.
  return async (): Promise<"disabled" | "accepted" | "unavailable"> => {
    try {
      if (!photoNotificationEnabled(deps.env)) return "disabled";
      return await bounded(deps, async signal => {
        const response = await deps.fetch(`${TEST_URL}/realtime/v1/api/broadcast`, {
          method: "POST", redirect: "manual", cache: "no-store", signal,
          headers: { apikey: deps.env.SUPABASE_SERVICE_ROLE_KEY!,
            Authorization: `Bearer ${deps.env.SUPABASE_SERVICE_ROLE_KEY!}`, "Content-Type":"application/json" },
          body: JSON.stringify({messages:[{topic:"admin:photo-overview:v1",event:"invalidate",payload:{v:1},private:true}]}),
        });
        void response.body?.cancel().catch(()=>{});
        return response.status === 202 ? "accepted" : "unavailable";
      });
    } catch { return "unavailable"; }
  };
}
const response = (status: number, body: object) => Response.json(body, {status, headers:{"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});
export function createPhotoNotificationHandler(deps: Transport) {
  const emit = createPhotoEmitter(deps);
  return async (request: Request): Promise<Response> => {
    try {
      if (!photoNotificationEnabled(deps.env)) return response(404,{status:"disabled"});
      if (request.method !== "POST") return response(405,{status:"method_not_allowed"});
      const authorization=request.headers.get("authorization");
      if (!authorization || authorization.length>8192 || !/^Bearer [A-Za-z0-9._~+\/-]+=*$/.test(authorization)) return response(401,{status:"unauthenticated"});
      if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers.get("content-type")??"") ||
        ![null,"identity"].includes(request.headers.get("content-encoding"))) return response(415,{status:"invalid_input"});
      let input: PhotoNotificationInput | null;
      try { input = parsePhotoNotification(await bounded(deps, signal => jsonLimited(new Response(request.body),1024,signal))); }
      catch { return response(400,{status:"invalid_input"}); }
      if (!input) return response(400,{status:"invalid_input"});
      const auth=await bounded(deps, async signal => {
        const res=await deps.fetch(`${TEST_URL}/auth/v1/user`,{redirect:"manual",cache:"no-store",signal,
          headers:{Authorization:authorization,apikey:deps.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!}});
        if(res.status!==200) { void res.body?.cancel().catch(()=>{}); return null; }
        return jsonLimited(res,16384,signal);
      });
      if (!record(auth) || typeof auth.id!=="string" || !UUID.test(auth.id)) return response(401,{status:"unauthenticated"});
      // SQL is the authorization/atomic dedup boundary. No JS in-memory quota.
      const gate=await bounded(deps, async signal => {
        const res=await deps.fetch(`${TEST_URL}/rest/v1/rpc/admin_photo_notification_gate`,{
          method:"POST",redirect:"manual",cache:"no-store",signal,
          headers:{Authorization:`Bearer ${deps.env.SUPABASE_SERVICE_ROLE_KEY!}`,apikey:deps.env.SUPABASE_SERVICE_ROLE_KEY!,"Content-Type":"application/json"},
          body:JSON.stringify({p_actor:auth.id,p_action:input.action,
            p_kind:input.action==="prepare"?input.kind:null,
            p_object_name:input.action==="prepare"&&input.kind==="upload"?input.objectName:null,
            p_request_id:"requestId" in input?input.requestId:null,
            p_ticket:input.action==="confirm"?input.ticket:null}),
        });
        if(res.status!==200) { void res.body?.cancel().catch(()=>{}); throw new Error("CONTRACT_UNAVAILABLE"); }
        return jsonLimited(res,2048,signal);
      });
      if (!record(gate) || gate.version!==PHOTO_SQL_VERSION || typeof gate.status!=="string") return response(503,{status:"contract_unavailable"});
      if (input.action==="prepare" && gate.status==="prepared" && keys(gate,["version","status","ticket"]) && typeof gate.ticket==="string" && UUID.test(gate.ticket)) {
        return response(200,{status:"prepared",ticket:gate.ticket});
      }
      if (!keys(gate,["version","status"])) return response(503,{status:"contract_unavailable"});
      if (gate.status==="ineligible") return response(403,{status:"ineligible"});
      if (gate.status==="throttled") return response(429,{status:"throttled"});
      if (gate.status==="suppressed") return response(200,{status:"suppressed"});
      if (input.action!=="confirm" || gate.status!=="claimed") return response(503,{status:"contract_unavailable"});
      const sent=await emit();
      return sent==="accepted" ? response(202,{status:"accepted"}) : response(503,{status:"notification_unavailable"});
    } catch { return response(503,{status:"notification_unavailable"}); }
  };
}

/** Only the server deletion route uses this contract. The public notify-change
 * parser stays unchanged: browser callers cannot select the deletion gate.
 * prepare binds selectors; confirm requires SQL receipt + immutable completion proof.
 */
export const PHOTO_DELETION_SQL_VERSION = "deletion-v1";
export function createDeletedPhotoInvalidation(deps: Transport) {
  const enabled = () => photoNotificationEnabled(deps.env)
    && deps.env.ADMIN_PHOTO_DELETION_SQL_CONTRACT === PHOTO_DELETION_SQL_VERSION;
  return async (requestId: string, operationId: string, token: string): Promise<{ confirm(): Promise<void> } | null> => {
    try {
      if (!UUID.test(requestId) || !UUID.test(operationId) || !enabled()
        || token.length > 8185 || !/^[A-Za-z0-9._~+\/-]+=*$/.test(token)) return null;
      let preparedActor: string | undefined;
      // Capture the bearer outside after(); authenticate it again inside confirm.
      const dispatch = async (action: "prepare" | "confirm", ticket: string | null) => {
        if (!enabled()) return null;
        const auth = await bounded(deps, async signal => {
          const res = await deps.fetch(`${TEST_URL}/auth/v1/user`, {
            redirect: "manual", cache: "no-store", signal,
            headers: { Authorization: `Bearer ${token}`, apikey: deps.env.NEXT_PUBLIC_SUPABASE_ANON_KEY! },
          });
          if (res.status !== 200) { void res.body?.cancel().catch(() => {}); return null; }
          return jsonLimited(res, 16384, signal);
        });
        if (!record(auth) || typeof auth.id !== "string" || !UUID.test(auth.id)
          || (preparedActor !== undefined && auth.id !== preparedActor)) return null;
        preparedActor = auth.id;
        return bounded(deps, async signal => {
          const res = await deps.fetch(`${TEST_URL}/rest/v1/rpc/admin_photo_deletion_notification_gate`, {
            method: "POST", redirect: "manual", cache: "no-store", signal,
            headers: { Authorization: `Bearer ${deps.env.SUPABASE_SERVICE_ROLE_KEY!}`,
              apikey: deps.env.SUPABASE_SERVICE_ROLE_KEY!, "Content-Type": "application/json" },
            body: JSON.stringify({ p_actor: auth.id, p_action: action, p_request_id: requestId,
              p_operation_id: operationId, p_ticket: ticket }),
          });
          if (res.status !== 200) { void res.body?.cancel().catch(() => {}); return null; }
          return jsonLimited(res, 2048, signal);
        });
      };
      const value = await dispatch("prepare", null);
      if (!record(value) || !keys(value, ["version", "status", "ticket"])
        || value.version !== PHOTO_DELETION_SQL_VERSION || value.status !== "prepared"
        || typeof value.ticket !== "string" || !UUID.test(value.ticket)) return null;
      const ticket = value.ticket;
      let attempted = false;
      return { async confirm() {
        if (attempted) return;
        attempted = true;
        try {
          const gate = await dispatch("confirm", ticket);
          if (record(gate) && keys(gate, ["version", "status"])
            && gate.version === PHOTO_DELETION_SQL_VERSION && gate.status === "claimed") {
            await createPhotoEmitter(deps)();
          }
        } catch { /* Notification failure cannot change the deletion response. */ }
      } };
    } catch { return null; }
  };
}
