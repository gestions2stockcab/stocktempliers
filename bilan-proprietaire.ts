// SimSimStock - bilan du lundi pour le propriétaire (fonction Supabase, appelée chaque lundi matin par pg_cron)
// Un e-mail avec, pour chacun de ses cabinets : activité de la semaine, cabinets calmes ou inactifs, ruptures,
// articles à commander, achats de la semaine, retards du labo et échéances des 7 prochains jours.
// Secrets : RECAP_SECRET (le même que le récap du lundi), SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM.

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
const esc = (s: string) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const eur = (n: number) => (Math.round(n * 100) / 100).toLocaleString("fr-FR", { minimumFractionDigits: 0, maximumFractionDigits: 0 }).replace(/[  ]/g, " ") + " €";
const DAY = 86400000;
const iso = (d: Date) => d.toISOString().slice(0, 10);

export type Bilan = { name: string; mv7: number; mvPrev: number; msg7: number; ster7: number; last: string; statut: string; rupt: string[]; bas: number; achats7: number; laboLate: number; echeances: string[] };

export function computeBilan(c: Row, d: { items: Row[]; mv: Row[]; msgs: Row[]; ster: Row[]; vues: Row[]; achats: Row[]; labo: Row[]; equip: Row[]; contrats: Row[] }, now = new Date()): Bilan {
  const t = now.getTime(), since7 = new Date(t - 7 * DAY).toISOString(), since14 = new Date(t - 14 * DAY).toISOString(), in7 = iso(new Date(t + 7 * DAY)), today = iso(now);
  const tracked = d.items.filter((x) => !x.archived && x.tracked !== false);
  const rupt = tracked.filter((x) => (Number(x.qty) || 0) <= 0).map((x) => String(x.name));
  const bas = tracked.filter((x) => (Number(x.qty) || 0) > 0 && (Number(x.qty) || 0) <= (Number(x.min) || 0)).length;
  const mv7 = d.mv.filter((x) => x.created_at >= since7).length, mvPrev = d.mv.filter((x) => x.created_at >= since14 && x.created_at < since7).length;
  const dates = [...d.mv.map((x) => x.created_at), ...d.msgs.map((x) => x.created_at), ...d.ster.map((x) => x.fait_at), ...d.vues.map((x) => x.vu_at)].filter(Boolean).sort();
  const last = dates.length ? String(dates[dates.length - 1]) : "";
  const age = last ? Math.floor((t - Date.parse(last)) / DAY) : null;
  const statut = age === null ? "jamais utilisé" : age <= 7 ? "actif" : age <= 30 ? "calme" : "inactif depuis " + age + " j";
  const achats7 = d.achats.filter((x) => String(x.doc_date || "") >= iso(new Date(t - 7 * DAY))).reduce((a, x) => a + (x.doc_type === "avoir" ? -1 : 1) * (Number(x.total_ht) || 0), 0);
  const laboLate = d.labo.filter((x) => x.statut === "envoye" && x.retour_prevu && x.retour_prevu < today).length;
  const echeances: string[] = [];
  d.equip.filter((e) => !e.archived && e.next_check && e.next_check >= today && e.next_check <= in7).forEach((e) => echeances.push("Maintenance " + e.name + " le " + e.next_check.split("-").reverse().join("/")));
  d.contrats.filter((x) => !x.archived && x.renews_on && x.auto_renew && Number(x.notice_days) > 0).forEach((x) => {
    const dl = new Date(Date.parse(x.renews_on + "T12:00:00") - Number(x.notice_days) * DAY); const s = iso(dl);
    if (s >= today && s <= in7) echeances.push("Dernier jour pour résilier « " + x.name + " » le " + s.split("-").reverse().join("/"));
  });
  return { name: String(c.name), mv7, mvPrev, msg7: d.msgs.filter((x) => x.created_at >= since7).length, ster7: d.ster.filter((x) => x.fait_at >= since7).length, last, statut, rupt, bas, achats7, laboLate, echeances };
}

export function renderBilan(list: Bilan[], now = new Date()) {
  const date = now.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
  const actifs = list.filter((b) => b.statut === "actif").length;
  const subject = "Bilan du lundi · " + actifs + "/" + list.length + " cabinets actifs" + (list.some((b) => b.rupt.length) ? " · ruptures à voir" : "");
  const lines: string[] = ["Bilan du " + date, ""];
  let html = "<div style=\"font-family:Arial,sans-serif;font-size:14px;color:#171a20;max-width:640px\"><h2 style=\"margin:0 0 4px\">Bilan du lundi</h2><p style=\"color:#5c5e62;margin:0 0 16px\">" + esc(date) + " · " + actifs + " cabinet(s) actif(s) sur " + list.length + "</p>";
  for (const b of list) {
    const trend = b.mvPrev >= 5 ? Math.round((b.mv7 - b.mvPrev) / b.mvPrev * 100) : null;
    const pts = [
      "Statut : " + b.statut + " · " + b.mv7 + " mouvement(s) de stock" + (trend !== null ? " (" + (trend >= 0 ? "+" : "") + trend + " % vs semaine d'avant)" : "") + ", " + b.msg7 + " message(s), " + b.ster7 + " enregistrement(s) de stérilisation",
      b.rupt.length ? "Ruptures (" + b.rupt.length + ") : " + b.rupt.slice(0, 6).join(", ") + (b.rupt.length > 6 ? "…" : "") : "Aucune rupture",
      b.bas ? b.bas + " article(s) sous le seuil" : "",
      b.achats7 ? "Achats importés cette semaine : " + eur(b.achats7) + " HT" : "",
      b.laboLate ? b.laboLate + " travail(aux) de labo en retard" : "",
      ...b.echeances,
    ].filter(Boolean);
    lines.push("■ " + b.name, ...pts.map((p) => "  - " + p), "");
    const color = b.statut === "actif" ? "#1a7f37" : b.statut === "calme" ? "#b58100" : "#c62828";
    html += "<div style=\"border:1px solid #e5e7eb;border-radius:10px;padding:12px 14px;margin:0 0 12px\"><div style=\"font-weight:700;font-size:16px\">" + esc(b.name) + " <span style=\"font-size:12px;color:" + color + "\">● " + esc(b.statut) + "</span></div><ul style=\"margin:6px 0 0;padding-left:18px\">" + pts.map((p) => "<li style=\"margin:3px 0\">" + esc(p) + "</li>").join("") + "</ul></div>";
  }
  html += "<p style=\"color:#5c5e62;font-size:12px\">Envoyé automatiquement chaque lundi par SimSimStock. Le détail est dans l'appli : 👑 Admin → Tableau de bord.</p></div>";
  lines.push("Le détail est dans l'appli : Admin → Tableau de bord.");
  return { subject, text: lines.join("\n"), html };
}

async function getAll(base: string, key: string, table: string, query: string): Promise<Row[]> {
  const out: Row[] = [];
  for (let from = 0; ; from += 1000) {
    const r = await fetch(`${base}/rest/v1/${table}?${query}`, { headers: { apikey: key, Authorization: `Bearer ${key}`, Range: `${from}-${from + 999}`, "Range-Unit": "items" } });
    if (!r.ok) throw new Error(table + " " + r.status);
    const rows = await r.json();
    out.push(...rows);
    if (rows.length < 1000) break;
  }
  return out;
}
async function optional(base: string, key: string, table: string, query: string): Promise<Row[]> { try { return await getAll(base, key, table, query); } catch (_e) { return []; } }
async function sendMail(to: string, subject: string, text: string, html: string) {
  const hook = (globalThis as any).__sendMail;
  if (hook) return hook(to, subject, text, html);
  const host = Deno.env.get("SMTP_HOST") || "", port = Number(Deno.env.get("SMTP_PORT") || "465");
  const user = Deno.env.get("SMTP_USER") || "", pass = Deno.env.get("SMTP_PASS") || "", from = Deno.env.get("SMTP_FROM") || user;
  if (!host || !user || !pass) throw new Error("smtp_non_configure");
  const { SMTPClient } = await import("https://deno.land/x/denomailer@1.6.0/mod.ts");
  const client = new SMTPClient({ connection: { hostname: host, port, tls: port === 465, auth: { username: user, password: pass } } });
  try { await client.send({ from, to, subject, content: text, html }); } finally { await client.close(); }
}

export async function run(body: Row, env: { base: string; key: string }, now = new Date()) {
  const { base, key } = env, t = now.getTime();
  const since14 = new Date(t - 14 * DAY).toISOString(), since7d = iso(new Date(t - 7 * DAY));
  const cabinets = await getAll(base, key, "cabinets", "select=id,name&order=name");
  const [items, mv, msgs, ster, vues, achats, labo, equip, contrats] = await Promise.all([
    optional(base, key, "items", "select=cabinet_id,name,qty,min,tracked,archived"),
    optional(base, key, "movements", `select=cabinet_id,created_at&created_at=gte.${since14}`),
    optional(base, key, "messages", `select=cabinet_id,created_at&created_at=gte.${since14}`),
    optional(base, key, "sterilisation_registre", `select=cabinet_id,fait_at&fait_at=gte.${since14}`),
    optional(base, key, "derniere_vue", "select=cabinet_id,vu_at"),
    optional(base, key, "achat_lignes", `select=cabinet_id,doc_type,doc_date,total_ht&doc_date=gte.${since7d}`),
    optional(base, key, "labo_travaux", "select=cabinet_id,statut,retour_prevu&statut=eq.envoye"),
    optional(base, key, "equipements", "select=cabinet_id,name,next_check,archived"),
    optional(base, key, "contrats", "select=cabinet_id,name,renews_on,notice_days,auto_renew,archived"),
  ]);
  const of = (a: Row[], id: string) => a.filter((x) => x.cabinet_id === id);
  const list = cabinets.map((c) => computeBilan(c, { items: of(items, c.id), mv: of(mv, c.id), msgs: of(msgs, c.id), ster: of(ster, c.id), vues: of(vues, c.id), achats: of(achats, c.id), labo: of(labo, c.id), equip: of(equip, c.id), contrats: of(contrats, c.id) }, now));
  const mail = renderBilan(list, now);
  const test = typeof body.test === "string" ? body.test.trim() : "";
  let to: string[] = [];
  if (test && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(test)) to = [test];
  else {
    const owners = await getAll(base, key, "proprietaires", "select=user_id");
    for (const o of owners) {
      const r = await fetch(`${base}/auth/v1/admin/users/${o.user_id}`, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
      const e = r.ok ? String((await r.json()).email || "") : ""; if (e && to.indexOf(e) === -1) to.push(e);
    }
  }
  for (const e of to) await sendMail(e, mail.subject, mail.text, mail.html);
  return { ok: true, envoyes: to.length, cabinets: list.length };
}

if (typeof Deno !== "undefined" && (Deno as any).serve && !(globalThis as any).__test) {
  Deno.serve(async (req: Request) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
    if (!sameSecret(req.headers.get("x-cron-secret") || "", Deno.env.get("RECAP_SECRET") || "")) return json({ ok: false, error: "non_autorise" }, 401);
    let body: Row = {};
    try { body = await req.json(); } catch (_e) { body = {}; }
    const base = (Deno.env.get("SUPABASE_URL") || "").replace(/\/+$/, ""), key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    if (!base || !key) return json({ ok: false, error: "environnement_incomplet" }, 500);
    try { return json(await run(body, { base, key })); } catch (e) { return json({ ok: false, error: e instanceof Error ? e.message : "erreur" }, 500); }
  });
}
