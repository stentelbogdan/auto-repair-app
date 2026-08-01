import type { LucideIcon } from "lucide-react";
import ImageGallery from "@/app/components/ImageGallery";
import LicensePlate from "@/app/components/LicensePlate";

type CarImage = {
  name?: string;
  dataUrl?: string;
  url?: string;
};

type CarHeaderDetail = {
  text: string;
  color?: "yellow" | "orange" | "gray" | "green" | "blue" | "red";
  showDot?: boolean;
  icon?: LucideIcon;
};

type CarHeaderProps = {
  images?: CarImage[];
  plate?: string | null;
  brand?: string | null;
  model?: string | null;
  year?: string | null;
  city?: string | null;
  variant?: "compact" | "listLarge";
  platePosition?: "top" | "bottom";
  details?: CarHeaderDetail[];
  affectedParts?: string[];
  damageTypes?: string[];
};

export default function CarHeader({
  images,
  plate,
  brand,
  model,
  year,
  city,
  variant = "compact",
  platePosition = "top",
  details = [],
  affectedParts = [],
  damageTypes = [],
}: CarHeaderProps) {
  const title = `${brand || "Mașină"} ${model || ""}`.trim();

  const isLarge = variant === "listLarge";

  const imageClassName = isLarge ? "h-[150px] w-[150px]" : "h-20 w-20";
  const wrapperClassName = isLarge
    ? "block h-[150px] w-[150px] overflow-hidden rounded-2xl"
    : "block h-20 w-20 overflow-hidden rounded-2xl";

  return (
    <div className="flex gap-4">
      <div className="shrink-0">
        <div
          className={`${imageClassName} overflow-hidden ${
            isLarge ? "rounded-[22px]" : "rounded-2xl"
          } bg-black/10`}
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

        {platePosition === "bottom" && (
          <div className="mt-2 flex justify-center pr-0">
            <LicensePlate plate={plate} className="scale-90" />
          </div>
        )}
      </div>

      <div className="min-w-0 flex-1">
        {platePosition === "top" && (
          <LicensePlate plate={plate} className="-ml-1 mb-2" />
        )}

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

        {details.length > 0 && (
          <div className="mt-4 space-y-2">
            {details.map((detail) => {
              const Icon = detail.icon;

              return (
                <div key={detail.text} className="flex items-center gap-2">
                  {detail.showDot !== false && !Icon && (
                    <span
                      className={`h-2.5 w-2.5 rounded-full ${getDotColor(
                        detail.color,
                      )}`}
                    />
                  )}

                  {Icon && (
                    <Icon
                      size={15}
                      strokeWidth={2.4}
                      className={getIconColor(detail.color)}
                    />
                  )}

                  <span
                    className={`text-sm font-semibold ${getTextColor(
                      detail.color,
                    )}`}
                  >
                    {detail.text}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {(affectedParts.length > 0 || damageTypes.length > 0) && (
          <div className="mt-4 space-y-3">
            {affectedParts.length > 0 && (
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wide text-black/40">
                  Elemente afectate
                </p>

                <div className="mt-1.5 space-y-1">
                  {affectedParts.slice(0, 3).map((part) => (
                    <p
                      key={part}
                      className="text-xs font-semibold leading-snug text-black/70"
                    >
                      • {part}
                    </p>
                  ))}

                  {affectedParts.length > 3 && (
                    <p className="text-xs font-bold text-orange-600">
                      +{affectedParts.length - 3}{" "}
                      {affectedParts.length - 3 === 1 ? "element" : "elemente"}
                    </p>
                  )}
                </div>
              </div>
            )}

            {damageTypes.length > 0 && (
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wide text-black/40">
                  Tip daună
                </p>

                <div className="mt-1.5 space-y-1">
                  {damageTypes.slice(0, 2).map((damage) => (
                    <p
                      key={damage}
                      className="text-xs font-semibold leading-snug text-black/70"
                    >
                      • {damage}
                    </p>
                  ))}

                  {damageTypes.length > 2 && (
                    <p className="text-xs font-bold text-orange-600">
                      +{damageTypes.length - 2}{" "}
                      {damageTypes.length - 2 === 1 ? "tip" : "tipuri"}
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function getDotColor(color?: CarHeaderDetail["color"]) {
  switch (color) {
    case "yellow":
      return "bg-yellow-500";
    case "orange":
      return "bg-orange-500";
    case "green":
      return "bg-emerald-500";
    case "blue":
      return "bg-blue-500";
    case "red":
      return "bg-red-500";
    case "gray":
    default:
      return "bg-slate-400";
  }
}

function getTextColor(color?: CarHeaderDetail["color"]) {
  switch (color) {
    case "orange":
      return "text-orange-600";
    case "green":
      return "text-emerald-700";
    case "blue":
      return "text-blue-700";
    case "red":
      return "text-red-700";
    case "yellow":
      return "text-black/75";
    case "gray":
    default:
      return "text-black/55";
  }
}

function getIconColor(color?: CarHeaderDetail["color"]) {
  switch (color) {
    case "orange":
      return "text-orange-500";
    case "green":
      return "text-emerald-500";
    case "blue":
      return "text-blue-500";
    case "red":
      return "text-red-500";
    case "yellow":
      return "text-yellow-500";
    case "gray":
    default:
      return "text-slate-400";
  }
}
