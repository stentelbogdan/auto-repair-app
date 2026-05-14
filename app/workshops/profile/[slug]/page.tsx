import { notFound } from "next/navigation";
import { Clock, MapPin, Phone, Store } from "lucide-react";

import LightboxGallery from "./LightboxGallery";

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
);

type Props = {
  params: Promise<{
    slug: string;
  }>;
};

export default async function WorkshopProfilePage({ params }: Props) {
  const { slug } = await params;

  const { data: workshop } = await supabase
    .from("profiles")
    .select("*")
    .eq("workshop_slug", slug)
    .single();

  if (!workshop) {
    notFound();
  }

  const gallery: string[] = Array.isArray(workshop.workshop_gallery_urls)
    ? workshop.workshop_gallery_urls
    : [];

  return (
    <main className="min-h-screen bg-black px-5 py-8 text-white">
      <div className="mx-auto max-w-6xl">
        <div className="overflow-hidden rounded-[2rem] border border-white/10 bg-white/[0.04]">
          <div className="h-44 bg-gradient-to-br from-orange-500/20 to-black" />

          <div className="relative px-6 pb-8">
            <div className="-mt-16 flex flex-col gap-5 md:flex-row md:items-end">
              <div className="h-32 w-32 overflow-hidden rounded-[2rem] border-4 border-black bg-white">
                {workshop.workshop_logo_url ? (
                  <img
                    src={workshop.workshop_logo_url}
                    alt="Workshop logo"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center bg-orange-500/10">
                    <Store className="h-12 w-12 text-orange-400" />
                  </div>
                )}
              </div>

              <div className="flex-1">
                <p className="text-sm uppercase tracking-[0.25em] text-orange-400">
                  Verified workshop
                </p>

                <h1 className="mt-2 text-4xl font-black">
                  {workshop.workshop_name || "Workshop"}
                </h1>

                <div className="mt-4 flex flex-wrap gap-3 text-sm text-white/60">
                  {workshop.workshop_city && (
                    <div className="flex items-center gap-2">
                      <MapPin size={16} />
                      {workshop.workshop_city}
                    </div>
                  )}

                  {workshop.workshop_phone && (
                    <div className="flex items-center gap-2">
                      <Phone size={16} />
                      {workshop.workshop_phone}
                    </div>
                  )}

                  {workshop.workshop_hours && (
                    <div className="flex items-center gap-2">
                      <Clock size={16} />
                      {workshop.workshop_hours}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {workshop.workshop_description && (
              <div className="mt-8 rounded-[2rem] border border-white/10 bg-black/30 p-6">
                <h2 className="text-xl font-bold">About the workshop</h2>

                <p className="mt-4 whitespace-pre-wrap leading-7 text-white/70">
                  {workshop.workshop_description}
                </p>
              </div>
            )}

            {gallery.length > 0 && (
              <div className="mt-8">
                <div className="mb-5 flex items-center justify-between">
                  <div>
                    <h2 className="text-2xl font-black">Workshop gallery</h2>

                    <p className="mt-1 text-white/50">
                      Recent work and workshop photos
                    </p>
                  </div>
                </div>

                <LightboxGallery images={gallery} />
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
