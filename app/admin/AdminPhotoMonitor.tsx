"use client";

import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import {
  createPhotoMonitor, formatPhotoCount, initialPhotoState, isPhotoMonitorTestUrl,
  type PhotoMonitorState, PHOTO_TOPIC, PHOTO_EVENT, createPhotoBroadcastConnector,
} from "@/lib/admin/photo-overview";

// Shared lifecycle queue prevents same-topic reuse while an old channel leaves.
const connectPhotoBroadcast = createPhotoBroadcastConnector({
  open: events => {
    if (supabase.getChannels().some(channel => channel.topic === `realtime:${PHOTO_TOPIC}`)) {
      throw new Error("PHOTO_CHANNEL_STILL_CLOSING");
    }
    return supabase.channel(PHOTO_TOPIC, { config: { private: true } })
      .on("broadcast", { event: PHOTO_EVENT }, message => events.message(message.payload))
      .subscribe(events.status);
  },
  close: channel => supabase.removeChannel(channel),
});

export default function AdminPhotoMonitor() {
  const [state, setState] = useState<PhotoMonitorState>(initialPhotoState);
  const controller = useRef<ReturnType<typeof createPhotoMonitor> | null>(null);
  const allowed = isPhotoMonitorTestUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);

  useEffect(() => {
    if (!allowed) return;
    const monitor = createPhotoMonitor({
      read: signal => supabase.rpc("get_admin_photo_overview").abortSignal(signal).single(),
      connect: process.env.NEXT_PUBLIC_ADMIN_PHOTO_BROADCAST_ENABLED === "true" ? connectPhotoBroadcast : undefined,
      publish: setState,
    });
    controller.current = monitor;
    let active = true;
    let authRevision = 0;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      authRevision++;
      monitor.sessionChanged(session?.access_token ?? null);
    });
    const revision = authRevision;
    void supabase.auth.getSession().then(({ data, error }) => {
      if (active && revision === authRevision) monitor.sessionChanged(error ? null : data.session?.access_token ?? null);
    }).catch(() => {
      if (active && revision === authRevision) monitor.sessionChanged(null);
    });
    const visibility = () => {
      if (document.visibilityState === "visible") monitor.foreground(); else monitor.markStale();
    };
    const foreground = () => monitor.foreground();
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("pageshow", foreground);
    return () => {
      active = false;
      monitor.dispose();
      controller.current = null;
      subscription.unsubscribe();
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("pageshow", foreground);
    };
  }, [allowed]);

  const data = state.data;
  const error = state.error === "session" ? "Session expirată sau indisponibilă. Autentifică-te din nou."
    : state.error === "authorization" ? "Acces refuzat. Este necesară o sesiune Admin validă."
    : "Statisticile fotografiilor nu au putut fi încărcate. Încearcă din nou.";
  return (
    <section aria-labelledby="photo-monitor-title" aria-busy={allowed && state.loading} className="mt-8 rounded-2xl border border-orange-400/30 bg-white/5 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 id="photo-monitor-title" className="text-xl font-semibold">Fotografii</h2>
          <p className="mt-1 text-sm text-white/60">{state.connection === "subscribed" ? "LIVE conectat · contoare la ultima citire confirmată."
              : state.connection === "connecting" ? "Se conectează actualizarea LIVE…"
              : state.connection === "reconnecting" ? "Conexiune întreruptă · reconectare…"
              : state.connection === "denied" ? "Acces Admin indisponibil."
              : "Actualizarea LIVE nu este activă."}</p>
        </div>
        {allowed && <button type="button" disabled={state.loading || state.error === "session"}
          onClick={() => void controller.current?.refresh()}
          className="min-h-11 rounded-xl border border-orange-400/40 px-4 py-2 text-sm font-semibold hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400 disabled:opacity-50">
          {state.loading ? "Se încarcă…" : "Actualizează"}
        </button>}
      </div>
      {!allowed ? <p role="status" className="mt-4 text-sm text-white/70">Panoul este disponibil exclusiv în mediul TEST.</p> : <>
        {state.loading && !data && <p role="status" className="mt-4 text-white/60">Se încarcă statisticile fotografiilor…</p>}
        {state.error && <p role="alert" className="mt-4 text-sm text-orange-200">{error}</p>}
        {data && <>
          {state.stale && <p role="status" className="mt-4 text-sm text-amber-200">Date posibil neactualizate. Resincronizare la revenire sau reconectare; poți folosi și „Actualizează”.</p>}
          <dl className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <PhotoMetric label="Fotografii asociate cererilor"
              value={data.associations_complete ? formatPhotoCount(data.total_photo_associations!) : `Cel puțin ${formatPhotoCount(data.valid_photo_associations)}`}
              detail={data.associations_complete ? "Asocieri valide; aceeași fotografie poate apărea în mai multe cereri."
                : `${formatPhotoCount(data.unclassifiable_entries)} intrări neclasificabile. Totalul exact nu este disponibil.`} />
            <PhotoMetric label="Obiecte în Storage" value={formatPhotoCount(data.storage_objects_count)}
              detail="Înregistrări în bucketul repair-images; nu o verificare individuală a fișierelor." />
            <PhotoMetric label="Ștergeri țintite nefinalizate" value={formatPhotoCount(data.unfinished_targeted_operations)}
              detail="Operațiuni autorizate, nu număr de fotografii distincte." />
            <PhotoMetric label="Claim-uri expirate" value={formatPhotoCount(data.expired_delete_claims)}
              detail="Obiecte cu rezervarea pentru ștergere expirată la momentul citirii." />
          </dl>
          <p className="mt-4 text-xs text-white/50">Observat la <time dateTime={data.observed_at}>{new Date(data.observed_at).toLocaleString("ro-RO")}</time>. Diferența dintre asocieri și obiectele Storage nu indică automat o eroare.</p>
        </>}
      </>}
    </section>
  );
}

function PhotoMetric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <div className="min-w-0 rounded-xl border border-white/10 bg-black/20 p-4">
    <dt className="text-sm text-white/60">{label}</dt>
    <dd className="mt-2 break-words text-2xl font-bold tabular-nums text-white">{value}</dd>
    <dd className="mt-2 text-xs leading-relaxed text-white/50">{detail}</dd>
  </div>;
}
