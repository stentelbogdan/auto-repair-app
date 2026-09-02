"use client";

export type RequestCategoryFilter =
  | "all"
  | "bodywork"
  | "mechanical"
  | "wheels"
  | "towing";

export type RequestCategoryCounts = Record<RequestCategoryFilter, number>;

type RequestCategoryFilterProps = {
  activeCategory: RequestCategoryFilter;
  counts: RequestCategoryCounts;
  onChange: (category: RequestCategoryFilter) => void;
};

const REQUEST_CATEGORY_FILTERS: Array<{
  value: RequestCategoryFilter;
  ariaLabel: string;
  Icon: typeof AllRequestsIcon;
}> = [
  { value: "all", ariaLabel: "Toate", Icon: AllRequestsIcon },
  {
    value: "bodywork",
    ariaLabel: "Daune estetice",
    Icon: BodyworkRequestsIcon,
  },
  {
    value: "mechanical",
    ariaLabel: "Probleme mecanice",
    Icon: MechanicalRequestsIcon,
  },
  {
    value: "wheels",
    ariaLabel: "Roți și anvelope",
    Icon: WheelsRequestsIcon,
  },
  { value: "towing", ariaLabel: "Tractări", Icon: TowingRequestsIcon },
];

export default function RequestCategoryFilter({
  activeCategory,
  counts,
  onChange,
}: RequestCategoryFilterProps) {
  return (
    <div className="grid w-full grid-cols-5 gap-1 pb-1 sm:gap-2">
      {REQUEST_CATEGORY_FILTERS.map((filter) => {
        const isActive = activeCategory === filter.value;
        const Icon = filter.Icon;

        return (
          <button
            key={filter.value}
            type="button"
            onClick={() => onChange(filter.value)}
            className={`flex h-[78px] min-w-0 flex-col items-center justify-center gap-[6px] rounded-[18px] border outline-none transition active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-orange-400/70 focus-visible:ring-offset-2 focus-visible:ring-offset-black ${
              isActive
                ? "border-orange-400/80 bg-orange-500/[0.09] text-orange-400 shadow-[0_0_18px_rgba(249,115,22,0.12)]"
                : "border-white/10 bg-white/[0.035] text-white/75 hover:border-white/20 hover:bg-white/[0.06] hover:text-white"
            }`}
            aria-pressed={isActive}
            aria-label={filter.ariaLabel}
          >
            <Icon
              className={`h-9 w-9 ${
                isActive
                  ? "text-orange-400 [filter:drop-shadow(0_0_1.5px_rgba(249,115,22,0.4))]"
                  : "text-white [filter:drop-shadow(0_0_1.5px_rgba(255,255,255,0.45))]"
              }`}
            />
            <span className="text-[11px] font-bold leading-none">
              ({counts[filter.value]})
            </span>
          </button>
        );
      })}
    </div>
  );
}

type RequestFilterIconProps = {
  className?: string;
};

function AllRequestsIcon({ className }: RequestFilterIconProps) {
  return (
    <svg
      viewBox="0 0 64 64"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <rect x="13" y="13" width="15" height="15" rx="3.5" />
      <rect x="36" y="13" width="15" height="15" rx="3.5" />
      <rect x="13" y="36" width="15" height="15" rx="3.5" />
      <rect x="36" y="36" width="15" height="15" rx="3.5" />
    </svg>
  );
}

function BodyworkRequestsIcon({ className }: RequestFilterIconProps) {
  return (
    <svg
      viewBox="0 0 64 64"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M5 49V35l8-15h23l7 13v16" />
      <path d="M11 31h27M9 39l9 2h18l5-3" />
      <path d="M13 42h24l-3 7H17z" />
      <circle cx="25" cy="45.5" r="2.2" />
      <path d="M8 49h34M8 44H5M42 44h-3M8 49v5M39 49v5" />

      <ellipse cx="52" cy="8" rx="7" ry="3" />
      <path d="M45 8v11c0 4 3 7 7 8 4-1 7-4 7-8V8" />
      <path d="M49 27v4M55 27v4" />
      <rect x="45" y="30" width="15" height="9" rx="2" />
      <path d="M40 32h5v5h-5l-3-1v-3zM52 39l4 15h-6l-3-15" />
      <path d="M34 31l-4-2M34 35h-5M34 39l-4 2" />
    </svg>
  );
}

function MechanicalRequestsIcon({ className }: RequestFilterIconProps) {
  return (
    <svg
      viewBox="0 0 64 64"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M5 48V31l8-18c1-3 4-5 8-5h19c4 0 7 2 8 5l7 18v17" />
      <path d="M11 29h38M10 38l10 3h17l10-3" />
      <path d="M18 42h20l-3 7H21z" />
      <circle cx="28" cy="45.5" r="2.2" />
      <path d="M8 48h39M8 43H5M47 43h-4M8 48v5M44 48v5" />
      <path d="M31 10l-4 6 6 2-4 6 8 3" />

      <path d="M49 29a11 11 0 0 0 12 15l-8-1-20 20a6 6 0 0 1-8-8l20-20-1-8a11 11 0 0 0 15 12l-7 7-7-1-1-7z" />
    </svg>
  );
}

function WheelsRequestsIcon({ className }: RequestFilterIconProps) {
  return (
    <svg
      viewBox="0 0 64 64"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <circle cx="43" cy="32" r="21" />
      <circle cx="43" cy="32" r="16" />
      <circle cx="43" cy="32" r="4" />
      <path d="M43 16v10M43 38v10M27 32h10M49 32h10" />
      <path d="M31.7 20.7l7.1 7.1M47.2 36.2l7.1 7.1M54.3 20.7l-7.1 7.1M38.8 36.2l-7.1 7.1" />

      <rect x="3" y="22" width="14" height="11" rx="1.5" />
      <path d="M17 25h8v5h-8M25 26.5h7M8 33v13c0 5-3 8-7 8" />
      <path d="M6 33h7l-2 11H7" />
    </svg>
  );
}

function TowingRequestsIcon({ className }: RequestFilterIconProps) {
  return (
    <svg
      viewBox="0 0 64 64"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M3 42h38v10H3z" />
      <path d="M41 23h12l8 12v17H41z" />
      <path d="M47 12h7l3 11H44z" />
      <path d="M46 28h8l5 8H46zM55 43h6" />

      <path d="M5 38V27l6-8h17l8 8h4v11" />
      <path d="M12 27h18M7 34h4M34 34h4" />
      <circle cx="12" cy="38" r="4" />
      <circle cx="34" cy="38" r="4" />

      <path d="M3 47h8M39 47h3" />
      <circle cx="18" cy="52" r="5" />
      <circle cx="51" cy="52" r="5" />
    </svg>
  );
}
