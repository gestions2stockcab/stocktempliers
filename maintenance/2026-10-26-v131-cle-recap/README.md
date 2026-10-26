# v131 — la clé des tâches planifiées passe dans le coffre-fort Supabase

Appliqué le 26/10/2026 dans Supabase par Claude (simsimstock).

## Avant
- La clé `x-cron-secret` était en clair dans la colonne `reglages_recap.secret`.
- La table était ouverte en lecture et en écriture aux rôles `anon` et `authenticated`. La seule protection était RLS sans règle, une barrière unique.
- `notifier_push_envoyer()` envoyait la valeur d'exemple `VOTRE_SECRET` au lieu de la vraie clé : les notifications auraient été refusées (401).

## Après (`migration.sql`)
- La clé est dans **Supabase Vault** (`recap_secret`), chiffrée.
- `recap_lundi()`, `configurer_recap()` et `notifier_push_envoyer()` lisent ou écrivent la clé dans le coffre.
- La colonne `reglages_recap.secret` est supprimée, et tous les droits sur la table sont retirés à `anon` et `authenticated`.
- `configurer_recap()` n'est plus exécutable par `anon` ni `authenticated`.
- La valeur de la clé ne change pas, donc les fonctions déjà déployées n'ont rien à modifier.

## Côté appli (v131)
- Le contrôle de l'installation considère comme installée une table fermée à la lecture (erreur `42501`).
- `rappels.ts`, `notifier-push.ts` et `rapport-mensuel.ts` comparent la clé en temps constant. À prendre en compte lors du prochain déploiement de ces fonctions : les versions déployées (`rapid-task`, `bright-task`) n'ont pas été redéployées.
