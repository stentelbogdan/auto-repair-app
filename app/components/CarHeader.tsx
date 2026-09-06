"use client";

import { useState } from "react";
import type { LucideIcon } from "lucide-react";
import ImageGallery from "@/app/components/ImageGallery";
import LicensePlate from "@/app/components/LicensePlate";
import type { MechanicalCategoryId } from "@/lib/mechanical/mechanical-categories";
import type { MechanicalServiceDetailGroup } from "@/lib/mechanical/mechanical-service-details";
import type { TowingDisplaySummary } from "@/lib/towing/towing-display";

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
  supplyLabel?: string;
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
  towingSummary?: TowingDisplaySummary;
  showAllMechanicalDetails?: boolean;
  showAllWheelsDetails?: boolean;
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
  towingSummary,
  showAllMechanicalDetails: forceShowAllMechanicalDetails = false,
  showAllWheelsDetails = false,
  onActiveInteraction,
}: CarHeaderProps) {
  const title = `${brand || "Mașină"} ${model || ""}`.trim();

  const isLarge = variant === "listLarge";

  const [showAllParts, setShowAllParts] = useState(false);
  const [showAllDamages, setShowAllDamages] = useState(false);
  const [expandedMechanicalCategories, setExpandedMechanicalCategories] =
    useState<Partial<Record<MechanicalCategoryId, boolean>>>({});
  const [expandedWheelsSections, setExpandedWheelsSections] = useState<
    Partial<Record<"tire" | "rim", boolean>>
  >({});

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
            {showAllWheelsDetails
              ? wheelsSummary.groups.map(renderWheelsGroup)
              : (["tire", "rim"] as const).map((component) => {
                  const sectionGroups = wheelsSummary.groups.filter((group) =>
                    group.key.endsWith(`-${component}`),
                  );

                  if (sectionGroups.length === 0) return null;

                  const isExpanded = Boolean(
                    expandedWheelsSections[component],
                  );
                  const visibleGroups = isExpanded
                    ? sectionGroups
                    : sectionGroups.slice(0, 1);
                  const hiddenGroups = Math.max(
                    0,
                    sectionGroups.length - visibleGroups.length,
                  );

                  return (
                    <div key={component} className="space-y-3">
                      {visibleGroups.map(renderWheelsGroup)}
                      {sectionGroups.length > 1 && (
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            onActiveInteraction?.();
                            setExpandedWheelsSections((current) => ({
                              ...current,
                              [component]: !current[component],
                            }));
                          }}
                          className="text-left text-[13px] font-bold leading-[18px] text-orange-600 transition active:scale-[0.98]"
                          aria-expanded={isExpanded}
                        >
                          {isExpanded
                            ? "Arată mai puțin"
                            : `+ încă ${hiddenGroups}`}
                        </button>
                      )}
                    </div>
                  );
                })}

            <p className="text-[13px] font-semibold leading-[18px] text-black/60">
              {wheelsSummary.wheelSizeLabel}
            </p>
          </div>
        )}

        {towingSummary && (
          <div className="mt-4 space-y-3">
            <TowingLocation label="Preluare" location={towingSummary.pickup} />
            <TowingLocation
              label="Destinație"
              location={towingSummary.destination}
            />
            {towingSummary.route && (
              <TowingDetail
                label="Traseu"
                value={`${towingSummary.route.distanceLabel} · ${towingSummary.route.durationLabel}`}
              />
            )}
            <TowingDetail label="Motiv" value={towingSummary.reasonLabel} />
            <div>
              <p className="text-[13px] font-bold uppercase tracking-wide text-orange-600">
                Stare vehicul
              </p>
              <div className="mt-1.5 space-y-0.5">
                {[
                  towingSummary.startsLabel,
                  towingSummary.canBePushedLabel,
                  towingSummary.wheelsLabel,
                ].map((label) => (
                  <p
                    key={label}
                    className="text-[13px] font-semibold leading-[18px] text-black/70"
                  >
                    {label}
                  </p>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function TowingLocation({
  label,
  location,
}: {
  label: string;
  location: TowingDisplaySummary["pickup"];
}) {
  return (
    <div>
      <p className="text-[13px] font-bold uppercase tracking-wide text-orange-600">
        {label}
      </p>
      <p className="mt-1.5 text-[13px] font-semibold leading-[18px] text-black/70">
        {location.address}
      </p>
      <p className="text-[12px] font-semibold leading-[17px] text-black/50">
        {location.city}
      </p>
    </div>
  );
}

function TowingDetail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[13px] font-bold uppercase tracking-wide text-orange-600">
        {label}
      </p>
      <p className="mt-1.5 text-[13px] font-semibold leading-[18px] text-black/70">
        {value}
      </p>
    </div>
  );
}

function renderWheelsGroup(group: WheelsServiceDetailGroup) {
  return (
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
      {group.supplyLabel && (
        <p className="mt-1 text-[12px] font-semibold leading-[17px] text-orange-600">
          {group.supplyLabel}
        </p>
      )}
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
