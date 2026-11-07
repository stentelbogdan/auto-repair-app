import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";

type Adapter = typeof import("./work-progress-images");
type Node = { type: unknown; props: Record<string, unknown> };
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const compile = (source: string) => ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
} }).outputText;
const adapter = {} as Adapter;
new Function("exports", compile(read("./work-progress-images.ts")))(adapter);
const project = "https://bstjobvvxxfqqwyjoimx.supabase.co";
const request = "10000000-0000-4000-8000-000000000001";
const workshop = "20000000-0000-4000-8000-000000000002";
const key = `${request}/${workshop}/photo.jpg`;
const publicUrl = (path = key) => `${project}/storage/v1/object/public/work-progress/${path}`;
const signedUrl = (path = key) => `${project}/storage/v1/object/sign/work-progress/${encodeURI(path)}?token=synthetic`;
const row = (path = key) => ({ path, signedUrl: signedUrl(path), error: null });
type Reply = { data: unknown; error: unknown };
const settle = () => new Promise(resolve => setImmediate(resolve));
function storage(reply: () => Promise<Reply> = async () => ({ data: [row()], error: null })) {
  const calls: string[][] = [];
  const client = { storage: { from(bucket: string) {
    assert.equal(bucket, "work-progress");
    return { createSignedUrls: async (paths: string[], ttl: number) => {
      assert.equal(ttl, 3600); calls.push(paths); return reply();
    }, getPublicUrl() { throw new Error("public fallback forbidden"); }, download() { throw new Error("no download"); } };
  } } };
  return { client: client as unknown as Parameters<Adapter["resolveWorkProgressImages"]>[0], calls };
}
for (const [label, reference, expected] of [
  ["path", key, key], ["legacy two segments", `${request}/old.jpg`, `${request}/old.jpg`],
  ["public URL", publicUrl(), key], ["expired signed URL", signedUrl(), key],
  ["authenticated URL", publicUrl().replace("/public/", "/authenticated/"), key],
  ["encoded filename", publicUrl(`${request}/${workshop}/etapa%20nou%C4%83.jpg`), `${request}/${workshop}/etapa nouă.jpg`],
]) test(`strict reference adapter: ${label}`, () => {
  assert.equal(adapter.workProgressImagePath(reference, request, project), expected);
});
for (const value of ["", " "+key, "https://other-project.invalid/storage/v1/object/public/work-progress/"+key,
  publicUrl().replace("work-progress", "repair-images"), publicUrl().replace(request, workshop),
  `${request}/../photo.jpg`, `${request}/not-a-workshop/photo.jpg`,
  publicUrl(`${request}/${workshop}/../photo.jpg`), publicUrl(`${request}/%2e%2e/photo.jpg`),
  publicUrl(`${request}/${workshop}%2Fphoto.jpg`), publicUrl().replace("https://", "http://"),
  `//evil.invalid/${key}`, "data:image/png;base64,x", "blob:synthetic", `${request}/bad\\name.jpg`,
  publicUrl()+"#fragment", publicUrl().replace("https://", "https://user:secret@"),
]) test(`invalid reference rejected (${JSON.stringify(value)})`, () => {
  assert.equal(adapter.workProgressImagePath(value, request, project), null);
});
test("historical references map to one signed request, preserving duplicates and order", async () => {
  const { client, calls } = storage(); const refs = [publicUrl(), key, signedUrl()]; const copy = [...refs];
  assert.deepEqual(await adapter.resolveWorkProgressImages(client, request, refs, project), refs.map(() => signedUrl()));
  assert.deepEqual(calls, [[key]]); assert.deepEqual(refs, copy);
});
test("signed replies correlate by exact path, not response position", async () => {
  const key2 = `${request}/legacy.jpg`;
  const { client } = storage(async () => ({ data: [row(key2), row()], error: null }));
  assert.deepEqual(await adapter.resolveWorkProgressImages(client, request, [key, key2], project), [signedUrl(), signedUrl(key2)]);
});
test("partial denial and missing response never fall back to public URLs", async () => {
  const key2 = `${request}/denied.jpg`, key3 = `${request}/missing.jpg`;
  const { client } = storage(async () => ({ data: [row(), { path: key2, signedUrl: null, error: "Denied" }], error: null }));
  assert.deepEqual(await adapter.resolveWorkProgressImages(client, request, [key, key2, key3, "https://invalid.test/x"], project), [signedUrl(), null, null, null]);
});
for (const data of [null, {}, [row(), row()], [row(`${workshop}/foreign.jpg`)]])
  test("malformed signing reply fails closed: "+JSON.stringify(data), async () => {
    const { client } = storage(async () => ({ data, error: null }));
    await assert.rejects(adapter.resolveWorkProgressImages(client, request, [key], project));
  });
for (const badUrl of ["bad", publicUrl(), signedUrl().replace(project, "https://foreign.invalid"), signedUrl().split("?")[0]])
  test("unsigned/untrusted signing result is not rendered: "+badUrl, async () => {
    const { client } = storage(async () => ({ data: [{ ...row(), signedUrl: badUrl }], error: null }));
    assert.deepEqual(await adapter.resolveWorkProgressImages(client, request, [key], project), [null]);
  });
test("denied signing propagates and never reports successful access", async () => {
  const failure = new Error("Denied"); const { client } = storage(async () => ({ data: null, error: failure }));
  await assert.rejects(adapter.resolveWorkProgressImages(client, request, [key], project), error => error === failure);
});
test("no valid references means no Storage call", async () => {
  const { client, calls } = storage();
  assert.deepEqual(await adapter.resolveWorkProgressImages(client, request, ["data:invalid"], project), [null]);
  assert.deepEqual(calls, []);
});

function component(options: { reply?: () => Promise<Reply>; user?: boolean; generic?: boolean } = {}) {
  const source = read(options.generic ? "../../app/components/ImageGallery.tsx" : "../../app/components/WorkProgressImageGallery.tsx");
  const slots: unknown[] = [], effects: (() => (() => void))[] = [];
  let cursor = 0, signedUser = options.user !== false, authEvent: (event: string) => void = () => {};
  let unsubscribed = false;
  const s = storage(options.reply);
  const client = { ...s.client, auth: { getUser: async () => ({ data: { user: signedUser ? { id: workshop } : null }, error: null }),
    onAuthStateChange: (fn: typeof authEvent) => { authEvent = fn; return { data: { subscription: { unsubscribe() { unsubscribed = true; } } } }; } } };
  const jsx = (type: unknown, props: Node["props"]) => ({ type, props });
  const load = (name: string): unknown => {
    if (name === "react") return {
      useState(initial: unknown) { const i = cursor++; if (!(i in slots)) slots[i] = initial;
        return [slots[i], (value: unknown) => { slots[i] = typeof value === "function" ? value(slots[i]) : value; }]; },
      useEffect(fn: typeof effects[number]) { effects.push(fn); },
    };
    if (name === "react/jsx-runtime") return { jsx, jsxs: jsx, Fragment: "Fragment" };
    if (name === "@/lib/supabase/client") return { supabase: client };
    if (name === "@/lib/supabase/work-progress-images") return { resolveWorkProgressImages:
      (c: Parameters<Adapter["resolveWorkProgressImages"]>[0], id: string, refs: string[]) => adapter.resolveWorkProgressImages(c, id, refs, project) };
    if (name === "@/app/components/ImageGallery") return { default: "ImageGallery" };
    if (name === "yet-another-react-lightbox") return { default: "Lightbox" };
    if (name === "yet-another-react-lightbox/plugins/zoom") return { default: "Zoom" };
    if (name.endsWith("styles.css")) return {};
    throw new Error("Unexpected import "+name);
  };
  const mod = {} as { default: (props: unknown) => Node }; new Function("require", "exports", compile(source))(load, mod);
  let props = { requestId: request, images: [{ name: "photo", url: publicUrl() }], alt: "Progres", className: "existing-thumbnail" };
  const render = () => { cursor = 0; effects.length = 0; return mod.default(props); };
  function nodes(type: string) { const found: Node[] = []; const visit = (node: unknown) => {
    if (Array.isArray(node)) { node.forEach(visit); return; }
    if (!node || typeof node !== "object" || !("props" in node)) return;
    const n = node as Node; if (n.type === type) found.push(n); visit(n.props.children);
  }; visit(render()); return found; }
  return { nodes, calls: s.calls, change(next: Partial<typeof props>) { props = { ...props, ...next }; },
    async mount() { render(); const cleanup = effects[0](); await settle(); await settle(); return cleanup; },
    event(event: string) { if (event === "SIGNED_OUT") signedUser = false; if (event === "SIGNED_IN") signedUser = true; authEvent(event); },
    get unsubscribed() { return unsubscribed; } };
}
test("thumbnail and normal gallery receive the same authorized URL and existing style", async () => {
  const f = component(); const cleanup = await f.mount();
  const p = f.nodes("ImageGallery")[0].props;
  assert.deepEqual(p.images, [{ name: "photo", url: signedUrl() }]); assert.equal(p.className, "existing-thumbnail");
  assert.equal(f.calls.length, 1); cleanup(); assert.ok(f.unsubscribed);
});
test("missing session: no signing or raw public image", async () => {
  const f = component({ user: false }); await f.mount(); assert.deepEqual(f.calls, []);
  assert.equal(f.nodes("ImageGallery").length, 0); assert.equal(f.nodes("button").length, 1);
});
test("permission error: neutral retry state, no fallback image", async () => {
  const f = component({ reply: async () => ({ data: null, error: new Error("Denied") }) }); await f.mount();
  assert.equal(f.nodes("ImageGallery").length, 0); assert.equal(f.calls.length, 1);
});
test("old request is hidden immediately; late signing response is ignored", async () => {
  let finish!: (value: Reply) => void;
  const f = component({ reply: () => new Promise(resolve => { finish = resolve; }) }); const cleanup = await f.mount();
  f.change({ requestId: workshop }); assert.equal(f.nodes("ImageGallery").length, 0); cleanup();
  finish({ data: [row()], error: null }); await settle(); assert.equal(f.nodes("ImageGallery").length, 0);
});
test("signout invalidates in-flight signing and removes previous images", async () => {
  let finish!: (value: Reply) => void;
  const f = component({ reply: () => new Promise(resolve => { finish = resolve; }) }); const cleanup = await f.mount();
  f.event("SIGNED_OUT"); finish({ data: [row()], error: null }); await settle();
  assert.equal(f.nodes("ImageGallery").length, 0); cleanup();
});
test("expired/broken thumbnail does not loop: explicit retry re-signs", async () => {
  const f = component(); let cleanup = await f.mount();
  (f.nodes("ImageGallery")[0].props.onThumbnailError as () => void)();
  assert.equal(f.nodes("ImageGallery").length, 0); assert.equal(f.calls.length, 1);
  let stopped = false; (f.nodes("button")[0].props.onClick as (event: unknown) => void)({ stopPropagation() { stopped = true; } });
  assert.ok(stopped); cleanup(); cleanup = await f.mount();
  assert.equal(f.calls.length, 2); assert.equal(f.nodes("ImageGallery").length, 1); cleanup();
});
test("existing gallery opens signed full-size slide, stops card navigation and retains zoom", () => {
  const f = component({ generic: true }); f.change({ images: [{ name: "photo", url: signedUrl() }] });
  assert.equal(f.nodes("img")[0].props.src, signedUrl()); let stopped = false;
  (f.nodes("button")[0].props.onClick as (event: unknown) => void)({ stopPropagation() { stopped = true; } });
  const lightbox = f.nodes("Lightbox")[0].props;
  assert.ok(stopped); assert.equal(lightbox.open, true); assert.deepEqual(lightbox.slides, [{ src: signedUrl() }]);
  assert.deepEqual(lightbox.plugins, ["Zoom"]);
});
for (const page of ["../../app/customer/my-jobs/[id]/page.tsx", "../../app/workshops/in-workshop/[id]/photos-folder/page.tsx"])
  test(page+": authorized image gallery receives unchanged stored references and exact request", () => {
    const source = read(page);
    assert.match(source, /<WorkProgressImageGallery\s+requestId=\{requestId\}/);
    assert.match(source, /images=\{update.images.map/);
    assert.doesNotMatch(source, /createSignedUrl|getPublicUrl|storage\.from/);
  });
