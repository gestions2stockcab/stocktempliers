# Mise à jour du 26/10/2026 — seuils d'alerte et prix

Faite par Claude (simsimstock), directement dans la base Supabase.

## Ce qui a changé

| Cabinet  | Seuils d'alerte mis à 1 | Prix ajoutés |
|----------|------------------------:|-------------:|
| Le Bourg | 173                     | 14           |
| Malakoff | 43                      | 0            |

- **Seuils** : les articles suivis qui n'avaient aucun seuil reçoivent un seuil de départ de **1**, ce qui déclenche une alerte quand il ne reste qu'une unité. L'historique de consommation est encore trop court (moins de 14 jours) pour calculer des seuils sur mesure. D'ici quelques semaines, on peut utiliser « Seuils suggérés » dans l'appli.
- **Prix** : pour chaque article sans prix, on reprend d'abord le prix payé sur la dernière facture du cabinet (même référence), et à défaut le prix du catalogue fournisseur 2026 (même référence).
- Chaque modification apparaît dans l'**Historique** de l'appli au nom de « Claude (simsimstock) », avec sa source.
- Le détail ligne par ligne se trouve dans `modifications.csv`.

## Ce qui n'a pas pu être fait

Il reste environ 2 290 articles sans prix. Ils viennent du catalogue modèle, n'ont **ni fournisseur ni référence** (par exemple « Limes K manuelles 21 mm, assorties »), et ne peuvent donc pas être reliés de façon fiable à une facture ou à un produit du catalogue. Ils prendront un prix quand ils seront liés à un vrai produit, par exemple lors de l'import d'une facture.

## Retour en arrière

Une sauvegarde de Le Bourg et de Malakoff a été faite juste avant la mise à jour : Réglages → Sauvegardes, en date du 26/10/2026.
