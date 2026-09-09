"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, X } from "lucide-react";

const ITEM_HEIGHT = 52;
const hours = Array.from({ length: 24 }, (_, index) =>
  String(index).padStart(2, "0"),
);
const minutes = ["00", "15", "30", "45"];

type TimeWheelPickerProps = {
  date: string;
  value: string;
  onChange: (value: string) => void;
  isTimeDisabled?: (value: string) => boolean;
};

export default function TimeWheelPicker({
  date,
  value,
  onChange,
  isTimeDisabled = () => false,
}: TimeWheelPickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [draftHour, setDraftHour] = useState("00");
  const [draftMinute, setDraftMinute] = useState("00");
  const [error, setError] = useState("");
  const hourRef = useRef<HTMLDivElement>(null);
  const minuteRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsOpen(false);
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  const openPicker = () => {
    const initialTime = value || getNextQuarterHour();
    const [initialHour, initialMinute] = initialTime.split(":");
    const normalizedHour = hours.includes(initialHour) ? initialHour : "00";
    const normalizedMinute = getNearestMinute(initialMinute);

    setDraftHour(normalizedHour);
    setDraftMinute(normalizedMinute);
    setError("");
    setIsOpen(true);

    requestAnimationFrame(() => {
      hourRef.current?.scrollTo({
        top: hours.indexOf(normalizedHour) * ITEM_HEIGHT,
      });
      minuteRef.current?.scrollTo({
        top: minutes.indexOf(normalizedMinute) * ITEM_HEIGHT,
      });
    });
  };

  const confirmTime = () => {
    const nextTime = `${draftHour}:${draftMinute}`;

    if (date && isTimeDisabled(nextTime)) {
      setError("Ora selectată nu este disponibilă.");
      return;
    }

    onChange(nextTime);
    setIsOpen(false);
  };

  return (
    <>
      <button
        type="button"
        onClick={openPicker}
        className="flex h-14 w-full items-center justify-between rounded-2xl border border-black/10 bg-black/[0.03] px-4 text-left transition active:scale-[0.99]"
      >
        <span className={value ? "font-black text-black" : "text-black/45"}>
          {value || "Alege ora"}
        </span>
        <span className="text-sm font-bold text-orange-600">Editează</span>
      </button>

      {isOpen &&
        createPortal(
          <div
            className="fixed inset-0 z-[1200] flex items-end justify-center bg-black/65 px-3 pb-[max(12px,env(safe-area-inset-bottom))] backdrop-blur-sm sm:items-center"
            role="dialog"
            aria-modal="true"
            aria-labelledby="time-wheel-title"
          >
            <div className="w-full max-w-md overflow-hidden rounded-[28px] border border-white/10 bg-[#171717] text-white shadow-2xl">
              <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
                <button
                  type="button"
                  onClick={() => setIsOpen(false)}
                  aria-label="Anulează selectarea orei"
                  className="flex h-11 w-11 items-center justify-center rounded-full bg-white/5 text-white/75 transition active:scale-95"
                >
                  <X size={21} strokeWidth={2.5} />
                </button>

                <h2 id="time-wheel-title" className="text-base font-black">
                  Editează ora
                </h2>

                <button
                  type="button"
                  onClick={confirmTime}
                  aria-label="Confirmă ora"
                  className="flex h-11 w-11 items-center justify-center rounded-full bg-orange-500 text-black transition active:scale-95"
                >
                  <Check size={22} strokeWidth={3} />
                </button>
              </div>

              <div className="px-5 pb-5 pt-4">
                <div className="mb-2 grid grid-cols-2 text-center text-[11px] font-bold uppercase tracking-[0.18em] text-white/40">
                  <span>Oră</span>
                  <span>Minute</span>
                </div>

                <div className="relative grid grid-cols-2 gap-3">
                  <div className="pointer-events-none absolute inset-x-0 top-1/2 h-[52px] -translate-y-1/2 rounded-2xl border border-white/10 bg-white/[0.07]" />
                  <WheelColumn
                    scrollRef={hourRef}
                    values={hours}
                    selectedValue={draftHour}
                    onChange={(nextHour) => {
                      setDraftHour(nextHour);
                      setError("");
                    }}
                  />
                  <WheelColumn
                    scrollRef={minuteRef}
                    values={minutes}
                    selectedValue={draftMinute}
                    onChange={(nextMinute) => {
                      setDraftMinute(nextMinute);
                      setError("");
                    }}
                  />
                </div>

                {error && (
                  <p
                    className="mt-3 text-center text-sm font-semibold text-red-400"
                    aria-live="polite"
                  >
                    {error}
                  </p>
                )}
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}

type WheelColumnProps = {
  values: readonly string[];
  selectedValue: string;
  onChange: (value: string) => void;
  scrollRef: React.RefObject<HTMLDivElement | null>;
};

const WheelColumn = function WheelColumn({
  values,
  selectedValue,
  onChange,
  scrollRef,
}: WheelColumnProps) {
  return (
    <div
      ref={scrollRef}
      onScroll={(event) => {
        const index = Math.max(
          0,
          Math.min(
            values.length - 1,
            Math.round(event.currentTarget.scrollTop / ITEM_HEIGHT),
          ),
        );
        onChange(values[index]);
      }}
      className="relative z-10 h-[260px] snap-y snap-mandatory overflow-y-auto scroll-smooth overscroll-contain py-[104px] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {values.map((item) => {
        const isSelected = item === selectedValue;

        return (
          <button
            key={item}
            type="button"
            tabIndex={-1}
            onClick={() => {
              onChange(item);
              scrollRef.current?.scrollTo({
                top: values.indexOf(item) * ITEM_HEIGHT,
                behavior: "smooth",
              });
            }}
            className={`flex h-[52px] w-full snap-center items-center justify-center text-3xl font-black transition-opacity ${
              isSelected ? "text-white opacity-100" : "text-white/35"
            }`}
          >
            {item}
          </button>
        );
      })}
    </div>
  );
};

function getNextQuarterHour() {
  const date = new Date();
  date.setSeconds(0, 0);
  date.setMinutes(Math.ceil((date.getMinutes() + 1) / 15) * 15);

  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function getNearestMinute(value: string) {
  const minute = Number(value);

  if (!Number.isFinite(minute)) return "00";

  return minutes.reduce((nearest, candidate) =>
    Math.abs(Number(candidate) - minute) < Math.abs(Number(nearest) - minute)
      ? candidate
      : nearest,
  );
}
