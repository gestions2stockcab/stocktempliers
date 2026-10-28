// SimSimStock - « Demander à SimSim » : répond en français aux questions de l'équipe sur les données du cabinet
// (fonction Supabase, appelée par l'appli avec la session de la personne connectée).
// L'appli envoie un résumé des données (stock, achats, stérilisation, implants sans aucune donnée patient, contrôles).
// Secret à définir dans Supabase : ANTHROPIC_API_KEY.

import Anthropic from "npm:@anthropic-ai/sdk@^1.3.0";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-user-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const MODEL = "claude-opus-5-5";
const MAX_CONTEXT_CHARS = 600_000;   // garde-fou : un cabinet de plusieurs milliers d'articles tient largement
const SYSTEM = `Tu es SimSim, l'assistant de l'appli SimSimStock d'un cabinet dentaire en France.
Tu réponds en français, simplement, à des assistantes et des chirurgiens-dentistes, à partir des seules données du cabinet fournies en JSON (tableaux avec la liste de leurs colonnes).
- Appuie chaque chiffre sur les données : fais les calculs (sommes, moyennes, comptes) avec soin et donne le résultat.
- Si les données ne permettent pas de répondre, dis-le franchement et indique ce qui manque ; n'invente jamais.
- Réponse courte : une ou deux phrases, puis au besoin une liste de quelques lignes. Montants en euros HT avec deux décimales, dates au format JJ/MM/AAAA.
- Pour ce qui va manquer : compare la quantité au seuil, et si la consommation sur 90 jours est fournie, estime les jours de stock restants.
- Tu ne connais aucun nom de patient : ils ne te sont jamais transmis.
- Pas de conseil médical ; pour la réglementation, rappelle de vérifier auprès de l'Ordre ou de l'ARS.`;

type Tour = { role: "user" | "assistant"; text: string };

// la personne doit être connectée à l'appli : sans cela, la clé publique suffirait pour faire payer des questions
async function sessionValide(token: string): Promise<boolean> {
  const base = (Deno.env.get("SUPABASE_URL") || "").replace(/\/+$/, "");
  const anon = Deno.env.get("SUPABASE_ANON_KEY") || "";
  if (!token || !base || !anon) return false;
  const r = await fetch(base + "/auth/v1/user", { headers: { apikey: anon, Authorization: "Bearer " + token } });
  return r.ok;
}

if (typeof Deno !== "undefined" && Deno.serve) {
  Deno.serve(async (req: Request) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
    if (req.method !== "POST") return json({ ok: false, error: "methode" }, 405);
    const key = Deno.env.get("ANTHROPIC_API_KEY") || "";
    if (!key) return json({ ok: false, error: "cle_manquante" });
    if (!(await sessionValide(req.headers.get("x-user-token") || ""))) return json({ ok: false, error: "non_connecte" }, 401);
    let body: { question?: string; historique?: Tour[]; contexte?: unknown } = {};
    try { body = await req.json(); } catch (_e) { return json({ ok: false, error: "corps_invalide" }, 400); }
    const question = String(body.question || "").trim().slice(0, 600);
    if (!question) return json({ ok: false, error: "question_vide" }, 400);
    const contexte = JSON.stringify(body.contexte || {});
    if (contexte.length > MAX_CONTEXT_CHARS) return json({ ok: false, error: "donnees_trop_volumineuses" }, 413);
    const historique = (Array.isArray(body.historique) ? body.historique : []).slice(-6)
      .filter((t) => t && (t.role === "user" || t.role === "assistant") && String(t.text || "").trim())
      .map((t) => ({ role: t.role, content: String(t.text).slice(0, 4000) }));

    const client = new Anthropic({ apiKey: key });
    // « fallbacks: default » : si le modèle décline, l'API reprend la même requête sur un modèle de secours
    const params: Record<string, unknown> = {
      model: MODEL,
      max_tokens: 16000,
      output_config: { effort: "medium" },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: SYSTEM,
      messages: [
        { role: "user", content: [{ type: "text", text: "Données du cabinet (JSON) :\n" + contexte, cache_control: { type: "ephemeral" } }] },
        ...historique,
        { role: "user", content: question },
      ],
    };
    try {
      // deno-lint-ignore no-explicit-any
      const res = await client.beta.messages.create(params as any);
      if (res.stop_reason === "refusal") return json({ ok: false, error: "refus" });
      const reponse = res.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("\n").trim();
      return json({ ok: true, reponse, modele: res.model });
    } catch (e) {
      if (e instanceof Anthropic.RateLimitError) return json({ ok: false, error: "trop_de_demandes" }, 429);
      if (e instanceof Anthropic.AuthenticationError) return json({ ok: false, error: "cle_invalide" }, 500);
      if (e instanceof Anthropic.APIError) return json({ ok: false, error: "api_" + e.status }, 502);
      return json({ ok: false, error: "erreur" }, 500);
    }
  });
}
