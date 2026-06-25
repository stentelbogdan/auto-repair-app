"use client";

import { useState } from "react";
import Lightbox from "yet-another-react-lightbox";
import Zoom from "yet-another-react-lightbox/plugins/zoom";
import "yet-another-react-lightbox/styles.css";

type GalleryImage = {
  name?: string;
  url?: string;
  dataUrl?: string;
};

export default function ImageGallery({
  images,
  alt = "Galerie imagini",
  className = "h-56 w-full object-cover",
  wrapperClassName = "block w-full overflow-hidden",
}: {
  images: GalleryImage[];
  alt?: string;
  className?: string;
  wrapperClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const [touchStartX, setTouchStartX] = useState<number | null>(null);

  const slides = (images || [])
    .map((img) => ({
      src: img.url || img.dataUrl || "",
    }))
    .filter((img) => img.src);

  const imageCount = slides.length;

  if (!slides.length) {
    return (
      <div className="flex h-56 w-full items-center justify-center bg-white/5 text-white/40">
        Fără poză
      </div>
    );
  }

  return (
    <>
      <div
        className={`relative ${wrapperClassName}`}
        onTouchStart={(event) => {
          setTouchStartX(event.touches[0].clientX);
        }}
        onTouchEnd={(event) => {
          if (touchStartX === null || slides.length <= 1) return;

          const touchEndX = event.changedTouches[0].clientX;
          const diff = touchStartX - touchEndX;

          if (Math.abs(diff) > 40) {
            if (diff > 0) {
              setIndex((current) =>
                current === slides.length - 1 ? 0 : current + 1,
              );
            } else {
              setIndex((current) =>
                current === 0 ? slides.length - 1 : current - 1,
              );
            }
          }

          setTouchStartX(null);
        }}
      >
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            setOpen(true);
          }}
          className="block w-full"
        >
          <img src={slides[index].src} alt={alt} className={className} />
        </button>

        {imageCount > 1 && (
          <>
            <div className="absolute bottom-10 left-1/2 flex -translate-x-1/2 gap-1.5">
              {slides.map((_, dotIndex) => (
                <button
                  key={dotIndex}
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    setIndex(dotIndex);
                  }}
                  className={`h-2 w-2 rounded-full transition ${
                    dotIndex === index ? "bg-white" : "bg-white/40"
                  }`}
                />
              ))}
            </div>

            <div className="absolute bottom-3 right-3 rounded-full bg-black/70 px-3 py-1 text-xs font-semibold text-white backdrop-blur-md">
              {imageCount} poze
            </div>
          </>
        )}
      </div>

      <Lightbox
        open={open}
        close={() => setOpen(false)}
        slides={slides}
        index={index}
        on={{
          view: ({ index }) => setIndex(index),
        }}
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

      {open && slides.length > 1 && (
        <div className="fixed bottom-6 left-1/2 z-[9999] -translate-x-1/2 rounded-full bg-black/70 px-4 py-2 text-sm font-semibold text-white backdrop-blur-md">
          {index + 1} / {slides.length}
        </div>
      )}
    </>
  );
}
