import type { SupabaseClient } from "@supabase/supabase-js";

const SIGNED_IMAGE_TTL_SECONDS = 60 * 60;

function isExternalUrl(value: string) {
  return /^https:\/\//i.test(value);
}

export async function resolvePrivateImagePaths(
  client: SupabaseClient,
  bucket: "chat-images" | "work-progress",
  paths: string[],
) {
  const uniquePaths = [...new Set(paths.filter((path) => path && !isExternalUrl(path)))];
  const signedUrlByPath = new Map<string, string>();

  if (uniquePaths.length > 0) {
    const { data, error } = await client.storage
      .from(bucket)
      .createSignedUrls(uniquePaths, SIGNED_IMAGE_TTL_SECONDS);

    if (error) throw error;

    data.forEach((item, index) => {
      if (item.signedUrl) signedUrlByPath.set(uniquePaths[index], item.signedUrl);
    });
  }

  return paths.map((path) =>
    isExternalUrl(path) ? path : signedUrlByPath.get(path) ?? "",
  );
}
