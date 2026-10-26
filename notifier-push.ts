// SimSimStock - envoi des notifications (fonction Supabase installée sous l'adresse « quick-action », appelée par le déclencheur notifier_push_envoyer sur la table messages)
// - nouveau message ou nouvelle tache : la personne concernee (ou toute l'equipe du cabinet) est prevenue ;
// - reponse « OK » ou « C'est fait » sur une tache : l'auteur de la tache est prevenu.
// Secrets a definir dans Supabase : RECAP_SECRET (le meme que le recap du lundi), VAPID_PUBLIC, VAPID_PRIVATE, VAPID_SUBJECT (par exemple mailto:vous@exemple.fr).

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
const cut = (s: string, n: number) => { s = String(s || "").replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n - 1) + "…" : s; };
const nameOf = (email: string) => { const n = String(email || "").split("@")[0].replace(/[._-]+/g, " ").trim(); return n ? n.charAt(0).toUpperCase() + n.slice(1) : "Quelqu'un"; };

export type Plan = { user_id: string; kind: "messages" | "taches"; payload: { title: string; body: string; tag: string; tab: string } };

// Qui previent-on, et avec quel texte ? (fonction pure, testee)
export function planNotifications(evt: Row, members: string[], names: Record<string, string>): Plan[] {
  const rec = evt.record || {}, old = evt.old_record || {}, out: Plan[] = [];
  if (evt.table && evt.table !== "messages") return out;
  const who = (uid: string, email: string) => names[uid] || nameOf(email);
  if (evt.type === "INSERT") {
    const task = rec.kind === "tache", author = who(rec.author_id, rec.author_email);
    const to = rec.to_user_id ? [rec.to_user_id] : members.filter((u) => u !== rec.author_id);
    for (const uid of to) {
      if (uid === rec.author_id || !members.includes(uid)) continue;
      out.push({ user_id: uid, kind: task ? "taches" : "messages", payload: {
        title: task ? "☑ Nouvelle tâche · " + author : (rec.to_user_id ? author : author + " (équipe)"),
        body: cut(rec.body, 140), tag: "msg-" + (rec.to_user_id ? rec.author_id : "equipe"), tab: task ? "taches" : "messages" } });
    }
  } else if (evt.type === "UPDATE" && rec.kind === "tache" && rec.author_id) {
    const who2 = (email: string) => nameOf(email);
    if (rec.done_at && !old.done_at) out.push({ user_id: rec.author_id, kind: "taches", payload: { title: "✓ " + who2(rec.done_by) + " a fait la tâche", body: cut(rec.body, 140), tag: "tache-" + rec.id, tab: "taches" } });
    else if (rec.ack_at && !old.ack_at && !rec.done_at) out.push({ user_id: rec.author_id, kind: "taches", payload: { title: "👍 " + who2(rec.ack_by) + " : OK", body: cut(rec.body, 140), tag: "tache-" + rec.id, tab: "taches" } });
  }
  return out;
}

async function getAll(base: string, key: string, path: string): Promise<Row[]> {
  const r = await fetch(`${base}/rest/v1/${path}`, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
  if (!r.ok) throw new Error(path.split("?")[0] + " " + r.status);
  return await r.json();
}
async function sendPush(sub: Row, payload: Row, env: Row) {
  const hook = (globalThis as any).__sendPush;
  if (hook) return hook(sub, payload);
  const webpush = (await import("npm:web-push@3.6.7")).default;
  webpush.setVapidDetails(env.subject, env.pub, env.priv);
  return await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, JSON.stringify(payload), { TTL: 3600, urgency: "high" });
}

export async function run(evt: Row, env: { base: string; key: string; pub: string; priv: string; subject: string }) {
  const rec = evt.record || {};
  if (!rec.cabinet_id || (evt.table && evt.table !== "messages")) return { ok: true, ignore: true };
  const { base, key } = env;
  const members = (await getAll(base, key, `members?select=user_id&cabinet_id=eq.${rec.cabinet_id}`)).map((m) => m.user_id);
  const named = await getAll(base, key, `equipe_noms?select=user_id,nom&cabinet_id=eq.${rec.cabinet_id}`).catch(() => []);
  const names: Record<string, string> = {}; for (const n of named) names[n.user_id] = n.nom;
  const plans = planNotifications(evt, members, names);
  if (!plans.length) return { ok: true, envoyes: 0, appareils: 0 };
  const ids = [...new Set(plans.map((p) => p.user_id))];
  const subs = await getAll(base, key, `push_abonnements?select=id,user_id,endpoint,p256dh,auth,prefs&user_id=in.(${ids.join(",")})`).catch(() => []);
  let sent = 0, gone = 0; const errors: string[] = [];
  for (const p of plans) {
    for (const s of subs.filter((x) => x.user_id === p.user_id)) {
      const prefs = s.prefs || {}; if (prefs[p.kind] === false) continue;
      try { await sendPush(s, p.payload, env); sent++; }
      catch (e: any) {
        const code = e && (e.statusCode || e.status);
        if (code === 404 || code === 410) { gone++; await fetch(`${base}/rest/v1/push_abonnements?id=eq.${s.id}`, { method: "DELETE", headers: { apikey: key, Authorization: `Bearer ${key}` } }).catch(() => {}); }
        else errors.push(String(e && e.message || "erreur"));
      }
    }
  }
  return { ok: errors.length === 0, envoyes: sent, appareils_supprimes: gone, erreurs: errors };
}

if (typeof Deno !== "undefined" && Deno.serve) {
  Deno.serve(async (req: Request) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
    const secret = Deno.env.get("RECAP_SECRET") || "";
    if (!sameSecret(req.headers.get("x-cron-secret") || "", secret)) return json({ ok: false, error: "non_autorise" }, 401);
    let evt: Row = {}; try { evt = await req.json(); } catch (_e) { return json({ ok: false, error: "corps_invalide" }, 400); }
    const base = (Deno.env.get("SUPABASE_URL") || "").replace(/\/+$/, ""), key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const pub = Deno.env.get("VAPID_PUBLIC") || "", priv = Deno.env.get("VAPID_PRIVATE") || "", subject = Deno.env.get("VAPID_SUBJECT") || "mailto:admin@example.com";
    if (!base || !key || !pub || !priv) return json({ ok: false, error: "environnement_incomplet" }, 500);
    try { return json(await run(evt, { base, key, pub, priv, subject })); } catch (e) { return json({ ok: false, error: e instanceof Error ? e.message : "erreur" }, 500); }
  });
}
