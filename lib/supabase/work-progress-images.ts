import type { SupabaseClient } from "@supabase/supabase-js";

// Restore the private-image resolution used by 61a87ca, scoped to progress only.
// Historical public/signed URLs are references, never an authorization fallback.
const BUCKET = "work-progress";
const TTL_SECONDS = 60 * 60;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function workProgressImagePath(reference: string, requestId: string, projectUrl: string): string | null {
  if (!UUID.test(requestId) || !reference || reference.trim() !== reference) return null;
  try {
    let path = reference;
    if (/^https:\/\//i.test(reference)) {
      const url = new URL(reference);
      const project = new URL(projectUrl);
      if (url.origin !== project.origin || url.username || url.password || url.hash) return null;
      // Reject traversal before URL normalisation can hide it.
      if (/%2f|%5c|(?:\/|%2f)(?:\.|%2e){1,2}(?:\/|%2f)/i.test(url.pathname)
        || /(?:\/|%2f)(?:\.|%2e){1,2}(?:\/|%2f)/i.test(reference)) return null;
      const match = url.pathname.match(/^\/storage\/v1\/object\/(public|sign|authenticated)\/work-progress\/(.+)$/);
      if (!match) return null;
      path = match[2].split("/").map(decodeURIComponent).join("/");
    }
    const parts = path.split("/");
    if ((parts.length !== 2 && parts.length !== 3) || parts[0] !== requestId
      || (parts.length === 3 && !UUID.test(parts[1]))
      || parts.some(part => !part || part === "." || part === ".." || /[\\?#%\u0000-\u001f\u007f]/.test(part))) return null;
    return path;
  } catch {
    return null;
  }
}

function validSignedUrl(value: unknown, path: string, requestId: string, projectUrl: string): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.pathname.startsWith("/storage/v1/object/sign/work-progress/")
      && Boolean(url.searchParams.get("token"))
      && workProgressImagePath(value, requestId, projectUrl) === path;
  } catch { return false; }
}

export async function resolveWorkProgressImages(
  client: SupabaseClient, requestId: string, references: string[],
  projectUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
): Promise<(string | null)[]> {
  const paths = references.map(reference => workProgressImagePath(reference, requestId, projectUrl));
  const unique = [...new Set(paths.filter((path): path is string => path !== null))];
  if (!unique.length) return references.map(() => null);
  const { data, error } = await client.storage.from(BUCKET).createSignedUrls(unique, TTL_SECONDS);
  if (error) throw error;
  if (!Array.isArray(data)) throw new Error("Fotografiile nu pot fi afișate momentan.");
  const urls = new Map<string, string | null>();
  for (const item of data) {
    if (!item || typeof item.path !== "string" || !unique.includes(item.path) || urls.has(item.path)) {
      throw new Error("Răspuns invalid pentru fotografiile progresului.");
    }
    urls.set(item.path, !item.error && validSignedUrl(item.signedUrl, item.path, requestId, projectUrl)
      ? item.signedUrl : null);
  }
  return paths.map(path => path ? urls.get(path) ?? null : null);
}
