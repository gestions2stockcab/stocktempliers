// SimSimStock - rapport mensuel par e-mail (fonction Supabase, appelee le 1er de chaque mois par pg_cron)
// Pour chaque administrateur : un e-mail par mois avec, pour chacun de ses cabinets, les achats du mois (et la variation),
// les fournisseurs, les domaines, les produits les plus achetes, les ruptures du jour, les equipements achetes et la vie de l'equipe.
// Les adresses supplementaires (par exemple le comptable) se declarent dans le secret RAPPORT_CC (adresses separees par des virgules).
// Secrets a definir dans Supabase : RECAP_SECRET (le meme que le recap du lundi), SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM, et RAPPORT_CC (facultatif).

type Row = Record<string, any>;
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const DAY = 86400000;
export const ymLabel = (ym: string) => MOIS[Number(ym.slice(5, 7)) - 1] + " " + ym.slice(0, 4);
export function ymPrev(ym: string): string { const y = Number(ym.slice(0, 4)), m = Number(ym.slice(5, 7)); const d = new Date(y, m - 2, 1); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0"); }
export function lastMonth(now = new Date()): string { const d = new Date(now.getFullYear(), now.getMonth() - 1, 1); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0"); }
const eur = (n: number) => (Math.round(n * 100) / 100).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/[\u202f\u00a0]/g, " ") + " €";
const esc = (s: string) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export type Report = {
  ym: string; label: string; cabinet: string; total: number; prevTotal: number; nbDocs: number;
  suppliers: { name: string; amount: number }[]; domains: { name: string; amount: number }[]; products: { name: string; qty: number; amount: number }[];
  rupt: string[]; bas: number; eq: { name: string; price: number; supplier: string }[]; eqTotal: number; tasksDone: number; ctlDone: number;
};

// Memes regles que l'ecran « Depenses » de l'appli : une facture remplacee par une refacturation et un avoir d'annulation ne comptent pas, un vrai avoir se deduit.
export function spendRows(lines: Row[], docs: Row[]): { date: string; amount: number; supplier: string; category: string; ref: string; name: string; qty: number; doc: string }[] {
  const byNum: Record<string, Row> = {}; for (const d of docs) byNum[d.doc_number] = d;
  const replaced: Record<string, boolean> = {};
  for (const d of docs) for (const x of String(d.remplace || "").split(",")) { const t = x.trim(); if (t) replaced[t] = true; }
  const out: any[] = [];
  for (const l of lines) {
    const d = byNum[l.doc_number] || {}, type = l.doc_type || d.doc_type || "facture";
    if (replaced[l.doc_number]) continue;
    if (type === "avoir" && (d.annule_de || "")) continue;
    const date = String(l.doc_date || d.doc_date || String(d.created_at || "").slice(0, 10) || "").slice(0, 10);
    if (!date) continue;
    const sign = type === "avoir" ? -1 : 1;
    out.push({ date, amount: sign * (Number(l.total_ht) || 0), supplier: l.supplier || d.supplier || "Sans fournisseur", category: l.category || "Sans domaine", ref: l.ref || "", name: l.name, qty: sign * (Number(l.qty) || 0), doc: l.doc_number });
  }
  return out;
}
const sum = (a: { amount: number }[]) => a.reduce((t, r) => t + r.amount, 0);
function group(rows: { amount: number }[], key: string) { const m: Record<string, number> = {}; for (const r of rows as any[]) { const k = r[key] || "—"; m[k] = (m[k] || 0) + r.amount; } return Object.keys(m).map((k) => ({ name: k, amount: m[k] })).sort((a, b) => b.amount - a.amount); }

export function computeReport(ym: string, cabinet: string, d: { lines: Row[]; docs: Row[]; items: Row[]; equipements: Row[]; messages?: Row[]; logs?: Row[] }): Report {
  const rows = spendRows(d.lines, d.docs), inM = (iso: any) => String(iso || "").slice(0, 7) === ym;
  const m = rows.filter((r) => r.date.slice(0, 7) === ym), pm = ymPrev(ym);
  const prod: Record<string, { name: string; qty: number; amount: number }> = {};
  for (const r of m) { const k = r.ref || r.name; prod[k] = prod[k] || { name: r.name, qty: 0, amount: 0 }; prod[k].qty += r.qty; prod[k].amount += r.amount; }
  const docs: Record<string, boolean> = {}; for (const r of m) docs[r.doc] = true;
  const rupt: string[] = []; let bas = 0;
  for (const it of d.items) { if (it.tracked === false || it.archived === true) continue; const q = Number(it.qty) || 0, mn = Number(it.min) || 0; if (q <= 0) rupt.push(it.name); else if (q <= mn) bas++; }
  const eq = d.equipements.filter((e) => inM(e.bought_on) && e.purchase_price != null).map((e) => ({ name: e.name, price: Number(e.purchase_price) || 0, supplier: e.purchase_supplier || "" }));
  return { ym, label: ymLabel(ym), cabinet, total: sum(m), prevTotal: sum(rows.filter((r) => r.date.slice(0, 7) === pm)), nbDocs: Object.keys(docs).length,
    suppliers: group(m, "supplier"), domains: group(m, "category"), products: Object.values(prod).sort((a, b) => b.amount - a.amount).slice(0, 10),
    rupt: rupt.sort((a, b) => a.localeCompare(b, "fr", { sensitivity: "base" })), bas, eq, eqTotal: eq.reduce((t, e) => t + e.price, 0),
    tasksDone: (d.messages || []).filter((x) => x.kind === "tache" && inM(x.done_at)).length, ctlDone: (d.logs || []).filter((x) => inM(x.done_at)).length };
}

export function composeMonthly(reports: Report[], siteUrl = "https://stock.simsimstock.fr") {
  const label = reports[0] ? reports[0].label : "";
  const subject = "Rapport mensuel " + label + " · " + reports.map((r) => r.cabinet).join(", ");
  const text: string[] = ["Rapport mensuel " + label, ""];
  const html: string[] = [`<div style="font-family:Arial,Helvetica,sans-serif;color:#0b1b3a;max-width:680px"><div style="background:linear-gradient(120deg,#2f67ff,#7b55ff);color:#fff;border-radius:16px;padding:22px 24px"><div style="font-size:13px;opacity:.85">SimSimStock</div><div style="font-size:26px;font-weight:700;margin-top:4px">Rapport mensuel</div><div style="font-size:15px;margin-top:2px">${esc(label.charAt(0).toUpperCase() + label.slice(1))}</div></div>`];
  for (const r of reports) {
    const delta = r.prevTotal ? Math.round((r.total - r.prevTotal) / r.prevTotal * 100) : null;
    text.push("== " + r.cabinet + " ==", "Achats HT : " + eur(r.total) + (delta === null ? "" : " (" + (delta >= 0 ? "+" : "") + delta + " % vs mois précédent)"), "Factures : " + r.nbDocs);
    html.push(`<h3 style="margin:22px 0 8px;border-bottom:2px solid #e3e8f2;padding-bottom:5px">${esc(r.cabinet)}</h3>`,
      `<table style="width:100%;border-collapse:collapse"><tr><td style="padding:10px;background:#f4f7ff;border-radius:10px"><div style="font-size:11px;color:#5b6b8a">ACHATS HT</div><div style="font-size:20px;font-weight:700">${eur(r.total)}</div><div style="font-size:12px;color:#5b6b8a">${delta === null ? "pas de mois précédent" : (delta >= 0 ? "+" : "") + delta + " % vs mois précédent"}</div></td><td style="width:8px"></td><td style="padding:10px;background:#f4f7ff;border-radius:10px"><div style="font-size:11px;color:#5b6b8a">FACTURES</div><div style="font-size:20px;font-weight:700">${r.nbDocs}</div><div style="font-size:12px;color:#5b6b8a">${r.suppliers.length} fournisseur${r.suppliers.length > 1 ? "s" : ""}</div></td><td style="width:8px"></td><td style="padding:10px;background:#f4f7ff;border-radius:10px"><div style="font-size:11px;color:#5b6b8a">RUPTURES</div><div style="font-size:20px;font-weight:700">${r.rupt.length}</div><div style="font-size:12px;color:#5b6b8a">${r.bas} sous le seuil</div></td></tr></table>`);
    const block = (title: string, list: string[]) => { if (!list.length) return; text.push(title + " : " + list.join(" ; ")); html.push(`<p style="margin:10px 0 2px"><b>${esc(title)}</b></p><p style="margin:0;color:#44546f;line-height:1.5">${list.map(esc).join("<br>")}</p>`); };
    block("Fournisseurs", r.suppliers.slice(0, 6).map((s) => s.name + " : " + eur(s.amount) + (r.total ? " (" + Math.round(s.amount / r.total * 100) + " %)" : "")));
    block("Domaines", r.domains.slice(0, 6).map((s) => s.name + " : " + eur(s.amount)));
    block("Produits les plus achetés", r.products.slice(0, 5).map((p) => p.name + " × " + p.qty + " : " + eur(p.amount)));
    block("Achats d'équipement", r.eq.map((e) => e.name + (e.supplier ? " (" + e.supplier + ")" : "") + " : " + eur(e.price)));
    block("Ruptures aujourd'hui", r.rupt.length ? [r.rupt.slice(0, 15).join(", ") + (r.rupt.length > 15 ? " … et " + (r.rupt.length - 15) + " autres" : "")] : []);
    block("Vie de l'équipe", ["Tâches faites : " + r.tasksDone, "Contrôles réalisés : " + r.ctlDone]);
    text.push("");
  }
  text.push(siteUrl + "  (le PDF détaillé se télécharge dans l'appli : Achats, Rapport mensuel)");
  html.push(`<p style="margin-top:22px"><a href="${siteUrl}" style="background:#2f67ff;color:#fff;text-decoration:none;padding:10px 16px;border-radius:10px">Ouvrir SimSimStock</a></p><p style="color:#8a96b0;font-size:12px">Le PDF détaillé se télécharge dans l'appli : Achats, puis « Rapport mensuel ».</p></div>`);
  return { subject, text: text.join("\n"), html: html.join("") };
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
async function optional(base: string, key: string, table: string, queries: string[]): Promise<Row[]> {
  for (const q of queries) { try { return await getAll(base, key, table, q); } catch (_e) { /* table ou colonne absente : on essaie plus simple */ } }
  return [];
}
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

export async function run(body: Row, env: { base: string; key: string; cc?: string }, now = new Date()) {
  const { base, key } = env;
  const ym = /^\d{4}-\d{2}$/.test(String(body.month || "")) ? String(body.month) : lastMonth(now);
  const since = ymPrev(ymPrev(ym)) + "-01";
  const cabinets = await getAll(base, key, "cabinets", "select=id,name&order=name");
  const lines = await optional(base, key, "achat_lignes", [`select=cabinet_id,doc_number,doc_type,doc_date,supplier,ref,name,category,qty,total_ht&doc_date=gte.${since}`]);
  const docs = await optional(base, key, "imported_docs", ["select=cabinet_id,doc_number,doc_type,doc_date,supplier,remplace,annule_de,created_at"]);
  const items = await optional(base, key, "items", ["select=cabinet_id,name,qty,min,tracked,archived", "select=cabinet_id,name,qty,min"]);
  const equipements = await optional(base, key, "equipements", ["select=cabinet_id,name,bought_on,purchase_price,purchase_supplier", "select=cabinet_id,name,bought_on"]);
  const messages = await optional(base, key, "messages", [`select=cabinet_id,kind,done_at&kind=eq.tache&done_at=gte.${ym}-01`]);
  const logs = await optional(base, key, "controle_logs", [`select=cabinet_id,done_at&done_at=gte.${ym}-01`]);
  const members = await getAll(base, key, "members", "select=cabinet_id,user_id,role&role=eq.admin");
  const reportOf: Record<string, Report> = {};
  for (const c of cabinets) {
    const of = (a: Row[]) => a.filter((x) => x.cabinet_id === c.id);
    reportOf[c.id] = computeReport(ym, c.name, { lines: of(lines), docs: of(docs), items: of(items), equipements: of(equipements), messages: of(messages), logs: of(logs) });
  }
  const byEmail: Record<string, string[]> = {};
  const test = typeof body.test === "string" ? body.test.trim() : "";
  if (test) byEmail[test] = cabinets.map((c) => c.id);
  else {
    const emailOf: Record<string, string> = {};
    for (const m of members) {
      if (!emailOf[m.user_id]) { const r = await fetch(`${base}/auth/v1/admin/users/${m.user_id}`, { headers: { apikey: key, Authorization: `Bearer ${key}` } }); emailOf[m.user_id] = r.ok ? String((await r.json()).email || "") : ""; }
      const em = emailOf[m.user_id];
      if (em && reportOf[m.cabinet_id]) (byEmail[em] = byEmail[em] || []).push(m.cabinet_id);
    }
    // adresses supplementaires (comptable…) : elles recoivent le rapport de tous les cabinets
    for (const cc of String(env.cc || "").split(/[,;\s]+/).map((x) => x.trim()).filter((x) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x))) byEmail[cc] = cabinets.map((c) => c.id);
  }
  const sent: string[] = [], errors: string[] = [];
  for (const [email, ids] of Object.entries(byEmail)) {
    const reports = ids.map((id) => reportOf[id]).filter(Boolean);
    if (!reports.length) continue;
    const mail = composeMonthly(reports);
    if (body.dry) { sent.push(email + " (simulation)"); continue; }
    try { await sendMail(email, mail.subject, mail.text, mail.html); sent.push(email); } catch (e) { errors.push(email + " : " + (e instanceof Error ? e.message : "erreur")); }
  }
  return { ok: errors.length === 0, mois: ym, envoyes: sent, erreurs: errors, cabinets: cabinets.length };
}

if (typeof Deno !== "undefined" && Deno.serve) {
  Deno.serve(async (req: Request) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
    const secret = Deno.env.get("RECAP_SECRET") || "";
    if (!secret || req.headers.get("x-cron-secret") !== secret) return json({ ok: false, error: "non_autorise" }, 401);
    let body: Row = {};
    try { body = await req.json(); } catch (_e) { body = {}; }
    const base = (Deno.env.get("SUPABASE_URL") || "").replace(/\/+$/, ""), key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    if (!base || !key) return json({ ok: false, error: "environnement_incomplet" }, 500);
    try { return json(await run(body, { base, key, cc: Deno.env.get("RAPPORT_CC") || "" })); } catch (e) { return json({ ok: false, error: e instanceof Error ? e.message : "erreur" }, 500); }
  });
}
