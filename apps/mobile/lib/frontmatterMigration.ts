import { parseFrontmatter, serializeFrontmatter, type FrontmatterData } from './frontmatter';

// Migration de la CLÉ de frontmatter d'une note quand une propriété est
// renommée dans le schéma (voir apps/desktop/electron/properties.ts,
// `properties:update`). Contrairement au reste de properties.ts (qui ne
// touche jamais aux notes — voir le commentaire d'en-tête de ce fichier),
// un renommage de propriété doit migrer la VALEUR déjà écrite sous
// l'ancienne clé, sans quoi elle devient orpheline du point de vue de
// l'UI (qui lit désormais le nouveau nom). Fonction pure et testable
// (comme lib/sync/diff.ts) plutôt qu'une logique enfouie dans le handler
// IPC — celui-ci l'appelle une fois par note du coffre.
export interface FrontmatterKeyMigrationResult {
  // Contenu final du fichier — identique à `content` d'entrée si
  // `changed` est faux (rien à réécrire sur disque dans ce cas).
  content: string;
  // La clé a été renommée : le fichier doit être réécrit.
  changed: boolean;
  // La note a bien l'ancienne clé, mais la nouvelle existe déjà avec sa
  // propre valeur — ignorée pour ne JAMAIS écraser silencieusement une
  // valeur existante (voir CLAUDE.md, "sauvegarde et gestion des
  // données").
  skipped: boolean;
}

// `oldKey`/`newKey` supposés non-vides et différents — l'appelant (ici
// `properties:update`) ne migre que si le nom a réellement changé.
export function migrateFrontmatterKey(content: string, oldKey: string, newKey: string): FrontmatterKeyMigrationResult {
  const { data, body } = parseFrontmatter(content);

  // Pas d'ancienne clé sur cette note : rien à migrer, contenu intact.
  if (!(oldKey in data)) {
    return { content, changed: false, skipped: false };
  }

  // La nouvelle clé porte déjà une valeur sur cette note (ex. tapée à la
  // main avant le renommage, ou héritée d'une autre propriété du même
  // nom) : ne jamais l'écraser silencieusement — la note reste telle
  // quelle, le cas remonte comme "skipped" pour être compté côté appelant.
  if (newKey in data) {
    return { content, changed: false, skipped: true };
  }

  // Reconstruit l'objet en remplaçant la clé À SA PLACE d'origine (plutôt
  // que de la supprimer puis rajouter `newKey` en fin d'objet) — garde
  // l'ordre des propriétés dans le YAML sérialisé proche de l'original.
  const nextData: FrontmatterData = {};
  for (const [key, value] of Object.entries(data)) {
    nextData[key === oldKey ? newKey : key] = value;
  }

  return { content: serializeFrontmatter(nextData, body), changed: true, skipped: false };
}
