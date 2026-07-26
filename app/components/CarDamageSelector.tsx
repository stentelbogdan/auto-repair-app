type CarPartOption = {
  value: string;
  label: string;
};

type CarDamageSelectorProps = {
  options: CarPartOption[];
  selectedValues: string[];
  onToggle: (value: string) => void;
};

type PartShape =
  | "default"
  | "wheel"
  | "sill"
  | "front-bumper"
  | "hood"
  | "rear-bumper"
  | "left-mirror"
  | "right-mirror"
  | "windshield"
  | "trunk"
  | "left-front-fender"
  | "right-front-fender"
  | "left-rear-quarter"
  | "right-rear-quarter"
  | "left-door"
  | "right-door";

type PartButtonProps = {
  value: string;
  label: string;
  selectedValues: string[];
  onToggle: (value: string) => void;
  compact?: boolean;
  vertical?: boolean;
  shape?: PartShape;
};

function PartButton({
  value,
  label,
  selectedValues,
  onToggle,
  compact = false,
  vertical = false,
  shape = "default",
}: PartButtonProps) {
  const isSelected = selectedValues.includes(value);

  const handleToggle = () => {
    if (typeof navigator !== "undefined" && "vibrate" in navigator) {
      navigator.vibrate(15);
    }

    onToggle(value);
  };

  const wheelPosition =
    value === "part:left_front_wheel"
      ? "Față st."
      : value === "part:right_front_wheel"
        ? "Față dr."
        : value === "part:left_rear_wheel"
          ? "Spate st."
          : value === "part:right_rear_wheel"
            ? "Spate dr."
            : "";

  const shortLabel =
    value === "part:left_front_fender"
      ? "Aripă față st."
      : value === "part:right_front_fender"
        ? "Aripă față dr."
        : value === "part:left_rear_quarter"
          ? "Aripă spate st."
          : value === "part:right_rear_quarter"
            ? "Aripă spate dr."
            : value === "part:trunk"
              ? "Portbagaj"
              : value === "part:windshield"
                ? "Parbriz"
                : label;

  const shapeClassName =
    shape === "wheel"
      ? "aspect-square rounded-full"
      : shape === "sill"
        ? "rounded-full"
        : shape === "front-bumper"
          ? "rounded-t-[28px] rounded-b-xl"
          : shape === "hood"
            ? "rounded-t-xl rounded-b-[30px]"
            : shape === "rear-bumper"
              ? "rounded-t-xl rounded-b-[28px]"
              : shape === "left-mirror"
                ? "rounded-l-full rounded-r-xl"
                : shape === "right-mirror"
                  ? "rounded-r-full rounded-l-xl"
                  : shape === "windshield"
                    ? "rounded-t-[26px] rounded-b-xl"
                    : shape === "trunk"
                      ? "rounded-t-xl rounded-b-[26px]"
                      : shape === "left-front-fender"
                        ? "rounded-l-[28px] rounded-r-xl"
                        : shape === "right-front-fender"
                          ? "rounded-r-[28px] rounded-l-xl"
                          : shape === "left-rear-quarter"
                            ? "rounded-l-[28px] rounded-r-xl"
                            : shape === "right-rear-quarter"
                              ? "rounded-r-[28px] rounded-l-xl"
                              : shape === "left-door"
                                ? "rounded-l-[22px] rounded-r-xl"
                                : shape === "right-door"
                                  ? "rounded-r-[22px] rounded-l-xl"
                                  : "rounded-2xl";

  return (
    <button
      type="button"
      onClick={handleToggle}
      aria-pressed={isSelected}
      className={`relative flex min-w-0 w-full items-center justify-center border text-center font-semibold transition-all duration-200 ease-out active:scale-[0.97] active:brightness-[0.98] ${shapeClassName} ${
        vertical
          ? "h-full min-h-[160px] px-1 text-[10px]"
          : shape === "wheel"
            ? "h-[58px] w-[58px] min-h-0 shrink-0 p-1 text-[9px]"
            : compact
              ? "min-h-[58px] px-1 text-[10px]"
              : value.includes("fender") || value.includes("rear_quarter")
                ? "min-h-[76px] px-1 text-[11px]"
                : value === "part:trunk"
                  ? "min-h-[76px] px-1 text-[11px]"
                  : "min-h-[76px] px-2 text-xs"
      } ${
        isSelected
          ? "border-orange-600 bg-orange-500 text-black shadow-[0_6px_14px_rgba(249,115,22,0.22)] ring-1 ring-orange-200"
          : "border-black/10 bg-white text-black shadow-sm hover:border-orange-300 hover:shadow-md active:border-orange-400 active:bg-orange-50"
      }`}
    >
      {isSelected && (
        <span
          className={`absolute z-10 flex h-5 w-5 items-center justify-center rounded-full bg-black text-[11px] font-bold text-white shadow-md ring-2 ring-white ${
            vertical ? "left-1/2 top-2 -translate-x-1/2" : "right-2 top-2"
          }`}
        >
          ✓
        </span>
      )}

      {shape === "wheel" ? (
        <span className="flex flex-col items-center justify-center leading-none">
          <span className="text-[10px] font-bold">Jantă</span>

          <span className="mt-1 whitespace-nowrap text-[8px] font-semibold text-black/55">
            {wheelPosition}
          </span>
        </span>
      ) : (
        <span
          className={
            vertical
              ? "[writing-mode:vertical-rl] rotate-180 whitespace-nowrap leading-tight"
              : "min-w-0 whitespace-normal break-normal leading-tight"
          }
        >
          {shortLabel}
        </span>
      )}
    </button>
  );
}

export default function CarDamageSelector({
  options,
  selectedValues,
  onToggle,
}: CarDamageSelectorProps) {
  const getLabel = (value: string) =>
    options.find((option) => option.value === value)?.label || value;

  const renderPart = (
    value: string,
    compact = false,
    vertical = false,
    shape: PartShape = "default",
  ) => (
    <PartButton
      value={value}
      label={getLabel(value)}
      selectedValues={selectedValues}
      onToggle={onToggle}
      compact={compact}
      vertical={vertical}
      shape={shape}
    />
  );

  const selectedParts = options.filter((option) =>
    selectedValues.includes(option.value),
  );

  return (
    <div>
      <div className="w-full min-w-0 overflow-hidden rounded-[24px] border border-black/10 bg-black/[0.025] p-2 sm:p-3">
        {/* Fața mașinii */}
        <p className="mb-2 text-center text-[11px] font-bold uppercase tracking-[0.18em] text-black/35">
          Față
        </p>

        {/* Faruri + bară față */}
        <div className="grid min-w-0 grid-cols-[minmax(0,0.75fr)_minmax(0,2fr)_minmax(0,0.75fr)] gap-1.5">
          {renderPart("part:left_headlight", true)}
          {renderPart("part:front_bumper", false, false, "front-bumper")}
          {renderPart("part:right_headlight", true)}
        </div>

        {/* Jante față + aripi față + capotă */}
        <div className="mt-2 grid min-w-0 grid-cols-[58px_minmax(0,1fr)_minmax(0,1.4fr)_minmax(0,1fr)_58px] items-center gap-1.5">
          {renderPart("part:left_front_wheel", true, false, "wheel")}
          {renderPart(
            "part:left_front_fender",
            false,
            false,
            "left-front-fender",
          )}

          {renderPart("part:hood", false, false, "hood")}

          {renderPart(
            "part:right_front_fender",
            false,
            false,
            "right-front-fender",
          )}
          {renderPart("part:right_front_wheel", true, false, "wheel")}
        </div>

        {/* Oglinzi + parbriz */}
        <div className="mt-2 grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)_minmax(0,1fr)] gap-1.5">
          {renderPart("part:left_mirror", true, false, "left-mirror")}
          {renderPart("part:windshield", true, false, "windshield")}
          {renderPart("part:right_mirror", true, false, "right-mirror")}
        </div>

        {/* Praguri + uși + pavilion + alt element */}
        <div className="mt-2 grid min-w-0 grid-cols-[minmax(0,0.28fr)_minmax(0,1fr)_minmax(0,1.25fr)_minmax(0,1fr)_minmax(0,0.28fr)] grid-rows-2 gap-1.5">
          <div className="row-span-2">
            {renderPart("part:left_sill", false, true, "sill")}
          </div>

          {renderPart("part:left_front_door", false, false, "left-door")}
          {renderPart("part:roof")}
          {renderPart("part:right_front_door", false, false, "right-door")}

          <div className="row-span-2">
            {renderPart("part:right_sill", false, true, "sill")}
          </div>

          {renderPart("part:left_rear_door", false, false, "left-door")}
          {renderPart("part:other")}
          {renderPart("part:right_rear_door", false, false, "right-door")}
        </div>

        {/* Jante spate + aripi spate + portbagaj */}
        <div className="mt-2 grid min-w-0 grid-cols-[58px_minmax(0,1fr)_minmax(0,1.4fr)_minmax(0,1fr)_58px] items-center gap-1.5">
          {renderPart("part:left_rear_wheel", true, false, "wheel")}
          {renderPart(
            "part:left_rear_quarter",
            false,
            false,
            "left-rear-quarter",
          )}
          {renderPart("part:trunk", false, false, "trunk")}
          {renderPart(
            "part:right_rear_quarter",
            false,
            false,
            "right-rear-quarter",
          )}
          {renderPart("part:right_rear_wheel", true, false, "wheel")}
        </div>

        {/* Stopuri + bară spate */}
        <div className="mt-2 grid min-w-0 grid-cols-[minmax(0,0.75fr)_minmax(0,2fr)_minmax(0,0.75fr)] gap-1.5">
          {renderPart("part:left_taillight", true)}
          {renderPart("part:rear_bumper", false, false, "rear-bumper")}
          {renderPart("part:right_taillight", true)}
        </div>

        <p className="mt-3 text-center text-xs text-black/40">
          Atinge din nou un element pentru a-l deselecta.
        </p>
      </div>

      <div className="mt-3 rounded-2xl border border-black/10 bg-white p-3">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-bold text-black">
            Elemente selectate ({selectedParts.length})
          </p>

          {selectedParts.length > 0 && (
            <button
              type="button"
              onClick={() => {
                selectedParts.forEach((part) => onToggle(part.value));
              }}
              className="text-xs font-semibold text-red-600"
            >
              Șterge toate
            </button>
          )}
        </div>

        {selectedParts.length === 0 ? (
          <p className="mt-1 text-sm text-black/45">
            Nu ai selectat încă niciun element.
          </p>
        ) : (
          <div className="mt-3 flex flex-wrap gap-2">
            {selectedParts.map((part) => (
              <button
                key={part.value}
                type="button"
                onClick={() => onToggle(part.value)}
                className="rounded-full bg-orange-100 px-3 py-1.5 text-xs font-semibold text-orange-800 transition active:scale-95"
              >
                {part.label} ×
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
