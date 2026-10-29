// SimSimStock - « Envoyer au fournisseur » : envoie le bon de commande par e-mail au commercial du fournisseur
// (adresse enregistrée dans le carnet « fournisseurs_contacts » du cabinet), avec la personne qui commande en copie
// et en adresse de réponse, puis garde la commande dans « commandes_envoyees ».
// Fonction Supabase appelée par l'appli avec la session de la personne connectée (en-tête x-user-token).
// Secrets : SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM (les mêmes que le rapport mensuel).
// SUPABASE_URL, SUPABASE_ANON_KEY et SUPABASE_SERVICE_ROLE_KEY sont fournis par Supabase.

type Row = Record<string, any>;
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-user-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const esc = (s: string) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const eur = (n: number) => (Math.round(n * 100) / 100).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/[  ]/g, " ") + " €";
const EMAIL = /^[^@\s,;]+@[^@\s,;]+\.[^@\s,;]+$/;
const MAX_PAR_HEURE = 20;   // garde-fou : pas plus de 20 commandes envoyées par heure et par cabinet

export type Ligne = { nom: string; ref: string; qte: number; unite: string; prix: number | null };
export function nettoyer(lignes: unknown): Ligne[] {
  return (Array.isArray(lignes) ? lignes : []).slice(0, 200).map((l: Row) => ({
    nom: String(l?.nom || "").replace(/\s+/g, " ").trim().slice(0, 200),
    ref: String(l?.ref || "").trim().slice(0, 60),
    qte: Math.max(0, Math.round((Number(l?.qte) || 0) * 100) / 100),
    unite: String(l?.unite || "").trim().slice(0, 30),
    prix: Number.isFinite(Number(l?.prix)) && Number(l?.prix) > 0 ? Number(l.prix) : null,
  })).filter((l) => l.nom && l.qte > 0);
}
export function composer(o: { cabinet: string; fournisseur: string; clientNo: string; par: string; message: string; lignes: Ligne[]; avecPrix: boolean }) {
  const total = o.lignes.reduce((a, l) => a + (l.prix !== null ? l.prix * l.qte : 0), 0);
  const subject = "Commande " + o.cabinet + " — " + o.fournisseur;
  const intro = o.message.trim() || "Bonjour,\n\nVoici notre commande. Merci de nous confirmer la prise en compte et le délai de livraison.";
  const text = intro + "\n\n" + (o.clientNo ? "N° client : " + o.clientNo + "\n" : "") +
    o.lignes.map((l) => "- " + l.qte + (l.unite ? " " + l.unite : "") + " × " + l.nom + (l.ref ? " (réf. " + l.ref + ")" : "")).join("\n") +
    (o.avecPrix && total ? "\n\nTotal estimé : " + eur(total) + " HT (d'après nos derniers prix)" : "") +
    "\n\nCordialement,\n" + o.par + "\n" + o.cabinet;
  const rows = o.lignes.map((l) => "<tr><td style=\"padding:6px 10px;border-bottom:1px solid #e5e7eb\">" + esc(l.ref || "") + "</td><td style=\"padding:6px 10px;border-bottom:1px solid #e5e7eb\">" + esc(l.nom) + "</td><td style=\"padding:6px 10px;border-bottom:1px solid #e5e7eb;text-align:right;white-space:nowrap\"><b>" + esc(String(l.qte)) + "</b>" + (l.unite ? " " + esc(l.unite) : "") + "</td></tr>").join("");
  const html = "<div style=\"font-family:Arial,sans-serif;font-size:14px;color:#171a20\">" +
    "<p>" + esc(intro).replace(/\n/g, "<br>") + "</p>" + (o.clientNo ? "<p><b>N° client :</b> " + esc(o.clientNo) + "</p>" : "") +
    "<table style=\"border-collapse:collapse;min-width:420px\"><thead><tr><th style=\"text-align:left;padding:6px 10px;border-bottom:2px solid #171a20\">Réf.</th><th style=\"text-align:left;padding:6px 10px;border-bottom:2px solid #171a20\">Désignation</th><th style=\"text-align:right;padding:6px 10px;border-bottom:2px solid #171a20\">Quantité</th></tr></thead><tbody>" + rows + "</tbody></table>" +
    (o.avecPrix && total ? "<p style=\"color:#5c5e62\">Total estimé : " + eur(total) + " HT (d'après nos derniers prix)</p>" : "") +
    "<p>Cordialement,<br>" + esc(o.par) + "<br><b>" + esc(o.cabinet) + "</b></p></div>";
  return { subject, text, html, total };
}

async function rest(base: string, key: string, path: string, init: RequestInit = {}) {
  const r = await fetch(base + "/rest/v1/" + path, { ...init, headers: { apikey: key, Authorization: "Bearer " + key, "Content-Type": "application/json", ...(init.headers || {}) } });
  if (!r.ok) throw new Error("rest_" + r.status);
  return r.status === 204 ? null : r.json();
}
async function sendMail(m: { to: string; cc: string[]; replyTo: string; subject: string; text: string; html: string }) {
  const hook = (globalThis as any).__sendMail;
  if (hook) return hook(m);
  const host = Deno.env.get("SMTP_HOST") || "", port = Number(Deno.env.get("SMTP_PORT") || "465");
  const user = Deno.env.get("SMTP_USER") || "", pass = Deno.env.get("SMTP_PASS") || "", from = Deno.env.get("SMTP_FROM") || user;
  if (!host || !user || !pass) throw new Error("smtp_non_configure");
  const { SMTPClient } = await import("https://deno.land/x/denomailer@1.6.0/mod.ts");
  const client = new SMTPClient({ connection: { hostname: host, port, tls: port === 465, auth: { username: user, password: pass } } });
  try { await client.send({ from, to: m.to, cc: m.cc.length ? m.cc : undefined, replyTo: m.replyTo || undefined, subject: m.subject, content: m.text, html: m.html }); } finally { await client.close(); }
}

export async function run(body: Row, token: string, env: { base: string; anon: string; key: string }) {
  const { base, anon, key } = env;
  if (!token) return { status: 401, out: { ok: false, error: "non_connecte" } };
  const ur = await fetch(base + "/auth/v1/user", { headers: { apikey: anon, Authorization: "Bearer " + token } });
  if (!ur.ok) return { status: 401, out: { ok: false, error: "non_connecte" } };
  const user = await ur.json();
  const cab = String(body.cabinet_id || ""), fournisseur = String(body.fournisseur || "").trim().slice(0, 120);
  if (!/^[0-9a-f-]{36}$/i.test(cab) || !fournisseur) return { status: 400, out: { ok: false, error: "demande_invalide" } };
  const mem = await rest(base, key, "members?select=role&user_id=eq." + user.id + "&cabinet_id=eq." + cab) as Row[];
  if (!mem.length || ["admin", "member"].indexOf(mem[0].role) === -1) return { status: 403, out: { ok: false, error: "non_autorise" } };
  const contacts = await rest(base, key, "fournisseurs_contacts?select=*&cabinet_id=eq." + cab + "&fournisseur=eq." + encodeURIComponent(fournisseur)) as Row[];
  const ct = contacts[0];
  if (!ct || !EMAIL.test(String(ct.email || ""))) return { status: 400, out: { ok: false, error: "pas_de_contact" } };
  const lignes = nettoyer(body.lignes);
  if (!lignes.length) return { status: 400, out: { ok: false, error: "commande_vide" } };
  const since = new Date(Date.now() - 3600000).toISOString();
  const recent = await rest(base, key, "commandes_envoyees?select=id&cabinet_id=eq." + cab + "&created_at=gte." + since) as Row[];
  if (recent.length >= MAX_PAR_HEURE) return { status: 429, out: { ok: false, error: "trop_de_commandes" } };
  const cabs = await rest(base, key, "cabinets?select=name&id=eq." + cab) as Row[];
  const cabinet = cabs[0]?.name || "Cabinet";
  const par = String(body.par || "").trim().slice(0, 80) || String(user.email || "");
  const mail = composer({ cabinet, fournisseur, clientNo: String(ct.client_no || ""), par, message: String(body.message || "").slice(0, 2000), lignes, avecPrix: !!body.avec_prix });
  const cc = String(ct.cc || "").split(/[,;\s]+/).filter((x) => EMAIL.test(x)).slice(0, 5);
  if (body.copie_moi !== false && user.email && EMAIL.test(user.email) && cc.indexOf(user.email) === -1) cc.push(user.email);
  try { await sendMail({ to: ct.email, cc, replyTo: user.email || "", subject: mail.subject, text: mail.text, html: mail.html }); }
  catch (e) { return { status: 502, out: { ok: false, error: (e as Error).message === "smtp_non_configure" ? "smtp_non_configure" : "envoi_impossible" } }; }
  await rest(base, key, "commandes_envoyees", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ cabinet_id: cab, fournisseur, destinataire: ct.email, copie: cc.join(", "), nb_lignes: lignes.length, total_ht: mail.total || null, lignes, message: String(body.message || "").slice(0, 2000), par: user.email || "", par_id: user.id }) }).catch(() => null);
  return { status: 200, out: { ok: true, destinataire: ct.email, copie: cc } };
}

if (typeof Deno !== "undefined" && (Deno as any).serve && !(globalThis as any).__test) {
  Deno.serve(async (req: Request) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
    if (req.method !== "POST") return json({ ok: false, error: "methode" }, 405);
    let body: Row = {};
    try { body = await req.json(); } catch (_e) { return json({ ok: false, error: "corps_invalide" }, 400); }
    try {
      const r = await run(body, req.headers.get("x-user-token") || "", { base: (Deno.env.get("SUPABASE_URL") || "").replace(/\/+$/, ""), anon: Deno.env.get("SUPABASE_ANON_KEY") || "", key: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "" });
      return json(r.out, r.status);
    } catch (_e) { return json({ ok: false, error: "erreur" }, 500); }
  });
}
