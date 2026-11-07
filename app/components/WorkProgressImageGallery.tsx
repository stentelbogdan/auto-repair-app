"use client";

import { useEffect, useState, type ComponentProps } from "react";
import ImageGallery from "@/app/components/ImageGallery";
import { supabase } from "@/lib/supabase/client";
import { resolveWorkProgressImages } from "@/lib/supabase/work-progress-images";

type Props = ComponentProps<typeof ImageGallery> & { requestId: string };

export default function WorkProgressImageGallery({ requestId, images, ...galleryProps }: Props) {
  const key = JSON.stringify([requestId, images.map(image => image.url ?? "")]);
  const [resolved, setResolved] = useState<{ key: string; urls: (string | null)[] } | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    const [id, references] = JSON.parse(key) as [string, string[]];
    const { data: { subscription } } = supabase.auth.onAuthStateChange(event => {
      if (event !== "SIGNED_OUT" && event !== "SIGNED_IN") return;
      active = false;
      setResolved(null);
      setAttempt(value => value + 1);
    });
    void (async () => {
      try {
        const { data, error } = await supabase.auth.getUser();
        if (!active) return;
        if (error || !data.user) throw new Error("Authentication required");
        const urls = await resolveWorkProgressImages(supabase, id, references);
        if (active) setResolved({ key, urls });
      } catch {
        if (active) setResolved({ key, urls: references.map(() => null) });
      }
    })();
    return () => { active = false; subscription.unsubscribe(); };
  }, [key, attempt]);

  // Never render a previous request's signed URLs while the next effect loads.
  if (resolved?.key !== key) return <p role="status" className="p-4 text-sm opacity-60">Se încarcă fotografiile…</p>;
  const available = images.flatMap((image, index) => {
    const url = resolved.urls[index];
    return url ? [{ name: image.name, url }] : [];
  });
  const retry = () => { setResolved(null); setAttempt(value => value + 1); };
  return <>
    {available.length > 0 && <ImageGallery {...galleryProps} images={available}
      onThumbnailError={() => setResolved({ key, urls: images.map(() => null) })} />}
    {available.length < images.length && <div role="status" className="p-4 text-sm opacity-70">
      <p>{available.length ? "Unele fotografii nu pot fi afișate momentan." : "Fotografiile nu pot fi afișate momentan."}</p>
      <button type="button" className="mt-2 underline" onClick={event => { event.stopPropagation(); retry(); }}>Reîncearcă</button>
    </div>}
  </>;
}
