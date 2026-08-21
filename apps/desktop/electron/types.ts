// Types partagés entre les fichiers du process principal Electron —
// regroupés ici pour éviter de les redéclarer dans chaque module (ex.
// `VaultRegistryEntry` utilisé par vaults.js ET vault.js). PAS partagés
// avec apps/mobile/types/global.d.ts (pas de `packages/shared-types`
// aujourd'hui) : chaque bout de l'app type ses propres frontières, une
// discipline de cohérence plutôt qu'un couplage technique — voir le plan de
// cette conversion. Les FORMES doivent malgré tout rester en phase avec
// leurs équivalents côté renderer (mêmes noms de champs) puisqu'elles
// traversent le pont IPC telles quelles (voir preload.ts).

export type VaultEntryKind = 'markdown' | 'canvas' | 'chart' | 'excalidraw';

export interface VaultNoteNode {
  type: 'note';
  relPath: string;
  name: string;
  modifiedAt: number;
  kind: VaultEntryKind;
}

export interface VaultFolderNode {
  type: 'folder';
  relPath: string;
  name: string;
  children: VaultTreeNode[];
}

export type VaultTreeNode = VaultNoteNode | VaultFolderNode;

// `.123ecriture/order.json` — une entrée par dossier PARENT (chemin
// relatif, "" pour la racine du vault), voir vault.ts.
export type VaultOrder = Record<string, string[]>;

export interface VaultRegistryEntry {
  id: string;
  name: string;
  path: string;
  cloudLinked: boolean;
  remoteVaultId: string | null;
}

export interface VaultIdentity {
  id: string;
  name: string;
  createdAt: string;
}

// Config app-level (userData/config.json, voir config.ts) — `vaultPath`
// est l'ancien format (avant les coffres multiples), migré à la volée par
// vaults.ts ; gardé optionnel ici pour typer fidèlement ce qu'on peut
// effectivement lire d'un fichier existant.
export interface AppConfig {
  vaults?: VaultRegistryEntry[];
  activeVaultId?: string | null;
  vaultPath?: string;
  preferences?: Partial<Preferences>;
}

export interface Subtask {
  id: string;
  text: string;
  done: boolean;
}

export interface TaskAttachment {
  relPath: string;
  name: string;
}

export interface Task {
  id: string;
  text: string;
  done: boolean;
  createdAt: string;
  listId: string;
  // Ajoutés pour la refonte façon Microsoft To Do — voir tasks.ts,
  // `normalizeTask` : absents des tâches créées avant cette fonctionnalité,
  // toujours normalisés (repli sur ''/[]) à la LECTURE plutôt que migrés
  // sur disque, même esprit tolérant que frontmatter.ts.
  description: string;
  subtasks: Subtask[];
  attachments: TaskAttachment[];
}

export interface TaskList {
  id: string;
  name: string;
  createdAt: string;
}

export interface TaskListsData {
  lists: TaskList[];
  activeListId: string | null;
}

export interface CalendarEvent {
  id: string;
  title: string;
  date: string;
  time: string | null;
  allDay: boolean;
  notes: string;
  createdAt: string;
}

export interface CalendarEventInput {
  title: string;
  date: string;
  time?: string | null;
  allDay?: boolean;
  notes?: string;
}

export type PropertyType = 'text' | 'list' | 'number' | 'checkbox' | 'date' | 'datetime' | 'path' | 'options';

export interface PropertyDefinition {
  id: string;
  name: string;
  type: PropertyType;
  createdAt: string;
  // Uniquement pour type==='options' — liste des valeurs proposées (ex.
  // ["🟠 En cours", "🔴 Bloqué", "🟡 En attente"]), configurée dans
  // Paramètres → Gestion des propriétés. Absent/vide pour les autres types.
  options?: string[];
}

export interface PropertyPatch {
  name?: string;
  type?: PropertyType;
  options?: string[];
}

// Résumé honnête de la migration du frontmatter des notes déclenchée par un
// RENOMMAGE de propriété (voir properties:update dans properties.ts) —
// jamais un simple "OK" qui masquerait des notes non migrées (CLAUDE.md,
// "sauvegarde et gestion des données").
export interface PropertyRenameMigrationSummary {
  // Notes dont la clé de frontmatter a été renommée (ancienne → nouvelle)
  // et réécrites sur disque.
  migratedCount: number;
  // Notes qui avaient l'ancienne clé MAIS où la nouvelle portait déjà une
  // valeur — jamais écrasée, donc jamais touchées.
  skippedCount: number;
  // Notes où la lecture/écriture a échoué (fichier verrouillé, permissions,
  // disparu entre le listage et l'accès...) — migration interrompue pour
  // CETTE note seulement, jamais pour tout le coffre.
  errorCount: number;
}

// Réponse de properties:update — `migration` n'est présent que si CET appel
// a effectivement renommé la propriété (patch.name différent du nom
// existant) ; un simple changement de type/d'options n'a rien à migrer côté
// notes.
export interface PropertyUpdateResult {
  properties: PropertyDefinition[];
  migration?: PropertyRenameMigrationSummary;
}

export interface OccurrenceEntry {
  id: string;
  word: string;
  description: string;
  createdAt: string;
}

export interface OccurrencePatch {
  word?: string;
  description?: string;
}

export type ThemeMode = 'system' | 'light' | 'dark';

export interface ToolbarItemConfig {
  id: string;
  visible: boolean;
}

export type NewNoteLocation = 'vaultRoot' | 'sameFolder' | 'custom';

export type EditorViewMode = 'source' | 'split' | 'reading';

// Police de l'éditeur — voir apps/mobile/components/MdxEditor.tsx
// (EDITOR_FONT_STACKS) pour les piles CSS correspondantes.
export type EditorFontFamily = 'system' | 'sans' | 'serif' | 'mono' | 'dyslexic';

// Ordre des fichiers/dossiers dans l'explorateur (voir walkTree dans
// vault.ts) — 'manual' applique la réorganisation glisser-déposer déjà
// enregistrée (.123ecriture/order.json) ; les autres modes l'ignorent
// (sans la perdre : re-choisir 'manual' la restaure). 'oldest' est le
// symétrique de 'recent' (plus ancien d'abord plutôt que plus récent).
export type FileSortMode = 'alphabetical' | 'recent' | 'oldest' | 'manual';

// "Fichier ouvert par défaut" — voir apps/mobile/components/NotesScreen.tsx
// et VaultBridge.getLastOpened/setLastOpened (.123ecriture/state.json,
// PAR coffre, voir vault.ts).
export type DefaultOpenMode = 'lastOpened' | 'newNote' | 'specific';

export interface Preferences {
  themeMode: ThemeMode;
  accentColor: string;
  notesToolbarOrder: ToolbarItemConfig[];
  canvasToolbarOrder: ToolbarItemConfig[];
  chartToolbarOrder: ToolbarItemConfig[];
  // Paramètres → Gestion des fichiers et des liens (voir SettingsScreen.tsx).
  attachmentsFolder: string;
  autoCreateWikilinkTarget: boolean;
  newNoteLocation: NewNoteLocation;
  newNoteCustomFolder: string;
  fileSortMode: FileSortMode;
  defaultOpenMode: DefaultOpenMode;
  defaultOpenSpecificPath: string;
  // Paramètres → Éditeur.
  editorFontSize: number;
  editorFontFamily: EditorFontFamily;
  editorDefaultMode: EditorViewMode;
  editorCloseBrackets: boolean;
  editorInlineTitle: boolean;
  sidebarLayout: SidebarLayoutState;
  // Notes épinglées (voir NotesScreen.tsx, section "⭐ Favoris" en tête de
  // l'explorateur) — relPaths bruts plutôt qu'un registre séparé sous
  // .123ecriture/ : une préférence app-level comme le reste de ce fichier,
  // pas du contenu de vault. Un chemin qui ne correspond plus à rien
  // (renommé/supprimé depuis) est ignoré silencieusement à l'affichage
  // (voir findNodeByPath côté renderer), jamais purgé automatiquement ici.
  favoriteRelPaths: string[];
  // Paramètres → Compte et synchronisation : synchronise automatiquement
  // (au démarrage + à intervalle régulier) plutôt que seulement sur clic de
  // "Synchroniser maintenant" — voir apps/mobile/lib/sync/SyncStatusContext.tsx
  // pour le déclenchement réel. `false` par défaut : la sync manuelle reste
  // le comportement historique, ce choix n'est jamais fait à la place de
  // l'utilisatrice.
  autoSyncEnabled: boolean;
}

export interface SidebarPanelLayout {
  width: number;
  collapsed: boolean;
}

export type SidebarPanelId = 'nav' | 'explorer' | 'rightPanel';

export type SidebarLayoutState = Record<SidebarPanelId, SidebarPanelLayout>;

export type UpdaterStatus =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'up-to-date' }
  | { state: 'downloading'; version?: string; percent: number }
  | { state: 'ready'; version: string }
  | { state: 'error'; message: string };

export interface ContextMenuItem {
  id: string;
  label: string;
}

export interface HashedNote {
  relPath: string;
  contentHash: string;
  sizeBytes: number;
  modifiedAt: number;
}

// Recherche globale (voir search.ts) — un résultat peut être un dossier ou
// une pièce jointe (aucun `VaultEntryKind` ne les couvre), d'où ce type
// élargi plutôt que de réutiliser VaultEntryKind tel quel. 'task'/
// 'calendar-event' étendent la recherche aux modules Tâches/Calendrier
// (electron/tasks.ts, electron/calendar.ts) — ni l'un ni l'autre n'a de
// fichier associé, d'où `relPath` vide ('') pour ces deux kinds.
export type SearchResultKind = VaultEntryKind | 'folder' | 'attachment' | 'task' | 'calendar-event';

export type SearchMatchType = 'title' | 'content' | 'tag' | 'property';

export interface SearchResult {
  relPath: string;
  name: string;
  kind: SearchResultKind;
  matchType: SearchMatchType;
  snippet?: string;
  // Uniquement kind==='task' — de quoi rouvrir la tâche : une tâche n'existe
  // que dans le contexte de sa LISTE (voir tasklists:switch dans tasks.ts),
  // donc les deux identifiants sont nécessaires, pas juste `taskId`.
  taskId?: string;
  taskListId?: string;
  // Uniquement kind==='calendar-event' — `eventId` sert de clé de rendu,
  // `eventDate` (AAAA-MM-JJ) suffit à révéler le bon jour dans le
  // Calendrier (voir CalendarScreen.tsx, `openDay`).
  eventId?: string;
  eventDate?: string;
}

export interface SearchOptions {
  propertyId?: string;
  propertyValue?: string;
}

// Vue dédiée aux tags (voir NotesScreen.tsx, bascule Fichiers/Tags à côté
// du bouton de tri) — un `#mot-clé` peut apparaître dans plusieurs notes,
// d'où ce regroupement plutôt qu'une simple liste de notes. Construit par
// vault:list-tags (voir search.ts, qui réutilise déjà TAG_PATTERN/
// extractTags pour la recherche globale) à la demande, jamais tenu à jour
// en tâche de fond.
export interface TagNoteRef {
  relPath: string;
  name: string;
}

export interface TagGroup {
  tag: string;
  notes: TagNoteRef[];
}
