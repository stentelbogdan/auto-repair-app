"use client";

import { Suspense, useEffect, useState } from "react";
import { ImagePlus, X } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase/client";

type RequestRow = {
  id: string;
  user_id: string;
  car_brand: string | null;
  car_model: string | null;
  status: string | null;
  accepted_offer_id: string | null;
};

type OfferRow = {
  id: string;
  workshop_user_id: string;
  workshop_name: string | null;
};

type ReviewPreviewImage = {
  file: File;
  previewUrl: string;
};

export default function ReviewPage() {
  return (
    <Suspense fallback={<ReviewLoading />}>
      <ReviewContent />
    </Suspense>
  );
}

function ReviewContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestId = searchParams.get("id");

  const [request, setRequest] = useState<RequestRow | null>(null);
  const [offer, setOffer] = useState<OfferRow | null>(null);
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState("");
  const [reviewImages, setReviewImages] = useState<ReviewPreviewImage[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const loadData = async () => {
      if (!requestId) {
        router.push("/customer/my-jobs");
        return;
      }

      const { data: authData } = await supabase.auth.getUser();

      if (!authData.user) {
        router.push("/login");
        return;
      }

      const { data: requestData, error: requestError } = await supabase
        .from("repair_requests")
        .select("id, user_id, car_brand, car_model, status, accepted_offer_id")
        .eq("id", requestId)
        .single<RequestRow>();

      if (requestError || !requestData) {
        alert("Nu am putut încărca lucrarea.");
        router.push("/customer/my-jobs");
        return;
      }

      if (requestData.user_id !== authData.user.id) {
        alert("Nu ai acces la această lucrare.");
        router.push("/customer/my-jobs");
        return;
      }

      if (requestData.status !== "completed") {
        alert("Poți lăsa review doar după finalizarea lucrării.");
        router.push("/customer/my-jobs");
        return;
      }

      if (!requestData.accepted_offer_id) {
        alert("Această lucrare nu are ofertă acceptată.");
        router.push("/customer/my-jobs");
        return;
      }

      const { data: offerData, error: offerError } = await supabase
        .from("repair_offers")
        .select("id, workshop_user_id, workshop_name")
        .eq("id", requestData.accepted_offer_id)
        .single<OfferRow>();

      if (offerError || !offerData) {
        alert("Nu am putut încărca service-ul.");
        router.push("/customer/my-jobs");
        return;
      }

      setRequest(requestData);
      setOffer(offerData);
      setLoading(false);
    };

    loadData();
  }, [requestId, router]);

  const handleReviewImages = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    const remainingSlots = 5 - reviewImages.length;

    const selectedFiles = files.slice(0, remainingSlots);

    const newImages = selectedFiles.map((file) => ({
      file,
      previewUrl: URL.createObjectURL(file),
    }));

    setReviewImages((current) => [...current, ...newImages]);
    event.target.value = "";
  };

  const removeReviewImage = (index: number) => {
    setReviewImages((current) => {
      const imageToRemove = current[index];
      if (imageToRemove) {
        URL.revokeObjectURL(imageToRemove.previewUrl);
      }

      return current.filter((_, imageIndex) => imageIndex !== index);
    });
  };

  const uploadReviewImages = async (userId: string) => {
    const uploadedUrls: string[] = [];

    for (const image of reviewImages) {
      const fileExtension = image.file.name.split(".").pop() || "jpg";
      const filePath = `${userId}/${requestId}/${Date.now()}-${crypto.randomUUID()}.${fileExtension}`;

      const { error: uploadError } = await supabase.storage
        .from("review-images")
        .upload(filePath, image.file, {
          cacheControl: "3600",
          upsert: false,
        });

      if (uploadError) {
        throw uploadError;
      }

      const { data: publicUrlData } = supabase.storage
        .from("review-images")
        .getPublicUrl(filePath);

      uploadedUrls.push(publicUrlData.publicUrl);
    }

    return uploadedUrls;
  };

  const submitReview = async () => {
    if (!request || !offer) return;

    try {
      setSaving(true);

      const { data: authData } = await supabase.auth.getUser();

      if (!authData.user) {
        router.push("/login");
        return;
      }

      const uploadedImageUrls = await uploadReviewImages(authData.user.id);

      const { error } = await supabase.from("reviews").insert({
        request_id: request.id,
        offer_id: offer.id,
        customer_user_id: authData.user.id,
        workshop_user_id: offer.workshop_user_id,
        rating,
        comment: comment.trim() || null,
        images: uploadedImageUrls,
      });

      if (error) {
        console.error("Review insert error:", error);
        alert(error.message);
        return;
      }

      router.push("/customer/my-jobs");
    } catch (error: any) {
      console.error("Review save error:", error);
      alert(error.message || "Nu am putut salva review-ul.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <ReviewLoading />;
  if (!request || !offer) return null;

  return (
    <main className="min-h-screen bg-[#111111] px-4 py-6 text-white">
      <div className="mx-auto max-w-xl">
        <p className="text-xs uppercase tracking-[0.28em] text-orange-400">
          Review service
        </p>

        <h1 className="mt-3 text-3xl font-black">Cum a fost lucrarea?</h1>

        <div className="mt-6 rounded-[28px] bg-white p-6 text-black shadow-xl">
          <h2 className="text-2xl font-black">
            {request.car_brand} {request.car_model}
          </h2>

          <p className="mt-1 text-black/50">
            Service: <strong>{offer.workshop_name || "Service"}</strong>
          </p>

          <div className="mt-6">
            <p className="mb-3 text-sm font-semibold text-black/50">
              Alege ratingul
            </p>

            <div className="flex gap-2 text-4xl">
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  type="button"
                  onClick={() => setRating(star)}
                  className={
                    star <= rating ? "text-orange-400" : "text-black/20"
                  }
                >
                  ★
                </button>
              ))}
            </div>
          </div>

          <div className="mt-6">
            <p className="mb-2 text-sm font-semibold text-black/50">
              Comentariu
            </p>

            <textarea
              value={comment}
              onChange={(event) => setComment(event.target.value)}
              rows={5}
              placeholder="Scrie câteva cuvinte despre experiența ta..."
              className="w-full rounded-2xl bg-gray-100 p-4 text-black outline-none"
            />
          </div>

          <div className="mt-6">
            <p className="mb-2 text-sm font-semibold text-black/50">
              Poze review
            </p>

            <label className="flex cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed border-black/20 bg-gray-100 p-5 text-center transition active:scale-[0.98]">
              <ImagePlus className="mb-2 h-7 w-7 text-orange-500" />
              <span className="font-bold">Adaugă poze</span>
              <span className="mt-1 text-xs text-black/45">Maxim 5 poze</span>

              <input
                type="file"
                accept="image/*"
                multiple
                onChange={handleReviewImages}
                className="hidden"
                disabled={reviewImages.length >= 5 || saving}
              />
            </label>

            {reviewImages.length > 0 && (
              <div className="mt-4 grid grid-cols-3 gap-3">
                {reviewImages.map((image, index) => (
                  <div
                    key={image.previewUrl}
                    className="relative aspect-square overflow-hidden rounded-2xl bg-gray-100"
                  >
                    <img
                      src={image.previewUrl}
                      alt={`Poză review ${index + 1}`}
                      className="h-full w-full object-cover"
                    />

                    <button
                      type="button"
                      onClick={() => removeReviewImage(index)}
                      className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-black/75 text-white"
                    >
                      <X size={16} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={submitReview}
            disabled={saving}
            className="mt-6 w-full rounded-2xl bg-black px-6 py-4 font-bold text-white disabled:opacity-60"
          >
            {saving ? "Se salvează..." : "Trimite review"}
          </button>
        </div>
      </div>
    </main>
  );
}

function ReviewLoading() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#111111] text-white">
      Se încarcă...
    </main>
  );
}
