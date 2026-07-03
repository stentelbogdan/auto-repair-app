"use client";

import { useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";

const availableHours = [
  "08:00",
  "09:00",
  "10:00",
  "11:00",
  "13:00",
  "14:00",
  "15:00",
  "16:00",
  "17:00",
];

const busyHoursByDate: Record<string, string[]> = {
  // Exemplu: "2026-07-03": ["09:00", "14:00"],
};

export default function WorkshopRequestCalendarPage() {
  const router = useRouter();
  const params = useParams();
  const requestId = params.id as string;

  const today = new Date();
  const [selectedDate, setSelectedDate] = useState(toInputDate(today));
  const [selectedTime, setSelectedTime] = useState("");

  const days = useMemo(() => {
    return Array.from({ length: 14 }).map((_, index) => {
      const date = new Date();
      date.setDate(today.getDate() + index);
      return date;
    });
  }, []);

  const busyHours = busyHoursByDate[selectedDate] || [];

  const continueToOffer = () => {
    if (!selectedDate || !selectedTime) {
      alert("Alege o zi și o oră disponibilă.");
      return;
    }

    sessionStorage.setItem(
      `availability-${requestId}`,
      JSON.stringify({
        date: selectedDate,
        time: selectedTime,
      }),
    );

    router.push(`/workshops/${requestId}`);
  };

  return (
    <main className="min-h-screen bg-black px-4 py-8 text-white">
      <div className="mx-auto max-w-md">
        <button
          onClick={() => router.push(`/workshops/${requestId}`)}
          className="mb-6 rounded-full border border-white/15 px-4 py-2 text-sm text-white/80"
        >
          Înapoi
        </button>

        <p className="text-[11px] uppercase tracking-[0.26em] text-orange-400">
          Calendar service
        </p>

        <h1 className="mt-3 text-3xl font-black leading-tight">
          Alege data și ora
        </h1>

        <p className="mt-2 text-sm leading-6 text-white/55">
          Selectează prima disponibilitate pe care o vei trimite clientului în
          ofertă.
        </p>

        <section className="mt-6 rounded-[30px] border border-white/10 bg-white/[0.04] p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-bold">Următoarele 14 zile</h2>
            <span className="rounded-full bg-orange-500/15 px-3 py-1 text-xs font-bold text-orange-300">
              Disponibilitate
            </span>
          </div>

          <div className="grid grid-cols-4 gap-2">
            {days.map((day) => {
              const value = toInputDate(day);
              const isSelected = value === selectedDate;

              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => {
                    setSelectedDate(value);
                    setSelectedTime("");
                  }}
                  className={`rounded-2xl px-3 py-3 text-center transition active:scale-[0.98] ${
                    isSelected
                      ? "bg-orange-500 text-white"
                      : "bg-white/10 text-white hover:bg-white/15"
                  }`}
                >
                  <p className="text-[10px] font-bold uppercase text-white/70">
                    {formatWeekday(day)}
                  </p>
                  <p className="mt-1 text-xl font-black">{day.getDate()}</p>
                  <p className="text-[10px] text-white/70">
                    {formatMonth(day)}
                  </p>
                </button>
              );
            })}
          </div>
        </section>

        <section className="mt-5 rounded-[30px] border border-white/10 bg-white/[0.04] p-5">
          <h2 className="text-lg font-bold">Ore disponibile</h2>

          <div className="mt-4 grid grid-cols-3 gap-2">
            {availableHours.map((hour) => {
              const isBusy = busyHours.includes(hour);
              const isSelected = selectedTime === hour;

              return (
                <button
                  key={hour}
                  type="button"
                  disabled={isBusy}
                  onClick={() => setSelectedTime(hour)}
                  className={`rounded-2xl px-3 py-3 text-sm font-bold transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-30 ${
                    isSelected
                      ? "bg-orange-500 text-white"
                      : "bg-white/10 text-white hover:bg-white/15"
                  }`}
                >
                  {hour}
                </button>
              );
            })}
          </div>
        </section>

        <button
          type="button"
          onClick={continueToOffer}
          className="mt-6 w-full rounded-full bg-orange-500 px-6 py-4 text-base font-bold text-white transition active:scale-[0.98]"
        >
          Continuă către ofertă
        </button>
      </div>
    </main>
  );
}

function toInputDate(date: Date) {
  return date.toISOString().split("T")[0];
}

function formatWeekday(date: Date) {
  return date.toLocaleDateString("ro-RO", { weekday: "short" });
}

function formatMonth(date: Date) {
  return date.toLocaleDateString("ro-RO", { month: "short" });
}
