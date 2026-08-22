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

type ImageGalleryProps = {
  images: GalleryImage[];
  alt?: string;
  className?: string;
  wrapperClassName?: string;

  /**
   * Imaginea afișată în miniatură și poziția de la care
   * se deschide galeria.
   */
  initialIndex?: number;

  /**
   * Ascunde indicatorul +N.
   * Util în grilele în care afișăm deja toate fotografiile.
   */
  hideCountBadge?: boolean;
  onOpen?: () => void;
};

export default function ImageGallery({
  images,
  alt = "Galerie imagini",
  className = "h-56 w-full object-cover",
  wrapperClassName = "block w-full overflow-hidden",
  initialIndex = 0,
  hideCountBadge = false,
  onOpen,
}: ImageGalleryProps) {
  const [open, setOpen] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(initialIndex);

  const slides = (images || [])
    .map((img) => ({
      src: img.url || img.dataUrl || "",
    }))
    .filter((img) => img.src);

  const imageCount = slides.length;

  const safeInitialIndex =
    imageCount > 0 ? Math.min(Math.max(initialIndex, 0), imageCount - 1) : 0;

  if (!slides.length) {
    return (
      <div className="flex h-56 w-full items-center justify-center bg-white/5 text-white/40">
        Fără poză
      </div>
    );
  }

  return (
    <>
      <div className={`relative ${wrapperClassName}`}>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onOpen?.();
            setSelectedIndex(safeInitialIndex);
            setOpen(true);
          }}
          className="block w-full"
          aria-label={`Deschide ${alt}`}
        >
          <img
            src={slides[safeInitialIndex].src}
            alt={alt}
            className={className}
          />
        </button>

        {!hideCountBadge && imageCount > 1 && (
          <div className="pointer-events-none absolute bottom-2 right-2 flex h-7 min-w-7 items-center justify-center rounded-full bg-black/75 px-2 text-xs font-black text-white backdrop-blur">
            +{imageCount - 1}
          </div>
        )}
      </div>

      <Lightbox
        open={open}
        close={() => setOpen(false)}
        slides={slides}
        index={selectedIndex}
        plugins={[Zoom]}
        portal={{
          container: {
            onClick: (event) => event.stopPropagation(),
          },
        }}
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
