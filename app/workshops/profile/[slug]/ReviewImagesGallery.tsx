"use client";

import { useState } from "react";
import Lightbox from "yet-another-react-lightbox";
import Zoom from "yet-another-react-lightbox/plugins/zoom";
import "yet-another-react-lightbox/styles.css";

export default function ReviewImagesGallery({ images }: { images: string[] }) {
  const uniqueImages = Array.from(new Set(images || []));
  const [index, setIndex] = useState<number | null>(null);

  if (uniqueImages.length === 0) return null;

  return (
    <>
      <div className="mt-4 flex gap-3 overflow-x-auto pb-1">
        {uniqueImages.slice(0, 5).map((image, imageIndex) => (
          <button
            key={`${image}-${imageIndex}`}
            type="button"
            onClick={() => setIndex(imageIndex)}
            className="relative h-24 w-24 shrink-0 overflow-hidden rounded-2xl bg-black/10"
          >
            <img
              src={image}
              alt={`Poză review ${imageIndex + 1}`}
              className="h-full w-full object-cover"
            />
          </button>
        ))}
      </div>

      <Lightbox
        open={index !== null}
        close={() => setIndex(null)}
        slides={uniqueImages.map((src) => ({ src }))}
        index={index ?? 0}
        plugins={[Zoom]}
        controller={{
          closeOnBackdropClick: true,
          closeOnPullDown: true,
        }}
        animation={{ fade: 220, swipe: 260, zoom: 260 }}
        zoom={{
          maxZoomPixelRatio: 4,
          scrollToZoom: true,
          doubleTapDelay: 250,
          doubleClickDelay: 250,
        }}
        carousel={{ finite: true, padding: "16px", spacing: "16px" }}
        styles={{
          button: { display: "none" },
        }}
      />
    </>
  );
}
