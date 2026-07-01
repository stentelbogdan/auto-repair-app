import ImageGallery from "@/app/components/ImageGallery";
import LicensePlate from "@/app/components/LicensePlate";

type CarImage = {
  name?: string;
  dataUrl?: string;
  url?: string;
};

type CarHeaderProps = {
  images?: CarImage[];
  plate?: string | null;
  brand?: string | null;
  model?: string | null;
  year?: string | null;
  city?: string | null;
  variant?: "compact" | "listLarge";
};

export default function CarHeader({
  images,
  plate,
  brand,
  model,
  year,
  city,
  variant = "compact",
}: CarHeaderProps) {
  const title = `${brand || "Mașină"} ${model || ""}`.trim();

  const isLarge = variant === "listLarge";

  const imageClassName = isLarge ? "h-[155px] w-[145px]" : "h-20 w-20";
  const wrapperClassName = isLarge
    ? "block h-[155px] w-[145px] overflow-hidden rounded-2xl"
    : "block h-20 w-20 overflow-hidden rounded-2xl";

  return (
    <div className="flex gap-4">
      <div
        className={`${imageClassName} shrink-0 overflow-hidden ${isLarge ? "rounded-[22px]" : "rounded-2xl"} bg-black/10`}
      >
        {images && images.length > 0 ? (
          <ImageGallery
            images={images}
            alt={title}
            className={`${imageClassName} object-cover`}
            wrapperClassName={wrapperClassName}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-xs text-black/40">
            Fără poză
          </div>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <LicensePlate plate={plate} className="-ml-1 mb-2" />

        <h2 className="text-xl font-extrabold leading-tight text-black">
          {title}
        </h2>

        <p
          className={
            isLarge
              ? "mt-2 text-sm text-black/55"
              : "mt-1 text-xs text-black/55"
          }
        >
          {year || "-"} • {city || "-"}
        </p>
      </div>
    </div>
  );
}
