import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const navbar = read("../app/components/AppNavbar.tsx");
const compile = (source: string) => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const source = navbar.slice(navbar.indexOf("    const loadUnreadAppointmentNotifications ="), navbar.indexOf("    const loadUnreadWonJobs ="));
function counter(role: "customer" | "workshop") {
  const rows: { type: string; recipient_id: string; recipient_role: string; read_at: string | null }[] = [];
  const state = { error: false, active: true, counts: {} as Record<string, number> };
  const client = { from: () => {
    const filters: [string, unknown][] = []; let types: string[] = [];
    const query = { select: () => query,
      eq: (key: string, value: unknown) => { filters.push([key, value]); return query; },
      is: (key: string, value: unknown) => { filters.push([key, value]); return query; },
      in: (_key: string, value: string[]) => { types = value; return query; },
      then: (done: (result: unknown) => void) => done({ error: state.error ? { code: "42501" } : null,
        data: rows.filter(row => types.includes(row.type) && filters.every(([key, value]) => row[key as keyof typeof row] === value)) }),
    }; return query;
  } };
  const deps: Record<string, unknown> = { supabase: client, userId: "owner", isWorkshopMode: role === "workshop",
    isSessionActive: () => state.active, console: { error() {} },
    WORKSHOP_OFFER_REJECTED_NOTIFICATION_TYPE: "workshop_offer_rejected", WORKSHOP_REQUEST_CLOSED_NOTIFICATION_TYPE: "workshop_request_closed",
    WORKSHOP_STARTED_JOB_NOTIFICATION_TYPE: "workshop_started_job", CUSTOMER_REVIEW_SUBMITTED_NOTIFICATION_TYPE: "customer_review_submitted" };
  for (const name of ["AppointmentProposal", "AppointmentConfirmed", "JobStarted", "RejectedOffer", "ReviewSubmitted"]) {
    deps[`set${name}UnreadCount`] = (value: number) => { state.counts[name] = value; };
  }
  const refresh = new Function(...Object.keys(deps), compile(source) + "\nreturn loadUnreadAppointmentNotifications;")(...Object.values(deps)) as () => Promise<void>;
  return { rows, state, refresh };
}
for (const role of ["customer", "workshop"] as const) test(`${role}: new event, persistent receipt, new event again, refresh and separate roles`, async () => {
  const f = counter(role);
  const type = role === "workshop" ? "customer_proposed_appointment" : "workshop_proposed_appointment";
  f.rows.push({ type, recipient_id: "owner", recipient_role: role, read_at: null },
    { type, recipient_id: "owner", recipient_role: role === "workshop" ? "customer" : "workshop", read_at: null });
  await f.refresh(); assert.equal(f.state.counts.AppointmentProposal, 1);
  f.rows[0].read_at = "2026-11-03";
  await f.refresh(); assert.equal(f.state.counts.AppointmentProposal, 0);
  f.rows.push({ type, recipient_id: "owner", recipient_role: role, read_at: null });
  await f.refresh(); assert.equal(f.state.counts.AppointmentProposal, 1);
  const otherDevice = counter(role); otherDevice.rows.push(...f.rows); await otherDevice.refresh();
  assert.deepEqual(otherDevice.state.counts, f.state.counts);
  f.state.error = true; await f.refresh(); assert.equal(f.state.counts.AppointmentProposal, 1);
});
test("late response for another account cannot replace counts", async () => {
  const f = counter("customer"); f.state.active = false; await f.refresh(); assert.deepEqual(f.state.counts, {});
});
test("navbar navigation never writes read state or zeroes counts; reconnect and focus refetch non-Chat", () => {
  const nav = navbar.slice(navbar.indexOf("  const goOffers ="), navbar.indexOf("  const handleLogout"));
  assert.doesNotMatch(nav, /\.update\(|markNotificationsAsRead|set\w+UnreadCount\(0\)/);
  const subscribed = navbar.slice(navbar.indexOf('if (status === "SUBSCRIBED")'), navbar.indexOf("    const refreshAllBadges"));
  for (const scheduler of ["offersScheduler", "wonJobsScheduler", "notificationsScheduler", "progressScheduler"]) assert.ok(subscribed.includes(`${scheduler}.schedule()`));
  assert.ok(navbar.includes('scheduleUnreadMessagesRefresh("realtime-recovered")'), "existing Chat recovery retained");
  assert.ok(navbar.includes("refreshAllBadges();"));
  assert.ok(navbar.includes("focusOffer=${encodeURIComponent(offer.id)}"));
  assert.ok(navbar.includes("focusRequest=${encodeURIComponent(notification.request_id)}"));
});
test("all offer-page loads stay read-only; acknowledgment is attached to authorized rendered contexts", () => {
  for (const path of ["../app/offers/page.tsx", "../app/workshops/my-offers/page.tsx", "../app/workshops/won-jobs/page.tsx", "../app/customer/my-jobs/page.tsx"]) {
    const text = read(path);
    assert.doesNotMatch(text, /(?:customer_read_at|workshop_read_at):\s*new Date/);
    assert.doesNotMatch(text, /markNotificationsAsRead/);
    assert.ok(text.includes("observe({ requestId:")); assert.ok(text.includes("complete("));
  }
  assert.doesNotMatch(read("./services/offers/customer-offers.service.ts"), /\.update\(/);
});
test("confirmed appointment totals remain computed independently from receipts", () => {
  const text = read("../app/workshops/won-jobs/page.tsx");
  assert.match(text, /Programări/);
  assert.match(text, /getJobState\(job\)/);
  assert.doesNotMatch(text, /filter\([^\n]*workshop_read_at[^\n]*\)\s*\.length/);
});

function focusFixture(search: string, available: boolean) {
  let effect!: () => void; const ref = { current: "" }; const calls: string[] = [];
  const exported: Record<string, unknown> = {};
  const element = { scrollIntoView: () => calls.push("scroll"), classList: { add: (...classes: string[]) => calls.push(classes.join(" ")) } };
  new Function("require", "exports", "window", "document", compile(read("./hooks/useNotificationFocus.ts")))(
    () => ({ useRef: () => ref, useEffect: (fn: () => void) => { effect = fn; } }), exported,
    { location: { search } }, { querySelector: (selector: string) => { calls.push(selector); return available ? element : null; } });
  (exported.useNotificationFocus as () => void)(); return { run: () => effect(), calls };
}
for (const kind of ["Offer", "Request"]) test(`focus${kind} scrolls/highlights only an authorized rendered card, once`, () => {
  const id = "10000000-0000-4000-8000-000000000001";
  const f = focusFixture(`?focus${kind}=${id}`, true); f.run(); f.run();
  assert.equal(f.calls[0], `[data-focus-${kind.toLowerCase()}="${id}"]`);
  assert.equal(f.calls.filter(call => call === "scroll").length, 1); assert.ok(f.calls.includes("ring-2 ring-orange-500"));
  const missing = focusFixture(`?focus${kind}=${id}`, false); missing.run(); assert.ok(!missing.calls.includes("scroll"));
});
test("invalid focus parameter cannot select arbitrary DOM or mark notifications", () => {
  const f = focusFixture('?focusOffer=bad%22%5D', true); f.run(); assert.deepEqual(f.calls, []);
});
