"use client";

import { useState } from "react";

import Lightbox from "yet-another-react-lightbox";
import Zoom from "yet-another-react-lightbox/plugins/zoom";

import "yet-another-react-lightbox/styles.css";

export default function LightboxGallery({ images }: { images: string[] }) {
  const [index, setIndex] = useState<number | null>(null);

  return (
    <>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {images.map((image, imageIndex) => (
          <button
            key={image}
            type="button"
            onClick={() => setIndex(imageIndex)}
            className="group relative aspect-square overflow-hidden rounded-[1.5rem] border border-white/10 bg-white/5"
          >
            <img
              src={image}
              alt="Workshop gallery"
              className="h-full w-full object-cover transition duration-500 group-hover:scale-105"
            />
          </button>
        ))}
      </div>

      <Lightbox
        open={index !== null}
        close={() => setIndex(null)}
        slides={images.map((src) => ({ src }))}
        index={index ?? 0}
        plugins={[Zoom]}
        controller={{
          closeOnBackdropClick: true,
          closeOnPullDown: true,
        }}
        animation={{
          fade: 220,
          swipe: 260,
          zoom: 260,
        }}
        zoom={{
          maxZoomPixelRatio: 4,
          scrollToZoom: true,
          doubleTapDelay: 250,
          doubleClickDelay: 250,
        }}
        carousel={{
          finite: true,
          padding: "16px",
          spacing: "16px",
        }}
        styles={{
          button: { display: "none" },
        }}
      />
    </>
  );
}
