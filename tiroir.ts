// SimSimStock - « Compter avec l'IA » : estime, sur la photo d'un tiroir, la quantité visible de chaque article
// attendu dans ce tiroir et signale les emballages abîmés ou ouverts. L'équipe vérifie avant d'enregistrer.
// Fonction Supabase appelée par l'appli avec la session de la personne connectée.
// Secret à définir dans Supabase : ANTHROPIC_API_KEY. Sans ce secret, la fonction répond « cle_manquante » et rien n'est facturé.

import Anthropic from "npm:@anthropic-ai/sdk@^1.3.0";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-user-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const MODEL = "claude-opus-5-5";
const MAX_IMAGE_B64 = 6_000_000;   // l'appli réduit la photo à 1568 px : quelques centaines de Ko
const TYPES = ["image/jpeg", "image/png", "image/webp"];

const SYSTEM = `Tu aides l'équipe d'un cabinet dentaire à faire l'inventaire d'un tiroir à partir d'une photo.
On te donne la liste des articles censés être rangés dans ce tiroir (identifiant, nom, unité, quantité enregistrée).
- Pour chaque article de la liste, estime la quantité VISIBLE sur la photo, dans son unité (une boîte fermée compte pour 1 boîte, même si elle contient 100 gants).
- Ne compte jamais ce que tu ne vois pas ; si un article peut être caché ou si tu hésites, mets la confiance à "basse" et dis-le dans "etat".
- "etat" : une courte phrase sur l'aspect (« intact », « boîte ouverte », « emballage déchiré », « péremption lue : 03/2027 »…). Lis une date de péremption seulement si elle est nettement lisible.
- Si tu vois des produits absents de la liste, décris-les brièvement dans "inconnus".
- "remarques" : 0 à 3 observations utiles sur le tiroir (propreté, rangement, produit à jeter).
- Si la photo est floue, trop sombre ou ne montre pas un tiroir, mets "photo_exploitable" à false.
Réponds en français.`;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["photo_exploitable", "articles", "inconnus", "remarques"],
  properties: {
    photo_exploitable: { type: "boolean" },
    articles: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "quantite", "confiance", "etat"],
        properties: {
          id: { type: "string" },
          quantite: { type: "number" },
          confiance: { type: "string", enum: ["haute", "moyenne", "basse"] },
          etat: { type: "string" },
        },
      },
    },
    inconnus: { type: "array", items: { type: "string" } },
    remarques: { type: "array", items: { type: "string" } },
  },
};

type Article = { id: string; nom: string; unite?: string; quantite?: number };

// la personne doit être connectée : sans cela, la clé publique suffirait pour faire payer des analyses
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
    let body: { image?: string; media_type?: string; emplacement?: string; articles?: Article[] } = {};
    try { body = await req.json(); } catch (_e) { return json({ ok: false, error: "corps_invalide" }, 400); }
    const image = String(body.image || "");
    const mediaType = TYPES.indexOf(String(body.media_type)) !== -1 ? String(body.media_type) : "image/jpeg";
    if (!image || image.length > MAX_IMAGE_B64) return json({ ok: false, error: "image_invalide" }, 400);
    const articles = (Array.isArray(body.articles) ? body.articles : []).slice(0, 200)
      .map((a) => ({ id: String(a.id || "").slice(0, 40), nom: String(a.nom || "").slice(0, 160), unite: String(a.unite || "").slice(0, 30), quantite: Number(a.quantite) || 0 }))
      .filter((a) => a.id && a.nom);
    if (!articles.length) return json({ ok: false, error: "liste_vide" }, 400);

    const client = new Anthropic({ apiKey: key });
    // « fallbacks: default » : si le modèle décline, l'API reprend la même requête sur un modèle de secours
    const params: Record<string, unknown> = {
      model: MODEL,
      max_tokens: 16000,
      output_config: { effort: "medium", format: { type: "json_schema", schema: SCHEMA } },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: SYSTEM,
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType, data: image } },
          { type: "text", text: "Tiroir : " + String(body.emplacement || "").slice(0, 120) + "\nArticles attendus (JSON) :\n" + JSON.stringify(articles) },
        ],
      }],
    };
    try {
      // deno-lint-ignore no-explicit-any
      const res = await client.beta.messages.create(params as any);
      if (res.stop_reason === "refusal") return json({ ok: false, error: "refus" });
      if (res.stop_reason === "max_tokens") return json({ ok: false, error: "reponse_tronquee" });
      const text = res.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("");
      let analyse: unknown;
      try { analyse = JSON.parse(text); } catch (_e) { return json({ ok: false, error: "reponse_illisible" }, 502); }
      return json({ ok: true, analyse, modele: res.model });
    } catch (e) {
      if (e instanceof Anthropic.RateLimitError) return json({ ok: false, error: "trop_de_demandes" }, 429);
      if (e instanceof Anthropic.AuthenticationError) return json({ ok: false, error: "cle_invalide" }, 500);
      if (e instanceof Anthropic.APIError) return json({ ok: false, error: "api_" + e.status }, 502);
      return json({ ok: false, error: "erreur" }, 500);
    }
  });
}
