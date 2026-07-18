type CarPartOption = {
  value: string;
  label: string;
};

type CarPartSelectorProps = {
  options: CarPartOption[];
  selectedValues: string[];
  onToggle: (value: string) => void;
};

type InteractivePartProps = {
  value: string;
  label: string;
  selected: boolean;
  onToggle: (value: string) => void;
  children: React.ReactNode;
};

function InteractivePart({
  value,
  label,
  selected,
  onToggle,
  children,
}: InteractivePartProps) {
  const handleSelect = () => {
    onToggle(value);
  };

  return (
    <g
      role="button"
      tabIndex={0}
      aria-label={label}
      aria-pressed={selected}
      onClick={handleSelect}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          handleSelect();
        }
      }}
      className="cursor-pointer outline-none"
    >
      <title>{label}</title>

      <g
        className={`transition-colors duration-200 ${
          selected
            ? "fill-orange-500 stroke-orange-700"
            : "fill-white stroke-black/25 hover:fill-orange-100"
        }`}
      >
        {children}
      </g>
    </g>
  );
}

export default function CarPartSelector({
  options,
  selectedValues,
  onToggle,
}: CarPartSelectorProps) {
  const getLabel = (value: string) =>
    options.find((option) => option.value === value)?.label || value;

  const isSelected = (value: string) => selectedValues.includes(value);

  const selectedParts = options.filter((option) =>
    selectedValues.includes(option.value),
  );

  return (
    <div>
      <div className="overflow-hidden rounded-[22px] border border-black/10 bg-white p-3">
        <p className="mb-3 text-center text-xs font-medium text-black/45">
          Fața mașinii
        </p>

        <svg
          viewBox="0 0 320 620"
          className="mx-auto h-auto w-full max-w-[340px] touch-manipulation"
          aria-label="Selector interactiv pentru elementele mașinii"
        >
          {/* Umbra mașinii */}
          <rect
            x="58"
            y="20"
            width="204"
            height="580"
            rx="82"
            className="fill-black/[0.04]"
          />

          {/* Bară față */}
          <InteractivePart
            value="part:front_bumper"
            label={getLabel("part:front_bumper")}
            selected={isSelected("part:front_bumper")}
            onToggle={onToggle}
          >
            <path
              d="M94 42 Q160 16 226 42 L240 74 Q160 58 80 74 Z"
              strokeWidth="3"
            />
          </InteractivePart>

          {/* Capotă */}
          <InteractivePart
            value="part:hood"
            label={getLabel("part:hood")}
            selected={isSelected("part:hood")}
            onToggle={onToggle}
          >
            <path
              d="M92 78 Q160 62 228 78 L218 190 Q160 174 102 190 Z"
              strokeWidth="3"
            />
          </InteractivePart>

          {/* Aripă față stânga */}
          <InteractivePart
            value="part:left_front_fender"
            label={getLabel("part:left_front_fender")}
            selected={isSelected("part:left_front_fender")}
            onToggle={onToggle}
          >
            <path
              d="M74 78 L98 78 L104 190 L72 206 Q60 145 74 78 Z"
              strokeWidth="3"
            />
          </InteractivePart>

          {/* Aripă față dreapta */}
          <InteractivePart
            value="part:right_front_fender"
            label={getLabel("part:right_front_fender")}
            selected={isSelected("part:right_front_fender")}
            onToggle={onToggle}
          >
            <path
              d="M222 78 L246 78 Q260 145 248 206 L216 190 Z"
              strokeWidth="3"
            />
          </InteractivePart>

          {/* Ușă față stânga */}
          <InteractivePart
            value="part:left_front_door"
            label={getLabel("part:left_front_door")}
            selected={isSelected("part:left_front_door")}
            onToggle={onToggle}
          >
            <path
              d="M72 210 L108 194 L108 318 L68 318 Q64 263 72 210 Z"
              strokeWidth="3"
            />
          </InteractivePart>

          {/* Ușă față dreapta */}
          <InteractivePart
            value="part:right_front_door"
            label={getLabel("part:right_front_door")}
            selected={isSelected("part:right_front_door")}
            onToggle={onToggle}
          >
            <path
              d="M212 194 L248 210 Q256 263 252 318 L212 318 Z"
              strokeWidth="3"
            />
          </InteractivePart>

          {/* Pavilion */}
          <InteractivePart
            value="part:roof"
            label={getLabel("part:roof")}
            selected={isSelected("part:roof")}
            onToggle={onToggle}
          >
            <path
              d="M112 194 Q160 174 208 194 L208 430 Q160 446 112 430 Z"
              strokeWidth="3"
            />
          </InteractivePart>

          {/* Ușă spate stânga */}
          <InteractivePart
            value="part:left_rear_door"
            label={getLabel("part:left_rear_door")}
            selected={isSelected("part:left_rear_door")}
            onToggle={onToggle}
          >
            <path
              d="M68 324 L108 324 L108 432 L74 414 Q65 370 68 324 Z"
              strokeWidth="3"
            />
          </InteractivePart>

          {/* Ușă spate dreapta */}
          <InteractivePart
            value="part:right_rear_door"
            label={getLabel("part:right_rear_door")}
            selected={isSelected("part:right_rear_door")}
            onToggle={onToggle}
          >
            <path
              d="M212 324 L252 324 Q255 370 246 414 L212 432 Z"
              strokeWidth="3"
            />
          </InteractivePart>

          {/* Aripă spate stânga */}
          <InteractivePart
            value="part:left_rear_quarter"
            label={getLabel("part:left_rear_quarter")}
            selected={isSelected("part:left_rear_quarter")}
            onToggle={onToggle}
          >
            <path
              d="M74 420 L108 438 L100 520 L76 520 Q62 470 74 420 Z"
              strokeWidth="3"
            />
          </InteractivePart>

          {/* Aripă spate dreapta */}
          <InteractivePart
            value="part:right_rear_quarter"
            label={getLabel("part:right_rear_quarter")}
            selected={isSelected("part:right_rear_quarter")}
            onToggle={onToggle}
          >
            <path
              d="M212 438 L246 420 Q258 470 244 520 L220 520 Z"
              strokeWidth="3"
            />
          </InteractivePart>

          {/* Portbagaj */}
          <InteractivePart
            value="part:trunk"
            label={getLabel("part:trunk")}
            selected={isSelected("part:trunk")}
            onToggle={onToggle}
          >
            <path
              d="M108 440 Q160 456 212 440 L220 522 Q160 538 100 522 Z"
              strokeWidth="3"
            />
          </InteractivePart>

          {/* Bară spate */}
          <InteractivePart
            value="part:rear_bumper"
            label={getLabel("part:rear_bumper")}
            selected={isSelected("part:rear_bumper")}
            onToggle={onToggle}
          >
            <path
              d="M80 526 Q160 544 240 526 L226 576 Q160 602 94 576 Z"
              strokeWidth="3"
            />
          </InteractivePart>

          {/* Contur general */}
          <path
            d="M94 36
               Q160 10 226 36
               Q262 110 252 210
               Q264 310 252 414
               Q258 510 226 582
               Q160 610 94 582
               Q62 510 68 414
               Q56 310 68 210
               Q58 110 94 36 Z"
            className="pointer-events-none fill-none stroke-black/35"
            strokeWidth="4"
          />
        </svg>

        <p className="mt-3 text-center text-xs text-black/45">
          Atinge din nou un element pentru a-l deselecta.
        </p>
      </div>

      {selectedParts.length > 0 && (
        <div className="mt-3">
          <p className="mb-2 text-sm font-semibold text-black">
            Elemente selectate
          </p>

          <div className="flex flex-wrap gap-2">
            {selectedParts.map((part) => (
              <button
                key={part.value}
                type="button"
                onClick={() => onToggle(part.value)}
                className="rounded-full bg-orange-500 px-3 py-1.5 text-xs font-bold text-black transition active:scale-95"
              >
                {part.label} ×
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}