// SimSimStock - rappels automatiques (fonction Supabase, appelee par pg_cron)
//   mode "routines" (toutes les heures) : une routine du jour pas terminee a l'heure de rappel qu'elle demande -> notification ;
//   mode "matin" (chaque jour a 8 h, heure de Paris) : echeances du jour (controles, maintenances, contrats) ;
//                le lundi en plus : peremptions de la semaine, retards, garanties qui se terminent.
// Secrets a definir dans Supabase : RECAP_SECRET (le meme que le recap du lundi), VAPID_PUBLIC, VAPID_PRIVATE, VAPID_SUBJECT.

type Row = Record<string, any>;
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
// Comparaison en temps constant : la durée de la vérification ne renseigne pas sur la clé attendue.
const sameSecret = (got: string, want: string) => {
  if (!want) return false;
  const a = new TextEncoder().encode(got), b = new TextEncoder().encode(want);
  let diff = a.length ^ b.length;
  for (let i = 0; i < b.length; i++) diff |= (a[i] ?? 0) ^ b[i];
  return diff === 0;
};
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const DAY = 86400000;
const cut = (s: string, n: number) => { s = String(s || "").replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n - 1) + "…" : s; };

// date et heure a Paris, quel que soit le fuseau du serveur (et l'heure d'ete)
export function parisNow(now = new Date()) {
  const f = new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23", weekday: "short" }).formatToParts(now);
  const g = (t: string) => f.find((x) => x.type === t)?.value || "";
  const dow = ({ "lun.": 1, "mar.": 2, "mer.": 3, "jeu.": 4, "ven.": 5, "sam.": 6, "dim.": 7 } as Record<string, number>)[g("weekday")] || 0;
  return { iso: `${g("year")}-${g("month")}-${g("day")}`, hour: parseInt(g("hour"), 10), dow, day: parseInt(g("day"), 10) };
}
const addDays = (iso: string, n: number) => new Date(new Date(iso + "T12:00:00Z").getTime() + n * DAY).toISOString().slice(0, 10);
export function routineDue(r: Row, p: { dow: number; day: number }): boolean {
  if (r.freq === "hebdo") return p.dow === (r.jour || 1);
  if (r.freq === "mensuel") return p.day === (r.jour || 1);
  return true;
}

export type Plan = { cabinet_id: string; cle: string; roles: "tous" | "admin"; profil?: string; payload: { title: string; body: string; tag: string; tab: string } };

// Routines du jour pas terminees a l'heure de rappel (fonction pure, testee)
export function planRoutines(routines: Row[], coches: Row[], p: { iso: string; hour: number; dow: number; day: number }): Plan[] {
  const out: Plan[] = [];
  for (const r of routines) {
    if (r.archived || !r.rappel_heure || parseInt(r.rappel_heure, 10) !== p.hour || !routineDue(r, p)) continue;
    const steps = Array.isArray(r.etapes) ? r.etapes.length : 0; if (!steps) continue;
    const done = coches.filter((c) => c.routine_id === r.id && c.jour === p.iso).length;
    if (done >= steps) continue;
    out.push({ cabinet_id: r.cabinet_id, cle: "routine:" + r.id, roles: "tous", profil: r.profil || "", payload: {
      title: "⏰ " + cut(r.name, 40) + " : pas terminée",
      body: done ? (steps - done) + " étape" + (steps - done > 1 ? "s" : "") + " sur " + steps + " restent à cocher." : "Aucune étape cochée pour l'instant (" + steps + " à faire).", tag: "routine-" + r.id, tab: "routines" } });
  }
  return out;
}

// Echeances et peremptions (fonction pure, testee). data : par cabinet, listes deja chargees.
export function planMorning(d: { cabinets: Row[]; lots: Row[]; items: Row[]; controles: Row[]; equipements: Row[]; contrats: Row[] }, p: { iso: string; dow: number }): Plan[] {
  const out: Plan[] = [], monday = p.dow === 1;
  for (const c of d.cabinets) {
    const mine = (a: Row[]) => a.filter((x) => x.cabinet_id === c.id);
    const lines: string[] = [], head: string[] = [];
    // contrôles : echeance = dernier controle + frequence
    const ctl = mine(d.controles).map((x) => ({ n: x.name, due: x.last_done_at ? addDays(String(x.last_done_at).slice(0, 10), Number(x.every_days) || 0) : p.iso })).filter((x) => Number(mine(d.controles).find((y) => y.name === x.n)?.every_days) > 0);
    const ctlToday = ctl.filter((x) => x.due === p.iso).map((x) => x.n), ctlLate = ctl.filter((x) => x.due < p.iso).map((x) => x.n);
    if (ctlToday.length) lines.push("Contrôle" + (ctlToday.length > 1 ? "s" : "") + " à faire aujourd'hui : " + ctlToday.slice(0, 3).join(", "));
    if (monday && ctlLate.length) lines.push(ctlLate.length + " contrôle" + (ctlLate.length > 1 ? "s" : "") + " en retard : " + ctlLate.slice(0, 3).join(", "));
    // maintenance et garanties des equipements
    const eq = mine(d.equipements).filter((x) => !x.archived);
    const mToday = eq.filter((x) => x.next_check === p.iso).map((x) => x.name), mLate = eq.filter((x) => x.next_check && x.next_check < p.iso).map((x) => x.name), mWeek = eq.filter((x) => x.next_check && x.next_check > p.iso && x.next_check <= addDays(p.iso, 7)).map((x) => x.name);
    if (mToday.length) lines.push("Maintenance prévue aujourd'hui : " + mToday.slice(0, 3).join(", "));
    if (monday && mLate.length) lines.push(mLate.length + " maintenance" + (mLate.length > 1 ? "s" : "") + " en retard : " + mLate.slice(0, 3).join(", "));
    if (monday && mWeek.length) lines.push("Maintenance cette semaine : " + mWeek.slice(0, 3).join(", "));
    const war = eq.filter((x) => x.warranty_until && x.warranty_until >= p.iso && x.warranty_until <= addDays(p.iso, 30)).map((x) => x.name);
    if (monday && war.length) lines.push("Garantie qui se termine dans 30 jours : " + war.slice(0, 3).join(", "));
    // contrats : date limite pour resilier = renouvellement - preavis
    const ct = mine(d.contrats).filter((x) => !x.archived && x.renews_on).map((x) => ({ n: x.name, limit: addDays(String(x.renews_on).slice(0, 10), -(Number(x.notice_days) || 0)) }));
    const ctToday = ct.filter((x) => x.limit === p.iso).map((x) => x.n), ctSoon = ct.filter((x) => x.limit > p.iso && x.limit <= addDays(p.iso, 30)).map((x) => x.n);
    if (ctToday.length) lines.push("Dernier jour pour résilier ou renégocier : " + ctToday.slice(0, 3).join(", "));
    if (monday && ctSoon.length) lines.push("Contrat à décider d'ici 30 jours : " + ctSoon.slice(0, 3).join(", "));
    // peremptions de la semaine (le lundi) : lots, sinon date portee par l'article
    if (monday) {
      const lotsOf = mine(d.lots).filter((x) => Number(x.qty) > 0 && x.expiry), byItem = new Map(mine(d.items).map((x) => [x.id, x.name]));
      const soon = lotsOf.filter((x) => String(x.expiry) >= p.iso && String(x.expiry) <= addDays(p.iso, 7)).map((x) => byItem.get(x.item_id) || "Article");
      const itemsSoon = mine(d.items).filter((x) => x.expiry && !lotsOf.some((l) => l.item_id === x.id) && String(x.expiry) >= p.iso && String(x.expiry) <= addDays(p.iso, 7)).map((x) => x.name);
      const gone = lotsOf.filter((x) => String(x.expiry) < p.iso).length;
      const all = [...new Set([...soon, ...itemsSoon])];
      if (all.length) head.push(all.length + " produit" + (all.length > 1 ? "s" : "") + " périme" + (all.length > 1 ? "nt" : "") + " cette semaine : " + all.slice(0, 4).join(", ") + (all.length > 4 ? "…" : ""));
      if (gone) head.push(gone + " lot" + (gone > 1 ? "s" : "") + " déjà périmé" + (gone > 1 ? "s" : "") + " encore en stock");
    }
    const body = [...head, ...lines];
    if (!body.length) continue;
    out.push({ cabinet_id: c.id, cle: "matin", roles: "admin", payload: { title: (monday ? "📋 Semaine · " : "📋 Aujourd'hui · ") + cut(c.name, 30), body: cut(body.join(" · "), 230), tag: "matin-" + c.id, tab: monday ? "accueil" : "accueil" } });
  }
  return out;
}

async function rest(base: string, key: string, path: string, init?: Record<string, any>): Promise<Row[]> {
  const r = await fetch(`${base}/rest/v1/${path}`, { ...(init || {}), headers: { apikey: key, Authorization: `Bearer ${key}`, ...(init?.headers || {}) } });
  if (!r.ok && !(init && init.method)) throw new Error(path.split("?")[0] + " " + r.status);
  if (init && init.method) return [{ status: r.status } as Row];
  return await r.json();
}
const optional = (base: string, key: string, path: string) => rest(base, key, path).catch(() => [] as Row[]);
async function sendPush(sub: Row, payload: Row, env: Row) {
  const hook = (globalThis as any).__sendPush;
  if (hook) return hook(sub, payload);
  const webpush = (await import("npm:web-push@3.6.7")).default;
  webpush.setVapidDetails(env.subject, env.pub, env.priv);
  return await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, JSON.stringify(payload), { TTL: 6 * 3600, urgency: "normal" });
}

export async function run(body: Row, env: { base: string; key: string; pub: string; priv: string; subject: string }, now = new Date()) {
  const { base, key } = env, p = parisNow(now), mode = body.type === "matin" ? "matin" : "routines";
  if (mode === "matin" && !body.force && p.hour !== (Number(body.heure) || 8)) return { ok: true, ignore: "pas la bonne heure à Paris", heure_paris: p.hour };
  const cabinets = await rest(base, key, "cabinets?select=id,name");
  let plans: Plan[] = [];
  if (mode === "routines") {
    const routines = await optional(base, key, "routines?select=id,cabinet_id,name,freq,jour,etapes,profil,rappel_heure,archived&rappel_heure=neq.");
    const coches = routines.length ? await optional(base, key, `routine_coches?select=routine_id,jour&jour=eq.${p.iso}`) : [];
    plans = planRoutines(routines, coches, p);
  } else {
    const [lots, items, controles, equipements, contrats] = await Promise.all(["lots?select=cabinet_id,item_id,expiry,qty", "items?select=id,cabinet_id,name,expiry", "controles?select=cabinet_id,name,every_days,last_done_at", "equipements?select=cabinet_id,name,next_check,warranty_until,archived", "contrats?select=cabinet_id,name,renews_on,notice_days,archived"].map((q) => optional(base, key, q)));
    plans = planMorning({ cabinets, lots, items, controles, equipements, contrats }, p);
  }
  if (!plans.length) return { ok: true, mode, envoyes: 0, plans: 0 };
  const members = await rest(base, key, "members?select=cabinet_id,user_id,role");
  const profils = await optional(base, key, "equipe_profils?select=cabinet_id,user_id,profil");
  const subs = await optional(base, key, "push_abonnements?select=id,user_id,endpoint,p256dh,auth,prefs");
  let sent = 0, skipped = 0, gone = 0; const errors: string[] = [], detail: string[] = [];
  for (const pl of plans) {
    const cab = members.filter((m) => m.cabinet_id === pl.cabinet_id && m.role !== "viewer");
    let targets = pl.roles === "admin" ? cab.filter((m) => m.role === "admin") : cab;
    if (pl.profil) { const withProfil = targets.filter((m) => profils.some((x) => x.cabinet_id === m.cabinet_id && x.user_id === m.user_id && x.profil === pl.profil)); if (withProfil.length) targets = withProfil; }
    if (body.test) targets = targets.filter((m) => m.user_id === body.test);
    if (!targets.length) { skipped++; continue; }
    if (!body.dry && !body.test) {   // déjà envoyé aujourd'hui ?
      const r = await fetch(`${base}/rest/v1/rappels_envoyes`, { method: "POST", headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", Prefer: "resolution=ignore-duplicates,return=representation" }, body: JSON.stringify({ cabinet_id: pl.cabinet_id, cle: pl.cle, jour: p.iso }) });
      const rows = r.ok ? await r.json() : [];
      if (r.ok && !rows.length) { skipped++; continue; }
    }
    detail.push(pl.payload.title + " → " + targets.length + " personne(s)");
    if (body.dry) continue;
    for (const t of targets) for (const s of subs.filter((x) => x.user_id === t.user_id)) {
      if ((s.prefs || {}).rappels === false) continue;
      try { await sendPush(s, pl.payload, env); sent++; }
      catch (e: any) { const code = e && (e.statusCode || e.status); if (code === 404 || code === 410) { gone++; await fetch(`${base}/rest/v1/push_abonnements?id=eq.${s.id}`, { method: "DELETE", headers: { apikey: key, Authorization: `Bearer ${key}` } }).catch(() => {}); } else errors.push(String(e && e.message || "erreur")); }
    }
  }
  return { ok: errors.length === 0, mode, plans: plans.length, envoyes: sent, ignores: skipped, appareils_supprimes: gone, erreurs: errors, detail };
}

if (typeof Deno !== "undefined" && Deno.serve) {
  Deno.serve(async (req: Request) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
    const secret = Deno.env.get("RECAP_SECRET") || "";
    if (!sameSecret(req.headers.get("x-cron-secret") || "", secret)) return json({ ok: false, error: "non_autorise" }, 401);
    let body: Row = {}; try { body = await req.json(); } catch (_e) { body = {}; }
    const base = (Deno.env.get("SUPABASE_URL") || "").replace(/\/+$/, ""), key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const pub = Deno.env.get("VAPID_PUBLIC") || "", priv = Deno.env.get("VAPID_PRIVATE") || "", subject = Deno.env.get("VAPID_SUBJECT") || "mailto:admin@example.com";
    if (!base || !key || !pub || !priv) return json({ ok: false, error: "environnement_incomplet" }, 500);
    try { return json(await run(body, { base, key, pub, priv, subject })); } catch (e) { return json({ ok: false, error: e instanceof Error ? e.message : "erreur" }, 500); }
  });
}
