import { Check, ChevronDown, X } from "lucide-react";
import { ReactNode } from "react";

type ServiceCardProps = {
  title: string;
  icon: string;
  description: string;
  isActive: boolean;
  isExpanded: boolean;
  onToggle: () => void;
  onRemove: () => void;
  children?: ReactNode;
};

export default function ServiceCard({
  title,
  icon,
  description,
  isActive,
  isExpanded,
  onToggle,
  onRemove,
  children,
}: ServiceCardProps) {
  return (
    <div>
      <div
        className={`relative overflow-hidden rounded-2xl border transition ${
          isActive
            ? "border-orange-400 bg-orange-50 shadow-sm"
            : "border-black/10 bg-black/[0.03] hover:border-orange-300"
        }`}
      >
        <button
          type="button"
          onClick={onToggle}
          className="w-full p-4 pr-14 text-left transition active:scale-[0.99]"
          aria-expanded={isExpanded}
        >
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white text-2xl shadow-sm">
              {icon}
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-bold text-black">{title}</p>

                {isActive && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-orange-500 px-2.5 py-1 text-[11px] font-bold text-black">
                    <Check size={13} strokeWidth={3} />
                    Selectat
                  </span>
                )}
              </div>

              <p className="mt-1 text-sm text-black/55">{description}</p>
            </div>
          </div>
        </button>

        <div className="absolute right-3 top-3 flex items-center gap-1">
          {isActive && (
            <button
              type="button"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onRemove();
              }}
              className="flex h-8 w-8 items-center justify-center rounded-full bg-white text-black/50 shadow-sm transition hover:bg-red-50 hover:text-red-600 active:scale-90"
              aria-label={`Elimină serviciul ${title}`}
              title="Elimină serviciul"
            >
              <X size={17} />
            </button>
          )}

          <ChevronDown
            size={20}
            className={`pointer-events-none text-black/45 transition-transform duration-200 ${
              isExpanded ? "rotate-180" : ""
            }`}
          />
        </div>
      </div>

      {isExpanded && children}
    </div>
  );
}