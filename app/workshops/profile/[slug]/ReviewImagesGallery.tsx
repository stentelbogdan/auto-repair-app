"use client";

import ImageGallery from "@/app/components/ImageGallery";

export default function ReviewImagesGallery({ images }: { images: string[] }) {
  const uniqueImages = Array.from(new Set(images || []));

  if (uniqueImages.length === 0) return null;

  return (
    <div className="mt-4">
      <ImageGallery
        images={uniqueImages.map((url, index) => ({
          name: `review-image-${index}`,
          url,
        }))}
        alt="Poze review"
        className="h-40 w-full object-cover"
        wrapperClassName="block w-full overflow-hidden rounded-2xl"
      />
    </div>
  );
}
