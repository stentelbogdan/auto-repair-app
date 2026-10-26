/** Browser-only orchestration: no privileged imports or Storage client. */
export type EditorImage = { name?: string; path?: string; url?: string; thumbUrl?: string; dataUrl?: string; fingerprint?: string; fingerprintVersion?: string };
type Operation = { requestId: string; operationId: string; image: EditorImage; confirmed?: 'deleted' | 'retained'; refused?: boolean };
export type ImageDeletionState = { phase: 'idle' | 'busy' | 'recovery'; message: string; path?: string; operationId?: string };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function hasDeletableImagePath(image: EditorImage): boolean {
  if (typeof image.path !== 'string' || image.path.length > 1024) return false;
  const parts = image.path.split('/');
  return parts.length === 2 && UUID.test(parts[0]) && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(parts[1]);
}
export function removeLocalImage<T>(files: T[], previews: string[], index: number, revoke: (url: string) => void) {
  if (index < 0 || index >= files.length) return { files, previews };
  if (previews[index]) revoke(previews[index]);
  return { files: files.filter((_, i) => i !== index), previews: previews.filter((_, i) => i !== index) };
}
export function createImageDeletionEditor(requestId: string, deps: {
  token(): Promise<string | null>;
  send(body: { requestId: string; operationId: string; image: EditorImage }, token: string): Promise<{ ok: boolean; body: unknown }>;
  readImages(): Promise<EditorImage[]>;
  applyImages(images: EditorImage[]): void;
  publish(state: ImageDeletionState): void;
  uuid(): string;
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
}) {
  const key = `repair-image-operation:${requestId}`;
  let pending: Operation | null = null;
  let busy = false;
  let disposed = false;
  let storageBroken = false;
  let paused = false;
  let refreshNeeded = false;
  let refreshing = false;
  let revision = 0;
  let readQueue: Promise<unknown> | null = null;
  const readImages = (): Promise<EditorImage[]> => {
    const invoke = () => {
      if (disposed) throw new Error('Disposed editor');
      return deps.readImages();
    };
    const read = readQueue ? readQueue.then(invoke) : invoke();
    const settled = read.catch(() => {}).finally(() => { if (readQueue === settled) readQueue = null; });
    readQueue = settled;
    return read;
  };
  async function readFreshImages() {
    while (!disposed) {
      const version = revision;
      const images = await readImages();
      if (version === revision) return images;
    }
    throw new Error('Disposed editor');
  }
  async function refresh() {
    if (disposed || paused || busy || refreshing || !refreshNeeded) return;
    refreshing = true;
    try {
      while (refreshNeeded && !disposed && !paused && !busy) {
        refreshNeeded = false;
        const version = revision;
        const images = await readImages();
        if (disposed) return;
        if (version !== revision || paused || busy) { refreshNeeded = true; continue; }
        if (!Array.isArray(images)) throw new Error('Invalid images');
        // A notification is never a physical deletion receipt or recovery approval.
        deps.applyImages(images);
      }
    } catch {
      // No polling/retry loop. A later event or foreground transition can retry.
    } finally { refreshing = false; }
  }
  const requestRefresh = () => {
    if (disposed) return;
    revision++; refreshNeeded = true;
    void refresh();
  };
  const publish = (phase: ImageDeletionState['phase'], message: string) => {
    if (!disposed) deps.publish({ phase, message, path: pending?.image.path, operationId: pending?.operationId });
  };
  try {
    const saved = deps.storage.getItem(key);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (parsed.requestId !== requestId || !UUID.test(parsed.operationId) || !parsed.image || !hasDeletableImagePath(parsed.image)) throw new Error('Invalid saved operation');
      // Do not trust persisted success/refusal flags; reconcile the server again.
      pending = { requestId, operationId: parsed.operationId, image: parsed.image };
      publish('recovery', 'Există o operațiune neconfirmată. Verifică lista sau reia aceeași operațiune.');
    }
  } catch { storageBroken = true; publish('recovery', 'Nu putem păstra în siguranță operațiunea. Ștergerea și salvarea sunt blocate în această filă.'); }
  const persist = () => { if (pending) deps.storage.setItem(key, JSON.stringify(pending)); };
  const finish = (message: string) => {
    deps.storage.removeItem(key);
    pending = null;
    publish('idle', message);
  };
  async function synchronize() {
    const images = await readFreshImages();
    if (disposed) return;
    if (!Array.isArray(images)) throw new Error('Invalid images');
    if (pending && images.some(image => image.path === pending!.image.path)) {
      if (!pending.refused) throw new Error('Image still associated');
      deps.applyImages(images);
      finish('Ștergerea a fost refuzată. Fotografia rămâne în cerere.');
      return;
    }
    deps.applyImages(images);
    const confirmed = pending?.confirmed;
    finish(confirmed === 'deleted' ? 'Fotografia a fost ștearsă, iar absența din Storage a fost confirmată.' : confirmed === 'retained' ? 'Fotografia a fost detașată din cerere. Fișierul este păstrat deoarece mai este referențiat.' : 'Lista este sincronizată: fotografia nu mai este asociată cererii. Ștergerea fizică nu este confirmată.');
  }
  async function execute() {
    if (!pending || busy || paused || disposed || storageBroken) return;
    revision++;
    busy = true;
    publish('busy', 'Se șterge…');
    try {
      if (pending.confirmed || pending.refused) { await synchronize(); return; }
      const token = await deps.token();
      if (disposed) return;
      if (!token) { publish('recovery', 'Sesiunea lipsește sau a expirat. Autentifică-te și reia aceeași operațiune.'); return; }
      const reply = await deps.send({ requestId, operationId: pending.operationId, image: pending.image }, token);
      if (disposed) return;
      const value = reply.body as Record<string, unknown> | null;
      if (!value || value.operationId !== pending.operationId) throw new Error('Ambiguous response');
      if (reply.ok && value.detached === true && ((value.status === 'deleted' && value.physicalDeletionConfirmed === true) || (value.status === 'retained' && value.physicalDeletionConfirmed === false))) {
        pending.confirmed = value.status as 'deleted' | 'retained'; persist(); await synchronize(); return;
      }
      if (value.status === 'forbidden' && value.detached === false && value.physicalDeletionConfirmed === false) {
        pending.refused = true; persist(); await synchronize(); return;
      }
      publish('recovery', value.status === 'already_completed_unverified'
        ? 'Operațiunea este înregistrată ca finalizată, dar ștergerea fizică nu este reverificată. Verifică lista cererii.'
        : value.status === 'unauthenticated' ? 'Sesiunea nu este validă. Autentifică-te și reia aceeași operațiune.'
        : 'Rezultatul nu este confirmat. Verifică lista sau reia manual aceeași operațiune.');
    } catch { publish('recovery', 'Nu putem confirma operațiunea sau sincronizarea. Salvarea este blocată; verifică lista ori reia aceeași operațiune.'); }
    finally { busy = false; void refresh(); }
  }
  return {
    requestRefresh,
    notifyUpdate: (changedId: unknown) => { if (changedId === requestId) requestRefresh(); },
    setPaused(value: boolean) {
      paused = value; revision++;
      if (!value) requestRefresh();
    },
    blocked: () => busy || pending !== null || storageBroken || disposed,
    async remove(image: EditorImage) {
      if (busy || paused || pending || storageBroken || disposed) return;
      if (!hasDeletableImagePath(image)) { publish('idle', 'Această fotografie veche nu are o cale validă și nu poate fi ștearsă securizat aici.'); return; }
      pending = { requestId, operationId: deps.uuid(), image: { ...image } };
      try { persist(); } catch { storageBroken = true; publish('recovery', 'Nu putem păstra operațiunea pentru recuperare. Nu s-a trimis nicio ștergere.'); return; }
      await execute();
    },
    retry: execute,
    async reconcile() {
      if (!pending || busy || paused || disposed || storageBroken) return;
      revision++; busy = true; publish('busy', 'Se verifică lista…');
      try { await synchronize(); } catch { publish('recovery', 'Lista nu confirmă încă detașarea. Operațiunea rămâne blocată; poți reîncerca manual.'); }
      finally { busy = false; void refresh(); }
    },
    async imagesForSave() {
      if (busy || pending || storageBroken || disposed) throw new Error('Unresolved image operation');
      revision++; busy = true;
      try {
        const images = await readFreshImages();
        if (disposed || !Array.isArray(images)) throw new Error('Stale editor');
        deps.applyImages(images);
        return images;
      } finally { busy = false; void refresh(); }
    },
    dispose() { disposed = true; revision++; refreshNeeded = false; },
  };
}
