import { notFound } from "next/navigation";
import { Clock, MapPin, Phone, Store, Star } from "lucide-react";
import LightboxGallery from "./LightboxGallery";
import ReviewImagesGallery from "./ReviewImagesGallery";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
);

type Props = {
  params: Promise<{ slug: string }>;
};

export default async function WorkshopProfilePage({ params }: Props) {
  const { slug } = await params;

  const { data: workshop } = await supabase
    .from("profiles")
    .select("*")
    .eq("workshop_slug", slug)
    .single();

  if (!workshop) notFound();

  const { data: reviews } = await supabase
    .from("reviews")
    .select("id, rating, comment, created_at, request_id, images")
    .eq("workshop_user_id", workshop.id)
    .order("created_at", { ascending: false });

  const requestIds = (reviews || [])
    .map((review) => review.request_id)
    .filter(Boolean);

  const { data: reviewRequests } = await supabase
    .from("repair_requests")
    .select("id, car_brand, car_model, car_year, city")
    .in("id", requestIds);

  const requestsById = new Map(
    (reviewRequests || []).map((request) => [request.id, request]),
  );

  const reviewList = reviews || [];
  const averageRating =
    reviewList.length > 0
      ? reviewList.reduce((sum, item) => sum + Number(item.rating || 0), 0) /
        reviewList.length
      : 0;

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

                {reviewList.length > 0 && (
                  <div className="mt-4 rounded-2xl border border-orange-500/20 bg-black/35 p-4">
                    <div className="flex items-center gap-2 text-orange-300">
                      {[1, 2, 3, 4, 5].map((star) => (
                        <Star
                          key={star}
                          size={18}
                          fill="currentColor"
                          className={
                            star <= Math.round(averageRating)
                              ? "text-orange-300"
                              : "text-white/20"
                          }
                        />
                      ))}

                      <span className="ml-2 text-sm font-black text-white">
                        {averageRating.toFixed(1)} / 5
                      </span>
                    </div>

                    <p className="mt-2 text-xs font-medium text-white/50">
                      Bazat pe {reviewList.length} review-uri verificate
                    </p>
                  </div>
                )}

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

            {reviewList.length > 0 && (
              <div className="mt-8 rounded-[2rem] border border-white/10 bg-black/30 p-6">
                <h2 className="text-2xl font-black">Review-uri clienți</h2>

                <div className="mt-5 grid gap-4">
                  {reviewList.map((review: any) => {
                    const reviewRequest = requestsById.get(review.request_id);

                    return (
                      <div
                        key={review.id}
                        className="rounded-3xl bg-white p-5 text-black"
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <p className="text-lg font-black">
                              {reviewRequest?.car_brand || "Mașină"}{" "}
                              {reviewRequest?.car_model || ""}
                            </p>

                            <p className="text-sm text-black/50">
                              {reviewRequest?.car_year || "-"} •{" "}
                              {reviewRequest?.city || "-"}
                            </p>

                            <p className="mt-1 text-xs text-black/40">
                              {new Date(review.created_at).toLocaleDateString(
                                "ro-RO",
                              )}
                            </p>
                          </div>

                          <div className="flex flex-col items-end">
                            <div className="rounded-full bg-orange-100 px-3 py-1 text-sm font-bold text-orange-700">
                              ⭐ {review.rating}
                            </div>

                            <span className="mt-2 text-xs font-medium text-black/50">
                              ✔ Lucrare verificată
                            </span>
                          </div>
                        </div>

                        {review.comment && (
                          <p className="mt-4 text-black/70">{review.comment}</p>
                        )}

                        {Array.isArray(review.images) &&
                          review.images.length > 0 && (
                            <div className="mt-4">
                              <ReviewImagesGallery images={review.images} />
                            </div>
                          )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {gallery.length > 0 && (
              <div className="mt-8">
                <div className="mb-5">
                  <h2 className="text-2xl font-black">Workshop gallery</h2>
                  <p className="mt-1 text-white/50">
                    Recent work and workshop photos
                  </p>
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
