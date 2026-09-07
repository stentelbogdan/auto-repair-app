"use client";

import TimeWheelPicker from "@/app/components/TimeWheelPicker";

type AppointmentDateTimePickerProps = {
  date: string;
  dateInput: string;
  dateError: string;
  time: string;
  timeSlots?: readonly string[];
  timeSelectionMode?: "grid" | "wheel";
  disabledTimes?: readonly string[];
  loadingTimes?: boolean;
  minDate: string;
  onDateChange: (date: string) => void;
  onDateInputChange: (value: string) => void;
  onDateErrorChange: (error: string) => void;
  onTimeChange: (time: string) => void;
};

export default function AppointmentDateTimePicker({
  date,
  dateInput,
  dateError,
  time,
  timeSlots = [],
  timeSelectionMode = "grid",
  disabledTimes = [],
  loadingTimes = false,
  minDate,
  onDateChange,
  onDateInputChange,
  onDateErrorChange,
  onTimeChange,
}: AppointmentDateTimePickerProps) {
  const handleManualDateChange = (inputValue: string) => {
    let value = inputValue.replace(/\D/g, "");

    if (value.length > 8) value = value.slice(0, 8);

    let formatted = value;

    if (value.length >= 3) {
      formatted = `${value.slice(0, 2)}.${value.slice(2)}`;
    }

    if (value.length >= 5) {
      formatted = `${value.slice(0, 2)}.${value.slice(2, 4)}.${value.slice(4)}`;
    }

    onDateInputChange(formatted);
    onDateErrorChange("");

    const dayText = value.slice(0, 2);
    const monthText = value.slice(2, 4);

    if (dayText.length === 2) {
      const day = Number(dayText);

      if (day < 1 || day > 31) {
        onDateErrorChange("Introdu o dată validă.");
        onDateChange("");
        return;
      }
    }

    if (monthText.length === 2) {
      const month = Number(monthText);

      if (month < 1 || month > 12) {
        onDateErrorChange("Introdu o dată validă.");
        onDateChange("");
        return;
      }
    }

    if (value.length === 8) {
      const day = Number(value.slice(0, 2));
      const month = Number(value.slice(2, 4));
      const year = Number(value.slice(4, 8));

      const selectedDate = new Date(year, month - 1, day);
      const isRealDate =
        selectedDate.getFullYear() === year &&
        selectedDate.getMonth() === month - 1 &&
        selectedDate.getDate() === day;

      if (
        day < 1 ||
        day > 31 ||
        month < 1 ||
        month > 12 ||
        year < new Date().getFullYear() ||
        year > 2100 ||
        !isRealDate
      ) {
        onDateErrorChange("Introdu o dată validă.");
        onDateChange("");
        return;
      }

      const isoDate = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

      if (isoDate < toLocalDateValue(new Date())) {
        onDateErrorChange("Data nu poate fi în trecut.");
        onDateChange("");
        return;
      }

      onDateChange(isoDate);
    }
  };

  const handleCalendarDateChange = (isoDate: string) => {
    onDateErrorChange("");

    if (isoDate && isoDate < toLocalDateValue(new Date())) {
      onDateErrorChange("Data nu poate fi în trecut.");
      onDateChange("");
      return;
    }

    onDateChange(isoDate);
    onDateInputChange(isoDate.split("-").reverse().join("."));
  };

  return (
    <div className="overflow-hidden rounded-[26px] bg-white p-5 text-black">
      <label className="text-sm font-bold text-black/70">Data</label>

      <div className="relative mt-2">
        <input
          type="text"
          inputMode="numeric"
          placeholder="zz.ll.aaaa"
          value={dateInput}
          onChange={(event) => handleManualDateChange(event.target.value)}
          className={`h-14 w-full rounded-2xl border px-4 pr-14 text-base outline-none transition-colors ${
            dateError
              ? "border-red-500 ring-2 ring-red-100 bg-red-50"
              : "border-black/10 bg-white"
          }`}
        />

        <div className="absolute right-4 top-1/2 h-8 w-8 -translate-y-1/2">
          <div
            className={`pointer-events-none absolute inset-0 flex items-center justify-center text-xl ${
              dateError ? "text-red-500" : "text-black/60"
            }`}
          >
            📅
          </div>

          <input
            type="date"
            min={minDate}
            value={date}
            onChange={(event) => handleCalendarDateChange(event.target.value)}
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          />
        </div>
      </div>

      {dateError && (
        <p className="mt-2 text-xs font-semibold text-red-500">{dateError}</p>
      )}

      <label className="mt-5 block text-sm font-bold text-black/70">Ora</label>

      <div className="mt-3">
        {timeSelectionMode === "wheel" ? (
          <TimeWheelPicker
            date={date}
            value={time}
            onChange={onTimeChange}
            isTimeDisabled={(candidateTime) =>
              isPastDateTime(date, candidateTime, new Date())
            }
          />
        ) : (
          <div className="grid grid-cols-3 gap-2">
            {timeSlots.map((slot) => {
              const isDisabled = disabledTimes.includes(slot);
              const isPast = isPastDateTime(date, slot, new Date());

              return (
                <button
                  key={slot}
                  type="button"
                  disabled={!date || isDisabled || isPast || loadingTimes}
                  onClick={() => onTimeChange(slot)}
                  className={`rounded-2xl px-4 py-3 text-sm font-black transition ${
                    time === slot
                      ? "bg-orange-500 text-black"
                      : isDisabled
                        ? "cursor-not-allowed bg-black/10 text-black/30 line-through"
                        : !date || isPast || loadingTimes
                          ? "cursor-not-allowed bg-black/[0.04] text-black/30"
                          : "bg-black/[0.05] text-black"
                  }`}
                >
                  {slot}
                  {isDisabled && (
                    <span className="block text-[10px]">Ocupat</span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export function toLocalDateValue(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

export function toLocalDateTime(dateValue: string, timeValue: string) {
  const [year, month, day] = dateValue.split("-").map(Number);
  const [hour, minute] = timeValue.split(":").map(Number);

  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day) ||
    !Number.isInteger(hour) ||
    !Number.isInteger(minute)
  ) {
    return null;
  }

  const date = new Date(year, month - 1, day, hour, minute, 0, 0);

  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day ||
    date.getHours() !== hour ||
    date.getMinutes() !== minute
  ) {
    return null;
  }

  return date;
}

export function isPastDateTime(
  dateValue: string,
  timeValue: string,
  now: Date,
) {
  if (!dateValue) return false;

  const dateTime = toLocalDateTime(dateValue, timeValue);
  return dateTime ? dateTime.getTime() <= now.getTime() : false;
}
