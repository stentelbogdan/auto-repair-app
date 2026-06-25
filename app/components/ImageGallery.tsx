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

  const slides = (images || [])
    .map((img) => ({
      src: img.url || img.dataUrl || "",
    }))
    .filter((img) => img.src);

  if (!slides.length) {
    return (
      <div className="flex h-56 w-full items-center justify-center bg-white/5 text-white/40">
        Fără poză
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          setOpen(true);
        }}
        className={wrapperClassName}
      >
        <img src={slides[0].src} alt={alt} className={className} />
      </button>

      <Lightbox
        open={open}
        close={() => setOpen(false)}
        slides={slides}
        index={0}
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