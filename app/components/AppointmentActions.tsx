"use client";

import { CalendarDays, Check, MessageCircle } from "lucide-react";
import { interactiveButton } from "@/lib/ui";

type AppointmentActionsProps = {
  showConfirm: boolean;
  onConfirm?: () => void;
  onChat: () => void;
  onChangeDate: () => void;
  confirming?: boolean;
  confirmDisabled?: boolean;
};

export default function AppointmentActions({
  showConfirm,
  onConfirm,
  onChat,
  onChangeDate,
  confirming = false,
  confirmDisabled = false,
}: AppointmentActionsProps) {
  return (
    <div className="mt-6 space-y-3">
      {showConfirm && (
        <button
          type="button"
          onClick={onConfirm}
          disabled={confirmDisabled || confirming || !onConfirm}
          className={`${interactiveButton} flex w-full items-center justify-center gap-2 rounded-[20px] bg-orange-500 px-4 py-5 text-center text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-60`}
        >
          <Check size={19} strokeWidth={2.5} />

          <span>{confirming ? "Se confirmă..." : "Confirmă programarea"}</span>
        </button>
      )}

      <div className="grid grid-cols-2 gap-3">
        <button
          type="button"
          onClick={onChat}
          className={`${interactiveButton} flex items-center justify-center gap-2 rounded-[20px] bg-black px-4 py-5 text-center text-sm font-bold text-white`}
        >
          <MessageCircle size={19} strokeWidth={2.3} />
          <span>Chat</span>
        </button>

        <button
          type="button"
          onClick={onChangeDate}
          className={`${interactiveButton} flex items-center justify-center gap-2 rounded-[20px] bg-black px-4 py-5 text-center text-sm font-bold text-white`}
        >
          <CalendarDays size={19} strokeWidth={2.3} />
          <span>Modifică data</span>
        </button>
      </div>
    </div>
  );
}
