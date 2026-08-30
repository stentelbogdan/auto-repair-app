"use client";

import { useState } from "react";
import type { LucideIcon } from "lucide-react";
import ImageGallery from "@/app/components/ImageGallery";
import LicensePlate from "@/app/components/LicensePlate";
import type { MechanicalCategoryId } from "@/lib/mechanical/mechanical-categories";
import type { MechanicalServiceDetailGroup } from "@/lib/mechanical/mechanical-service-details";

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

export type WheelsServiceDetailGroup = {
  key: string;
  title: string;
  serviceLabels: string[];
};

export type WheelsServiceSummary = {
  groups: WheelsServiceDetailGroup[];
  wheelSizeLabel: string;
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
  mechanicalDetails?: MechanicalServiceDetailGroup[];
  wheelsSummary?: WheelsServiceSummary;
  showAllMechanicalDetails?: boolean;
  onActiveInteraction?: () => void;
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
  mechanicalDetails = [],
  wheelsSummary,
  showAllMechanicalDetails: forceShowAllMechanicalDetails = false,
  onActiveInteraction,
}: CarHeaderProps) {
  const title = `${brand || "Mașină"} ${model || ""}`.trim();

  const isLarge = variant === "listLarge";

  const [showAllParts, setShowAllParts] = useState(false);
  const [showAllDamages, setShowAllDamages] = useState(false);
  const [expandedMechanicalCategories, setExpandedMechanicalCategories] =
    useState<Partial<Record<MechanicalCategoryId, boolean>>>({});

  const visibleParts = showAllParts ? affectedParts : affectedParts.slice(0, 3);

  const visibleDamages = showAllDamages ? damageTypes : damageTypes.slice(0, 2);

  const imageClassName = isLarge ? "h-[150px] w-[150px]" : "h-20 w-20";
  const wrapperClassName = isLarge
    ? "block h-[150px] w-[150px] overflow-hidden rounded-2xl"
    : "block h-20 w-20 overflow-hidden rounded-2xl";

  const mediaColumnClassName = isLarge ? "w-[150px]" : "w-20";

  return (
    <div className="flex gap-4">
      <div className={`${mediaColumnClassName} shrink-0`}>
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
              onOpen={onActiveInteraction}
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-xs text-black/40">
              Fără poză
            </div>
          )}
        </div>

        {platePosition === "bottom" && (
          <div className="mt-2">
            <div className="flex justify-center">
              <LicensePlate plate={plate} className="scale-90" />
            </div>

            {details.length > 0 && (
              <div className="mt-2 flex flex-col items-center gap-1.5">
                {details.map((detail) => {
                  const Icon = detail.icon;

                  return (
                    <div
                      key={detail.text}
                      className="flex max-w-full items-center justify-center gap-1.5 rounded-2xl bg-black/[0.04] px-2.5 py-1"
                    >
                      {detail.showDot !== false && !Icon && (
                        <span
                          className={`h-2.5 w-2.5 shrink-0 rounded-full ${getDotColor(
                            detail.color,
                          )}`}
                        />
                      )}

                      {Icon && (
                        <Icon
                          size={14}
                          strokeWidth={2.4}
                          className={`shrink-0 ${getIconColor(detail.color)}`}
                        />
                      )}

                      <span
                        className={`min-w-0 text-center text-xs font-bold leading-tight ${getTextColor(
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
              ? "mt-2 text-[15px] leading-5 text-black/65"
              : "mt-1 text-[13px] leading-[18px] text-black/65"
          }
        >
          {year || "-"} • {city || "-"}
        </p>

        {platePosition === "top" && details.length > 0 && (
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
                <p className="text-xs font-bold uppercase tracking-wide text-black/60">
                  Elemente afectate
                </p>

                <div className="mt-1.5 space-y-1">
                  {visibleParts.map((part) => (
                    <p
                      key={part}
                      className="text-[13px] font-semibold leading-[18px] text-black/70"
                    >
                      • {part}
                    </p>
                  ))}

                  {affectedParts.length > 3 && (
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        onActiveInteraction?.();
                        setShowAllParts((current) => !current);
                      }}
                      className="text-left text-[13px] font-bold leading-[18px] text-orange-600 transition active:scale-[0.98]"
                      aria-expanded={showAllParts}
                    >
                      {showAllParts
                        ? "Arată mai puține"
                        : `+${affectedParts.length - 3} ${
                            affectedParts.length - 3 === 1
                              ? "element"
                              : "elemente"
                          }`}
                    </button>
                  )}
                </div>
              </div>
            )}

            {damageTypes.length > 0 && (
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-black/60">
                  Tip daună
                </p>

                <div className="mt-1.5 space-y-1">
                  {visibleDamages.map((damage) => (
                    <p
                      key={damage}
                      className="text-[13px] font-semibold leading-[18px] text-black/70"
                    >
                      • {damage}
                    </p>
                  ))}

                  {damageTypes.length > 2 && (
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        onActiveInteraction?.();
                        setShowAllDamages((current) => !current);
                      }}
                      className="text-left text-[13px] font-bold leading-[18px] text-orange-600 transition active:scale-[0.98]"
                      aria-expanded={showAllDamages}
                    >
                      {showAllDamages
                        ? "Arată mai puține"
                        : `+${damageTypes.length - 2} ${
                            damageTypes.length - 2 === 1 ? "tip" : "tipuri"
                          }`}
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {mechanicalDetails.length > 0 && (
          <div className="mt-4 space-y-3">
            {mechanicalDetails.map((group) => {
              const isExpanded =
                forceShowAllMechanicalDetails ||
                Boolean(expandedMechanicalCategories[group.category]);
              const visibleSymptoms = isExpanded
                ? group.symptomLabels
                : group.symptomLabels.slice(0, 2);
              const hiddenSymptoms = Math.max(
                0,
                group.symptomLabels.length - visibleSymptoms.length,
              );

              return (
                <div key={group.category}>
                  <p className="text-xs font-bold uppercase tracking-wide text-black/60">
                    {group.categoryLabel}
                  </p>

                  {visibleSymptoms.length > 0 && (
                    <div className="mt-1.5 space-y-1">
                      {visibleSymptoms.map((symptom) => (
                        <p
                          key={symptom}
                          className="text-[13px] font-semibold leading-[18px] text-black/70"
                        >
                          • {symptom}
                        </p>
                      ))}
                    </div>
                  )}

                  {!forceShowAllMechanicalDetails &&
                    group.symptomLabels.length > 2 && (
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          onActiveInteraction?.();
                          setExpandedMechanicalCategories((current) => ({
                            ...current,
                            [group.category]: !current[group.category],
                          }));
                        }}
                        className="mt-1 text-left text-[13px] font-bold leading-[18px] text-orange-600 transition active:scale-[0.98]"
                        aria-expanded={isExpanded}
                      >
                        {isExpanded
                          ? "Arată mai puține"
                          : `+${hiddenSymptoms}`}
                      </button>
                    )}
                </div>
              );
            })}
          </div>
        )}

        {wheelsSummary && wheelsSummary.groups.length > 0 && (
          <div className="mt-4 space-y-3">
            {wheelsSummary.groups.slice(0, 2).map((group) => (
              <div key={group.key}>
                <p className="text-xs font-bold uppercase tracking-wide text-black/60">
                  {group.title}
                </p>
                <div className="mt-1.5 space-y-0.5">
                  {group.serviceLabels.map((serviceLabel) => (
                    <p
                      key={serviceLabel}
                      className="text-[13px] font-semibold leading-[18px] text-black/70"
                    >
                      {serviceLabel}
                    </p>
                  ))}
                </div>
              </div>
            ))}

            {wheelsSummary.groups.length > 2 && (
              <p className="text-[13px] font-bold leading-[18px] text-orange-600">
                + încă {wheelsSummary.groups.length - 2}
              </p>
            )}

            <p className="text-[13px] font-semibold leading-[18px] text-black/60">
              {wheelsSummary.wheelSizeLabel}
            </p>
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
