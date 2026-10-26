"""Mise à jour du 26/10/2026 (Claude / simsimstock) — seuils d'alerte et prix manquants.

- Seuil d'alerte (min) mis à 1 sur les articles suivis sans seuil (Le Bourg, Malakoff).
- Prix HT ajouté aux articles sans prix : dernière facture du cabinet (même référence),
  sinon catalogue fournisseur 2026 (même référence).
Chaque modification est notée dans l'historique (movements) au nom de « Claude (simsimstock) ».

Usage : SUPABASE_URL=https://xxx.supabase.co SUPABASE_SECRET_KEY=sb_secret_... python3 appliquer.py
"""
import datetime, json, os, re, urllib.request

U = os.environ["SUPABASE_URL"].rstrip("/") + "/rest/v1/"
K = os.environ["SUPABASE_SECRET_KEY"]
H = {"apikey": K, "Authorization": "Bearer " + K, "Content-Type": "application/json"}
CABINETS = {"Le Bourg": "ee57fb87-b580-421d-890f-beadc34b92b9", "Malakoff": "cd2e885e-6cf2-4e06-af61-db22bac2098a"}
WHO = "Claude (simsimstock)"


def get(p):
    out, off = [], 0
    while True:
        r = json.load(urllib.request.urlopen(urllib.request.Request(U + p, headers={**H, "Range": f"{off}-{off + 999}"})))
        out += r
        if len(r) < 1000:
            return out
        off += 1000


def send(method, p, body):
    urllib.request.urlopen(urllib.request.Request(U + p, method=method, data=json.dumps(body).encode(), headers={**H, "Prefer": "return=minimal"}))


ref = lambda s: re.sub(r"[\s\-.:]", "", (s or "").lower())
fr = lambda x: f"{x:.2f}".replace(".", ",")
now = datetime.datetime.now(datetime.timezone.utc).isoformat()

achats = sorted((a for a in get("achat_lignes?select=*") if a["doc_type"] == "facture" and (a["unit_price"] or 0) > 0), key=lambda a: a["doc_date"] or "")
par_facture = {(a["cabinet_id"], ref(a["ref"])): a for a in achats if a["ref"]}  # la plus récente l'emporte
par_catalogue = {}
for c in get("catalogue_fournisseurs?select=supplier,ref,price_ht&price_ht=gt.0"):
    par_catalogue.setdefault(ref(c["ref"]), c)

moves = []
for it in get("items?select=id,cabinet_id,name,ref,price,min,tracked&archived=eq.false"):
    if it["cabinet_id"] in CABINETS.values() and it["tracked"] and not it["min"]:
        send("PATCH", f"items?id=eq.{it['id']}", {"min": 1, "updated_at": now})
        moves.append((it, "Seuil d'alerte mis à 1 par Claude (simsimstock) — valeur de départ, à ajuster selon votre consommation"))
    if not it["price"] and it["ref"]:
        k = ref(it["ref"])
        a = par_facture.get((it["cabinet_id"], k))
        if a:
            p, src = float(a["unit_price"]), f"facture {a['supplier']} n°{a['doc_number']} du {a['doc_date']}"
        elif k in par_catalogue:
            p, src = float(par_catalogue[k]["price_ht"]), f"catalogue {par_catalogue[k]['supplier']} 2026"
        else:
            continue
        send("PATCH", f"items?id=eq.{it['id']}", {"price": p, "updated_at": now})
        moves.append((it, f"Prix {fr(p)} € HT ajouté par Claude (simsimstock), repris de : {src}"))

rows = [{"cabinet_id": it["cabinet_id"], "user_email": WHO, "item_id": it["id"], "item": it["name"], "type": "edit", "delta": 0, "qty": 0, "note": note} for it, note in moves]
for n in range(0, len(rows), 200):
    send("POST", "movements", rows[n:n + 200])
print(len(rows), "modifications")
