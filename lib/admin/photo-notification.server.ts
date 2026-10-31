import "server-only";
// @ts-expect-error TS5097: source extension also used by offline Node tests.
import { createPhotoEmitter, createPhotoNotificationHandler } from "./photo-notification.ts";

// No environment reads, network, or subscriptions at module load time.
export async function emitAdminPhotoInvalidation() {
  try { return await createPhotoEmitter({env:process.env,fetch:globalThis.fetch})(); }
  catch { return "unavailable" as const; }
}
export async function handlePhotoNotification(request: Request) {
  return createPhotoNotificationHandler({env:process.env,fetch:globalThis.fetch})(request);
}
