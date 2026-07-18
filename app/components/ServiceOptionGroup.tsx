type ServiceDetailOption = {
  value: string;
  label: string;
};

type ServiceOptionGroupProps = {
  title: string;
  description: string;
  options: ServiceDetailOption[];
  selectedValues: string[];
  onToggle: (value: string) => void;
};

export default function ServiceOptionGroup({
  title,
  description,
  options,
  selectedValues,
  onToggle,
}: ServiceOptionGroupProps) {
  return (
    <div>
      <p className="text-sm font-bold text-black">{title}</p>

      <p className="mt-1 text-xs text-black/55">{description}</p>

      <div className="mt-4 space-y-2">
        {options.map((option) => {
          const isSelected = selectedValues.includes(option.value);

          return (
            <button
              key={option.value}
              type="button"
              onClick={() => onToggle(option.value)}
              aria-pressed={isSelected}
              className={`flex w-full items-center justify-between rounded-2xl border px-4 py-3 text-left text-sm font-semibold transition active:scale-[0.99] ${
                isSelected
                  ? "border-orange-500 bg-orange-500 text-black"
                  : "border-black/10 bg-white text-black"
              }`}
            >
              <span>{option.label}</span>

              <span
                className={`flex h-6 w-6 items-center justify-center rounded-full border text-xs ${
                  isSelected
                    ? "border-black bg-black text-white"
                    : "border-black/15 bg-white text-transparent"
                }`}
              >
                ✓
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}