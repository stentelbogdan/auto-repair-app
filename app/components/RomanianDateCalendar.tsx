"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { CalendarDays, Check, ChevronLeft, ChevronRight, X } from "lucide-react";
import { addDays, calendarDate, localToday, monthCells, moveMonth, romanianDate } from "@/lib/calendar/date-only";

type Props = { value: string; minDate: string; onChange: (value: string) => void; compact?: boolean };

export default function RomanianDateCalendar({ value, minDate, onChange, compact = false }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const hintId = useId();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [focused, setFocused] = useState("");
  const minimum = minDate > localToday() ? minDate : localToday();
  const month = focused.slice(0, 7);
  const cells = monthCells(month);
  const valid = (day: string) => Boolean(calendarDate(day)) && day >= minimum;
  const close = () => dialog.current?.close();
  const focusDay = (day: string) => setFocused(day < minimum ? minimum : day);

  useEffect(() => {
    if (!open) return;
    dialog.current?.querySelector<HTMLButtonElement>(`[data-day="${focused}"]`)?.focus();
  }, [open, focused]);
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, [open]);

  const show = () => {
    setDraft(valid(value) ? value : "");
    setFocused(valid(value) ? value : minimum);
    dialog.current?.showModal(); // Browser top layer: above navbar; modal focus containment.
    setOpen(true);
  };
  const keyDown = (event: KeyboardEvent<HTMLButtonElement>, day: string) => {
    let next: string | undefined;
    const offset = (calendarDate(day)!.getUTCDay() + 6) % 7;
    if (event.key === "ArrowLeft") next = addDays(day, -1);
    if (event.key === "ArrowRight") next = addDays(day, 1);
    if (event.key === "ArrowUp") next = addDays(day, -7);
    if (event.key === "ArrowDown") next = addDays(day, 7);
    if (event.key === "Home") next = addDays(day, -offset);
    if (event.key === "End") next = addDays(day, 6 - offset);
    if (event.key === "PageUp") next = moveMonth(day, event.shiftKey ? -12 : -1);
    if (event.key === "PageDown") next = moveMonth(day, event.shiftKey ? 12 : 1);
    if (next) { event.preventDefault(); focusDay(next); }
  };
  const control = "inline-flex h-11 min-w-11 items-center justify-center rounded-full text-blue-600 transition hover:bg-blue-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:opacity-30";

  return <>
    <button ref={trigger} type="button" onClick={show} aria-label="Deschide calendarul" aria-haspopup="dialog" aria-expanded={open}
      className={compact ? control : "flex min-h-14 w-full items-center justify-between gap-3 rounded-2xl border border-black/10 bg-white px-4 py-3 text-left text-black focus-visible:outline-2 focus-visible:outline-blue-600"}>
      {!compact && <span>{calendarDate(value) ? value.split("-").reverse().join(".") : "Alege data"}</span>}
      <CalendarDays size={22} aria-hidden="true" />
    </button>
    <dialog ref={dialog} lang="ro" aria-labelledby={titleId} aria-describedby={hintId} aria-modal="true"
      onClose={() => { setOpen(false); trigger.current?.focus(); }}
      onClick={event => {
        if (event.target !== dialog.current) return;
        const r = dialog.current.getBoundingClientRect();
        if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) close();
      }}
      className="fixed inset-0 m-auto max-h-[calc(100dvh-32px)] w-[calc(100%_-_24px)] max-w-[420px] overflow-y-auto rounded-[28px] border border-black/5 bg-[#fafafa] p-0 text-[#17212c] shadow-2xl backdrop:bg-black/45 backdrop:backdrop-blur-sm">
      <div className="p-4 pb-[max(16px,env(safe-area-inset-bottom))] sm:p-6">
        <div className="mb-3 flex items-center justify-between">
          <button type="button" onClick={() => { setDraft(""); focusDay(minimum); }} className={`${control} px-3 text-sm font-semibold`}>Resetați</button>
          <div className="flex gap-1">
            <button type="button" aria-label="Închide fără modificări" onClick={close} className={control}><X size={21} aria-hidden="true" /></button>
            <button type="button" aria-label="Confirmă data" disabled={Boolean(draft) && !valid(draft)} onClick={() => { if (!draft || valid(draft)) { if (draft !== value) onChange(draft); close(); } }} className={`${control} bg-blue-600 text-white hover:bg-blue-700`}><Check size={23} aria-hidden="true" /></button>
          </div>
        </div>
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 id={titleId} aria-live="polite" className="text-xl font-bold tracking-tight">{romanianDate(`${month}-01`, true)}</h2>
          <div className="flex">
            <button type="button" aria-label="Luna precedentă" disabled={month <= minimum.slice(0, 7)} onClick={() => focusDay(moveMonth(focused, -1))} className={control}><ChevronLeft size={23} aria-hidden="true" /></button>
            <button type="button" aria-label="Luna următoare" disabled={month === "9999-12"} onClick={() => focusDay(moveMonth(focused, 1))} className={control}><ChevronRight size={23} aria-hidden="true" /></button>
          </div>
        </div>
        <p id={hintId} className="sr-only">Alegeți ziua și confirmați cu bifa. Săgețile mută focusul, Page Up și Page Down schimbă luna. Escape închide fără modificări.</p>
        <table role="grid" aria-label="Calendar" className="w-full table-fixed border-separate border-spacing-y-1 text-center">
          <thead><tr>{["luni", "marți", "miercuri", "joi", "vineri", "sâmbătă", "duminică"].map((day, i) => <th key={day} scope="col" abbr={day} className="h-9 text-xs font-semibold text-slate-500">{["L", "M", "M", "J", "V", "S", "D"][i]}</th>)}</tr></thead>
          <tbody>{Array.from({ length: cells.length / 7 }, (_, row) => <tr key={row}>{cells.slice(row * 7, row * 7 + 7).map((day, col) =>
            <td key={day || col} aria-selected={Boolean(day && draft === day)} className="p-0">{day && <button type="button" data-day={day} tabIndex={focused === day ? 0 : -1} disabled={!valid(day)} aria-label={romanianDate(day)} aria-current={day === localToday() ? "date" : undefined}
              onKeyDown={event => keyDown(event, day)} onClick={() => { setDraft(day); setFocused(day); }}
              className={`mx-auto flex h-11 w-full max-w-11 items-center justify-center rounded-full text-base font-medium transition focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-blue-600 disabled:text-slate-300 ${draft === day ? "bg-blue-600 text-white" : "hover:bg-blue-50 disabled:hover:bg-transparent"}`}>
              {Number(day.slice(-2))}
            </button>}</td>)}</tr>)}</tbody>
        </table>
        <p aria-live="polite" className="mt-3 min-h-5 text-center text-xs text-slate-500">{draft ? romanianDate(draft) : "Nicio dată selectată"}</p>
      </div>
    </dialog>
  </>;
}
