import { Alert } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import { StorageAccessFramework } from 'expo-file-system/legacy';

import { parseFrontmatter } from '../frontmatter';
import { getActiveVaultRootUri } from './nativeVaultsAdapter';

// Implémentation native (Android) de VaultBridge, sur le Storage Access
// Framework (SAF) — voir docs/ARCHITECTURE.md §5, "écart pragmatique"
// Phase 1 : l'implémentation Electron vit directement dans
// apps/desktop/electron/vault.ts, celle-ci en est le pendant natif, PREMIER
// vrai second consommateur du concept VaultAdapter décrit dans ce document
// (extraction d'un packages/storage commun laissée pour plus tard, une fois
// les deux implémentations éprouvées en usage réel).
//
// ⚠️ PAS TESTÉ SUR UN VRAI APPAREIL ANDROID (voir la conversation) — écrit
// aussi soigneusement que possible à partir de la documentation officielle
// expo-file-system/legacy, mais SAF a des cas limites documentés qui
// varient selon la version d'Android/le fournisseur de stockage (voir les
// commentaires ciblés ci-dessous, notamment sur readDirectoryAsync). À
// valider/corriger avec de vrais retours de bugs plutôt que par relecture.
//
// //1. 🗺️ Modèle interne (relPath ↔ URI SAF)
// //2. 📖 Lire/écrire le CONTENU d'un fichier SAF
// //3. 🌳 Parcours de l'arborescence
// //4. 🧩 Types de fichiers & noms disponibles
// //5. 🔌 Implémentation de VaultBridge

// //1. 🗺️ MODÈLE INTERNE (relPath ↔ URI SAF)
// ////////////////////////////////////////////////////////////////////////

// SAF travaille avec des URI `content://...`, pas des chemins — il n'existe
// aucune façon de "joindre" une URI + un relPath comme on le ferait avec
// `path.join` côté Node. On maintient donc un index reconstruit à chaque
// `listTree()` (l'écran Notes appelle toujours listTree avant d'ouvrir une
// note, voir NotesScreen.tsx) qui fait le pont entre le relPath affiché
// dans l'UI et l'URI SAF réelle nécessaire pour chaque opération suivante.
type IndexEntry = { uri: string; isDirectory: boolean };
let pathIndex = new Map<string, IndexEntry>();
let indexedRootUri: string | null = null;

function resolveIndexed(relPath: string): IndexEntry {
  const entry = pathIndex.get(relPath);
  if (!entry) {
    throw new Error(
      `« ${relPath} » est introuvable — l'arborescence a peut-être changé ailleurs. Rouvre l'explorateur pour rafraîchir.`,
    );
  }
  return entry;
}

async function requireActiveRootUri(): Promise<string> {
  const uri = await getActiveVaultRootUri();
  if (!uri) throw new Error('Aucun coffre sélectionné.');
  return uri;
}

// //2. 📖 LIRE/ÉCRIRE LE CONTENU D'UN FICHIER SAF
// ////////////////////////////////////////////////////////////////////////

// `readAsStringAsync` ne sait PAS lire une URI `content://` directement
// (documenté) — le contournement standard est de copier le fichier SAF vers
// le cache privé de l'app, puis de le lire normalement depuis ce chemin
// `file://`, et de nettoyer ensuite.
async function readSafFileText(uri: string): Promise<string> {
  const tmpPath = `${FileSystem.cacheDirectory}saf-read-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  try {
    await FileSystem.copyAsync({ from: uri, to: tmpPath });
    return await FileSystem.readAsStringAsync(tmpPath);
  } finally {
    await FileSystem.deleteAsync(tmpPath, { idempotent: true });
  }
}

// `writeAsStringAsync` fonctionne directement sur une URI SAF, mais
// uniquement si le fichier existe DÉJÀ (documenté : "you can't create a new
// file" via cette fonction sur une URI SAF) — créer un nouveau fichier
// passe par `StorageAccessFramework.createFileAsync` (voir plus bas),
// jamais par celle-ci.
async function writeSafFileText(uri: string, content: string): Promise<void> {
  await FileSystem.writeAsStringAsync(uri, content);
}

// //3. 🌳 PARCOURS DE L'ARBORESCENCE
// ////////////////////////////////////////////////////////////////////////

function extensionKind(name: string): VaultEntryKind | null {
  const lower = name.toLowerCase();
  if (lower.endsWith('.mdx') || lower.endsWith('.md')) return 'markdown';
  if (lower.endsWith('.canvas')) return 'canvas';
  if (lower.endsWith('.chart')) return 'chart';
  if (lower.endsWith('.excalidraw')) return 'excalidraw';
  return null;
}

// `FileInfo` est une union discriminée par `exists` — le champ
// `modificationTime` (en secondes, d'où le ×1000) n'existe que sur la
// branche `exists: true`, TypeScript le refuse sinon.
function modifiedAtFromInfo(info: FileSystem.FileInfo): number {
  return info.exists && info.modificationTime ? info.modificationTime * 1000 : Date.now();
}

function nameFromSafUri(uri: string): string {
  // Dernier segment de l'ID document décodé — fonctionne pour le
  // fournisseur "stockage externe primaire" d'Android (le cas courant),
  // documenté comme technique standard pour SAF+Expo. Peut se comporter
  // différemment avec un fournisseur de documents tiers (ex. un dossier
  // partagé par une autre appli) — à surveiller si des noms bizarres
  // apparaissent dans l'arborescence.
  const decoded = decodeURIComponent(uri);
  const afterLastSlash = decoded.split('/').pop() ?? decoded;
  return afterLastSlash.split(':').pop() ?? afterLastSlash;
}

// ⚠️ Point à tester en priorité sur un vrai appareil : un bug documenté
// d'expo-file-system (issue GitHub #20102) fait que `readDirectoryAsync`
// sur l'URI d'un SOUS-dossier peut, sur certaines versions d'Android,
// renvoyer le contenu du dossier PARENT (celui pour lequel la permission a
// été accordée) plutôt que celui du sous-dossier demandé. Si l'arborescence
// affichée répète le même contenu à chaque niveau, c'est ce bug — la
// parade documentée est de re-dériver l'URI du sous-dossier via
// `StorageAccessFramework.getUriForDirectoryInRoot` plutôt que d'utiliser
// telle quelle l'URI renvoyée par le parcours ; pas implémenté ici tant que
// ça n'a pas été confirmé nécessaire en usage réel.
async function walkSafTree(dirUri: string, parentRelPath: string, depth = 0): Promise<VaultTreeNode[]> {
  if (depth > 40) return []; // garde-fou anti-boucle, jamais légitime à cette profondeur
  const childUris = await StorageAccessFramework.readDirectoryAsync(dirUri);
  const nodes: VaultTreeNode[] = [];
  for (const uri of childUris) {
    const name = nameFromSafUri(uri);
    if (name.startsWith('.')) continue; // masque .123ecriture/, comme walkTree côté Electron
    const relPath = parentRelPath ? `${parentRelPath}/${name}` : name;
    const info = await FileSystem.getInfoAsync(uri);
    if (info.isDirectory) {
      pathIndex.set(relPath, { uri, isDirectory: true });
      const children = await walkSafTree(uri, relPath, depth + 1);
      nodes.push({ type: 'folder', relPath, name, children });
    } else {
      const kind = extensionKind(name);
      if (!kind) continue; // ignore les fichiers non reconnus (pièces jointes...), comme walkTree
      pathIndex.set(relPath, { uri, isDirectory: false });
      nodes.push({
        type: 'note',
        relPath,
        name,
        modifiedAt: modifiedAtFromInfo(info),
        kind,
      });
    }
  }
  // Dossiers d'abord, puis notes, alphabétique — même ordre par défaut que
  // walkTree côté Electron ('fileSortMode' manuel/récent non supporté ici
  // pour l'instant, voir reorder() plus bas).
  nodes.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
    return a.name.localeCompare(b.name, 'fr');
  });
  return nodes;
}

async function refreshIndex(): Promise<VaultTreeNode[]> {
  const rootUri = await requireActiveRootUri();
  pathIndex = new Map();
  indexedRootUri = rootUri;
  return walkSafTree(rootUri, '');
}

// //4. 🧩 TYPES DE FICHIERS & NOMS DISPONIBLES
// ////////////////////////////////////////////////////////////////////////

const EXTENSION_FOR_KIND: Record<VaultEntryKind, string> = {
  markdown: '.mdx',
  canvas: '.canvas',
  chart: '.chart',
  excalidraw: '.excalidraw',
};

const MIME_FOR_KIND: Record<VaultEntryKind, string> = {
  markdown: 'text/plain',
  canvas: 'application/json',
  chart: 'application/json',
  excalidraw: 'application/json',
};

// Même règle de limite de mot que TAG_PATTERN dans
// apps/desktop/electron/search.ts (précédé d'un espace/saut de ligne/
// tabulation ou début de texte) — reproduite ici plutôt que partagée, même
// convention de duplication assumée qu'entre ce fichier-là et
// apps/mobile/lib/markdownPlugins.ts (voir leurs commentaires respectifs) :
// aucun `packages/` commun aujourd'hui pour la porter une seule fois.
const TAG_PATTERN = /(^|[\s])#([\p{L}\p{N}_-]+)/gu;

function defaultContentForKind(kind: VaultEntryKind, title: string): string {
  if (kind === 'markdown') return `---\ntitle: ${title}\ncreated: ${new Date().toISOString()}\n---\n\n`;
  if (kind === 'canvas') return JSON.stringify({ nodes: [], edges: [] }, null, 2);
  if (kind === 'excalidraw') return JSON.stringify({ type: 'excalidraw', elements: [], appState: {} }, null, 2);
  return JSON.stringify({ columns: [], rows: [], chart: null }, null, 2);
}

function findAvailableName(baseName: string, siblingNames: Set<string>): string {
  if (!siblingNames.has(baseName)) return baseName;
  const dotIndex = baseName.lastIndexOf('.');
  const stem = dotIndex === -1 ? baseName : baseName.slice(0, dotIndex);
  const ext = dotIndex === -1 ? '' : baseName.slice(dotIndex);
  for (let n = 2; n < 1000; n++) {
    const candidate = `${stem} ${n}${ext}`;
    if (!siblingNames.has(candidate)) return candidate;
  }
  throw new Error('Trop de fichiers du même nom.');
}

function siblingNamesOf(parentRelPath: string): Set<string> {
  const names = new Set<string>();
  const prefix = parentRelPath ? `${parentRelPath}/` : '';
  for (const relPath of pathIndex.keys()) {
    if (!relPath.startsWith(prefix)) continue;
    const rest = relPath.slice(prefix.length);
    if (!rest.includes('/')) names.add(rest);
  }
  return names;
}

async function resolveParentUri(parentRelPath: string | undefined): Promise<string> {
  if (!parentRelPath) return requireActiveRootUri();
  return resolveIndexed(parentRelPath).uri;
}

// //5. 🔌 IMPLÉMENTATION DE VaultBridge
// ////////////////////////////////////////////////////////////////////////

export const nativeVaultAdapter: VaultBridge = {
  // Délègue au coffre actif (voir nativeVaultsAdapter.ts) — même relation
  // que côté Electron, où vault:choose-folder appelle en interne
  // vaults.pickAndAddExistingVault().
  chooseFolder: async () => {
    const uri = await getActiveVaultRootUri();
    return uri;
  },

  getCurrentPath: () => getActiveVaultRootUri(),

  listTree: () => refreshIndex(),

  readNote: async (relPath) => {
    const { uri, isDirectory } = resolveIndexed(relPath);
    if (isDirectory) throw new Error(`« ${relPath} » est un dossier, pas une note.`);
    return readSafFileText(uri);
  },

  writeNote: async (relPath, content) => {
    const { uri, isDirectory } = resolveIndexed(relPath);
    if (isDirectory) throw new Error(`« ${relPath} » est un dossier, pas une note.`);
    await writeSafFileText(uri, content);
  },

  createNote: async (name, parentRelPath, kind = 'markdown') => {
    const parentUri = await resolveParentUri(parentRelPath);
    const ext = EXTENSION_FOR_KIND[kind];
    const baseName = name.toLowerCase().endsWith(ext) ? name : `${name}${ext}`;
    const finalName = findAvailableName(baseName, siblingNamesOf(parentRelPath ?? ''));
    const newUri = await StorageAccessFramework.createFileAsync(parentUri, finalName, MIME_FOR_KIND[kind]);
    const title = finalName.slice(0, finalName.length - ext.length);
    await writeSafFileText(newUri, defaultContentForKind(kind, title));
    const relPath = parentRelPath ? `${parentRelPath}/${finalName}` : finalName;
    pathIndex.set(relPath, { uri: newUri, isDirectory: false });
    return { relPath, name: finalName, modifiedAt: Date.now(), kind };
  },

  createFolder: async (name, parentRelPath) => {
    const parentUri = await resolveParentUri(parentRelPath);
    const finalName = findAvailableName(name, siblingNamesOf(parentRelPath ?? ''));
    const newUri = await StorageAccessFramework.makeDirectoryAsync(parentUri, finalName);
    const relPath = parentRelPath ? `${parentRelPath}/${finalName}` : finalName;
    pathIndex.set(relPath, { uri: newUri, isDirectory: true });
    return { relPath, name: finalName };
  },

  // Aucune fonction SAF "renommer" native n'existe (voir la doc
  // expo-file-system/legacy) — copie du CONTENU vers un nouveau fichier
  // puis suppression de l'original SEULEMENT une fois la copie confirmée
  // (jamais l'inverse, pour ne pas risquer de perdre le contenu si la copie
  // échoue en cours de route). Volontairement limité aux FICHIERS : un
  // renommage de DOSSIER nécessiterait de recopier tout un sous-arbre
  // récursivement sans jamais avoir pu tester ce chemin sur un vrai
  // appareil — le risque de perte de données d'un bug non détecté dans ce
  // cas précis est trop élevé pour le tenter à l'aveugle (voir CLAUDE.md
  // § Comportement).
  rename: async (relPath, newName) => {
    const { uri, isDirectory } = resolveIndexed(relPath);
    if (isDirectory) {
      throw new Error(
        'Renommer un dossier n’est pas encore pris en charge sur Android — dis-le si tu en as vraiment besoin, ça demande un développement dédié plus prudent.',
      );
    }
    const parentRelPath = relPath.includes('/') ? relPath.slice(0, relPath.lastIndexOf('/')) : '';
    const parentUri = await resolveParentUri(parentRelPath || undefined);
    const content = await readSafFileText(uri);
    const finalName = findAvailableName(newName, siblingNamesOf(parentRelPath));
    const finalKind = extensionKind(finalName);
    const mimeType = finalKind ? MIME_FOR_KIND[finalKind] : 'text/plain';
    const newUri = await StorageAccessFramework.createFileAsync(parentUri, finalName, mimeType);
    await writeSafFileText(newUri, content);
    await FileSystem.deleteAsync(uri, { idempotent: true });
    const newRelPath = parentRelPath ? `${parentRelPath}/${finalName}` : finalName;
    pathIndex.delete(relPath);
    pathIndex.set(newRelPath, { uri: newUri, isDirectory: false });
    return { relPath: newRelPath, name: finalName };
  },

  // Même raisonnement que rename() ci-dessus : fichiers uniquement, copie
  // avant suppression, dossiers explicitement non supportés pour l'instant.
  move: async (relPath, destinationParentRelPath) => {
    const { uri, isDirectory } = resolveIndexed(relPath);
    if (isDirectory) {
      throw new Error(
        'Déplacer un dossier n’est pas encore pris en charge sur Android — dis-le si tu en as vraiment besoin.',
      );
    }
    const name = relPath.includes('/') ? relPath.slice(relPath.lastIndexOf('/') + 1) : relPath;
    const destUri = await resolveParentUri(destinationParentRelPath);
    const content = await readSafFileText(uri);
    const finalName = findAvailableName(name, siblingNamesOf(destinationParentRelPath ?? ''));
    const finalKind = extensionKind(finalName);
    const mimeType = finalKind ? MIME_FOR_KIND[finalKind] : 'text/plain';
    const newUri = await StorageAccessFramework.createFileAsync(destUri, finalName, mimeType);
    await writeSafFileText(newUri, content);
    await FileSystem.deleteAsync(uri, { idempotent: true });
    const newRelPath = destinationParentRelPath ? `${destinationParentRelPath}/${finalName}` : finalName;
    pathIndex.delete(relPath);
    pathIndex.set(newRelPath, { uri: newUri, isDirectory: false });
    return { relPath: newRelPath, name: finalName };
  },

  // Édition manuelle de chemin complet (voir EditPathDialog.tsx) — même
  // limite fichiers-uniquement, réutilise move()/rename() par-dessous.
  setPath: async (relPath, newRelPath) => {
    const { isDirectory } = resolveIndexed(relPath);
    if (isDirectory) {
      throw new Error('Modifier le chemin d’un dossier n’est pas encore pris en charge sur Android.');
    }
    const newParent = newRelPath.includes('/') ? newRelPath.slice(0, newRelPath.lastIndexOf('/')) : '';
    const newName = newRelPath.includes('/') ? newRelPath.slice(newRelPath.lastIndexOf('/') + 1) : newRelPath;
    const moved = await nativeVaultAdapter.move(relPath, newParent || undefined);
    if (moved.name !== newName) return nativeVaultAdapter.rename(moved.relPath, newName);
    return moved;
  },

  // Suppression réellement récursive gérée par l'OS Android lui-même (un
  // seul appel natif, pas une boucle qu'on écrit soi-même) — bien plus
  // fiable que rename()/move() ci-dessus. Confirmation JS AVANT de
  // supprimer (Alert.alert, natif RN) : jamais de suppression silencieuse,
  // même règle que le dialog natif côté Electron (voir vault.ts,
  // vault:delete).
  delete: (relPath) =>
    new Promise((resolve) => {
      const { uri, isDirectory } = resolveIndexed(relPath);
      const name = relPath.includes('/') ? relPath.slice(relPath.lastIndexOf('/') + 1) : relPath;
      Alert.alert(
        isDirectory ? 'Supprimer ce dossier ?' : 'Supprimer cette note ?',
        isDirectory
          ? `« ${name} » et tout son contenu seront supprimés définitivement.`
          : `« ${name} » sera supprimée définitivement.`,
        [
          { text: 'Annuler', style: 'cancel', onPress: () => resolve({ deleted: false }) },
          {
            text: 'Supprimer',
            style: 'destructive',
            onPress: () => {
              void FileSystem.deleteAsync(uri, { idempotent: true }).then(() => {
                pathIndex.delete(relPath);
                resolve({ deleted: true });
              });
            },
          },
        ],
        { cancelable: true, onDismiss: () => resolve({ deleted: false }) },
      );
    }),

  getLastOpened: async () => {
    try {
      const path = `${FileSystem.documentDirectory}123ecriture-last-opened.txt`;
      const info = await FileSystem.getInfoAsync(path);
      if (!info.exists) return null;
      const value = await FileSystem.readAsStringAsync(path);
      return value || null;
    } catch {
      return null;
    }
  },

  setLastOpened: async (relPath) => {
    const path = `${FileSystem.documentDirectory}123ecriture-last-opened.txt`;
    await FileSystem.writeAsStringAsync(path, relPath ?? '');
  },

  // "Note du jour" (Calendrier) — voir CalendarScreen.tsx. Réutilise
  // createNote ; idempotent (renvoie la note existante si déjà créée
  // aujourd'hui) comme la version Electron.
  ensureDailyNote: async (dateIso) => {
    const parentRelPath = 'Journal';
    const fileName = `${dateIso}.mdx`;
    const relPath = `${parentRelPath}/${fileName}`;
    const cached = pathIndex.get(relPath);
    if (cached) {
      const info = await FileSystem.getInfoAsync(cached.uri);
      return { relPath, name: fileName, modifiedAt: modifiedAtFromInfo(info), kind: 'markdown' };
    }
    if (!pathIndex.has(parentRelPath)) {
      await nativeVaultAdapter.createFolder('Journal', undefined);
    }
    return nativeVaultAdapter.createNote(dateIso, parentRelPath, 'markdown');
  },

  // Tri manuel (glisser-déposer, `.123ecriture/order.json` côté Electron) —
  // non implémenté pour l'instant sur Android : on retourne l'arborescence
  // telle quelle (toujours alphabétique) plutôt que de risquer un ordre
  // persistant mal géré. Pas d'erreur levée : c'est une dégradation
  // silencieuse ACCEPTABLE (contrairement à delete/rename/move) puisqu'elle
  // ne touche aucune donnée, juste l'ordre d'affichage.
  reorder: async () => refreshIndex(),

  // Nécessiterait expo-document-picker (nouvelle dépendance, pas encore
  // ajoutée/vérifiée) — volontairement non implémenté cette session plutôt
  // que bâclé. Retourne `null`, exactement le même contrat qu'un choix
  // annulé côté Electron (voir NotesScreen.tsx, handleInsertAttachment gère
  // déjà ce cas sans erreur).
  importAttachment: async () => {
    console.warn('[nativeVaultAdapter] importAttachment pas encore implémenté sur Android.');
    return null;
  },

  readAttachmentDataUrl: async (relPath) => {
    const { uri } = resolveIndexed(relPath);
    const tmpPath = `${FileSystem.cacheDirectory}saf-attachment-${Date.now()}`;
    try {
      await FileSystem.copyAsync({ from: uri, to: tmpPath });
      const base64 = await FileSystem.readAsStringAsync(tmpPath, { encoding: FileSystem.EncodingType.Base64 });
      const ext = relPath.toLowerCase().split('.').pop() ?? '';
      const mime =
        ext === 'png' ? 'image/png' : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'gif' ? 'image/gif' : 'application/octet-stream';
      return `data:${mime};base64,${base64}`;
    } finally {
      await FileSystem.deleteAsync(tmpPath, { idempotent: true });
    }
  },

  // Duplique un FICHIER existant dans SON PROPRE dossier — même limite
  // fichiers-uniquement que rename()/move() ci-dessus (dupliquer un dossier
  // demanderait une copie récursive jamais éprouvée sur un vrai appareil).
  // Suffixe " (copie)"/" (copie 2)"... comme vault:duplicate côté Electron
  // (apps/desktop/electron/vault.ts) — findAvailableName() ci-dessus
  // suffixerait juste " 2"/" 3", moins explicite pour identifier une copie.
  duplicate: async (relPath) => {
    const { uri, isDirectory } = resolveIndexed(relPath);
    if (isDirectory) {
      throw new Error('Dupliquer un dossier n’est pas encore pris en charge sur Android.');
    }
    const parentRelPath = relPath.includes('/') ? relPath.slice(0, relPath.lastIndexOf('/')) : '';
    const parentUri = await resolveParentUri(parentRelPath || undefined);
    const segment = relPath.includes('/') ? relPath.slice(relPath.lastIndexOf('/') + 1) : relPath;
    const kind = extensionKind(segment) ?? 'markdown';
    const ext = EXTENSION_FOR_KIND[kind];
    const baseName = segment.slice(0, segment.length - ext.length);

    const siblings = siblingNamesOf(parentRelPath);
    let candidateName = `${baseName} (copie)${ext}`;
    let counter = 2;
    while (siblings.has(candidateName)) {
      candidateName = `${baseName} (copie ${counter})${ext}`;
      counter += 1;
    }

    const content = await readSafFileText(uri);
    const newUri = await StorageAccessFramework.createFileAsync(parentUri, candidateName, MIME_FOR_KIND[kind]);
    await writeSafFileText(newUri, content);
    const newRelPath = parentRelPath ? `${parentRelPath}/${candidateName}` : candidateName;
    pathIndex.set(newRelPath, { uri: newUri, isDirectory: false });
    return {
      relPath: newRelPath,
      name: candidateName.slice(0, candidateName.length - ext.length),
      modifiedAt: Date.now(),
      kind,
    };
  },

  // Vue dédiée aux tags (voir NotesScreen.tsx, bascule Fichiers/Tags) — même
  // esprit que vault:list-tags côté Electron (search.ts) : reparcourt le
  // coffre à la demande (refreshIndex, jamais un index potentiellement
  // périmé) et extrait les `#tags` du CORPS de chaque note markdown
  // (frontmatter exclu, via parseFrontmatter), regroupés par tag.
  listTags: async () => {
    await refreshIndex();
    const notesByTag = new Map<string, { relPath: string; name: string }[]>();

    for (const [relPath, entry] of pathIndex) {
      if (entry.isDirectory || extensionKind(relPath) !== 'markdown') continue;
      let content: string;
      try {
        content = await readSafFileText(entry.uri);
      } catch {
        continue; // fichier illisible entre le listage et la lecture — ignoré
      }
      const { body } = parseFrontmatter(content);
      const segment = relPath.includes('/') ? relPath.slice(relPath.lastIndexOf('/') + 1) : relPath;
      const kind = extensionKind(segment);
      const name = kind ? segment.slice(0, segment.length - EXTENSION_FOR_KIND[kind].length) : segment;

      for (const match of body.matchAll(TAG_PATTERN)) {
        const tag = match[2].toLowerCase();
        const notes = notesByTag.get(tag) ?? [];
        notes.push({ relPath, name });
        notesByTag.set(tag, notes);
      }
    }

    return [...notesByTag.entries()]
      .map(([tag, notes]) => ({ tag, notes }))
      .sort((a, b) => a.tag.localeCompare(b.tag, 'fr'));
  },
};

// Utilisé par installNativeBridges.ts pour invalider l'index si le coffre
// actif change pendant que l'app tourne (changement de coffre depuis les
// Paramètres, par ex.) — évite de continuer à résoudre des relPath par
// rapport à un ancien coffre.
export function invalidateIndexIfRootChanged(currentRootUri: string | null): void {
  if (indexedRootUri !== currentRootUri) {
    pathIndex = new Map();
    indexedRootUri = currentRootUri;
  }
}
