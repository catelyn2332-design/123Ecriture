// Types des ponts exposés par apps/desktop/electron/preload.js via
// contextBridge. N'existent que côté Electron desktop (window.vault,
// window.updater, window.preferences, window.contextMenu sont undefined
// sur web/mobile — Phase 2 pour ces plateformes).
export {};

declare global {
  // Type de fichier reconnu par le vault, dérivé de l'extension (voir
  // walkTree dans apps/desktop/electron/vault.js) — pilote l'aiguillage de
  // NotesScreen.tsx vers l'éditeur MDX, CanvasEditor.tsx ou ChartEditor.tsx,
  // et l'icône affichée par VaultTreeView.tsx.
  type VaultEntryKind = 'markdown' | 'canvas' | 'chart' | 'excalidraw';

  interface VaultEntry {
    relPath: string;
    name: string;
    modifiedAt: number;
    kind: VaultEntryKind;
  }

  interface VaultFolderEntry {
    relPath: string;
    name: string;
  }

  type VaultNoteNode = { type: 'note' } & VaultEntry;
  type VaultFolderNode = { type: 'folder'; relPath: string; name: string; children: VaultTreeNode[] };
  type VaultTreeNode = VaultNoteNode | VaultFolderNode;

  interface VaultBridge {
    chooseFolder: () => Promise<string | null>;
    getCurrentPath: () => Promise<string | null>;
    listTree: () => Promise<VaultTreeNode[]>;
    readNote: (relPath: string) => Promise<string>;
    writeNote: (relPath: string, content: string) => Promise<void>;
    createNote: (name: string, parentRelPath?: string, kind?: VaultEntryKind) => Promise<VaultEntry>;
    createFolder: (name: string, parentRelPath?: string) => Promise<VaultFolderEntry>;
    rename: (relPath: string, newName: string) => Promise<{ relPath: string; name: string }>;
    move: (
      relPath: string,
      destinationParentRelPath?: string,
    ) => Promise<{ relPath: string; name: string }>;
    setPath: (relPath: string, newRelPath: string) => Promise<{ relPath: string; name: string }>;
    // Confirmation NATIVE (dialog.showMessageBox) déjà gérée côté main
    // process (voir vault.ts, `vault:delete`) — `deleted: false` si
    // l'utilisatrice a annulé, jamais de suppression silencieuse.
    delete: (relPath: string) => Promise<{ deleted: boolean }>;
    // Voir Preferences.defaultOpenMode==='lastOpened' — par coffre (voir
    // vault.ts, .123ecriture/state.json), pas app-level.
    getLastOpened: () => Promise<string | null>;
    setLastOpened: (relPath: string | null) => Promise<void>;
    ensureDailyNote: (dateIso: string) => Promise<VaultEntry>;
    reorder: (parentRelPath: string | undefined, orderedNames: string[]) => Promise<VaultTreeNode[]>;
    importAttachment: () => Promise<{ relPath: string; name: string } | null>;
    readAttachmentDataUrl: (relPath: string) => Promise<string>;
    // Voir "Dupliquer" dans le menu contextuel de NotesScreen.tsx — copie
    // dans le MÊME dossier, suffixée " (copie)"/" (copie 2)"...
    duplicate: (relPath: string) => Promise<VaultEntry>;
    // Voir la bascule Fichiers/Tags de NotesScreen.tsx — chargé à la
    // demande (pas de flux poussé), voir apps/desktop/electron/search.ts.
    listTags: () => Promise<TagGroup[]>;
  }

  interface VaultRegistryEntry {
    id: string;
    name: string;
    path: string;
    cloudLinked: boolean;
    remoteVaultId: string | null;
  }

  interface VaultsBridge {
    list: () => Promise<VaultRegistryEntry[]>;
    getActive: () => Promise<string | null>;
    addExisting: () => Promise<VaultRegistryEntry[]>;
    createNew: (name: string) => Promise<VaultRegistryEntry[]>;
    switch: (id: string) => Promise<VaultRegistryEntry[]>;
    rename: (id: string, name: string) => Promise<VaultRegistryEntry[]>;
    remove: (id: string) => Promise<VaultRegistryEntry[]>;
    setCloudLink: (
      id: string,
      payload: { linked: boolean; remoteVaultId?: string | null },
    ) => Promise<VaultRegistryEntry[]>;
    onChanged: (callback: (vaults: VaultRegistryEntry[]) => void) => () => void;
  }

  interface AuthBridge {
    openExternal: (url: string) => Promise<void>;
    onCallback: (callback: (url: string) => void) => () => void;
  }

  interface HashedNote {
    relPath: string;
    contentHash: string;
    sizeBytes: number;
    modifiedAt: number;
  }

  interface SyncBridge {
    hashVaultTree: () => Promise<HashedNote[]>;
  }

  interface CalendarEvent {
    id: string;
    title: string;
    date: string; // AAAA-MM-JJ
    time: string | null; // HH:MM, null si allDay
    allDay: boolean;
    notes: string;
    createdAt: string;
  }

  interface CalendarEventInput {
    title: string;
    date: string;
    time?: string | null;
    allDay?: boolean;
    notes?: string;
  }

  interface CalendarBridge {
    listEvents: () => Promise<CalendarEvent[]>;
    addEvent: (input: CalendarEventInput) => Promise<CalendarEvent[]>;
    updateEvent: (id: string, patch: Partial<CalendarEventInput>) => Promise<CalendarEvent[]>;
    removeEvent: (id: string) => Promise<CalendarEvent[]>;
  }

  // Schéma global de propriétés typées (voir PropertiesPanel.tsx) — ne
  // porte que la DÉFINITION (nom + type) ; les valeurs vivent dans le
  // frontmatter YAML de chaque note (voir lib/frontmatter.ts).
  type PropertyType = 'text' | 'list' | 'number' | 'checkbox' | 'date' | 'datetime' | 'path' | 'options';

  interface PropertyDefinition {
    id: string;
    name: string;
    type: PropertyType;
    createdAt: string;
    // Uniquement pour type==='options' — liste des valeurs proposées (ex.
    // ["🟠 En cours", "🔴 Bloqué"]), configurée dans Paramètres → Gestion
    // des propriétés.
    options?: string[];
  }

  interface PropertyPatch {
    name?: string;
    type?: PropertyType;
    options?: string[];
  }

  // Résumé honnête de la migration du frontmatter des notes déclenchée par
  // un RENOMMAGE de propriété (voir apps/desktop/electron/properties.ts,
  // `migrateRenamedPropertyInVault`) — jamais un simple "OK" qui masquerait
  // des notes non migrées.
  interface PropertyRenameMigrationSummary {
    // Notes dont la clé de frontmatter a été renommée et réécrites sur
    // disque.
    migratedCount: number;
    // Notes qui avaient l'ancienne clé MAIS où la nouvelle portait déjà une
    // valeur — jamais écrasée, donc jamais touchées.
    skippedCount: number;
    // Notes où la lecture/écriture a échoué — migration interrompue pour
    // CETTE note seulement, jamais pour tout le coffre.
    errorCount: number;
  }

  // `migration` n'est présent que si CET appel a effectivement renommé la
  // propriété (patch.name différent du nom existant) ; un simple changement
  // de type/d'options n'a rien à migrer côté notes.
  interface PropertyUpdateResult {
    properties: PropertyDefinition[];
    migration?: PropertyRenameMigrationSummary;
  }

  interface PropertiesBridge {
    list: () => Promise<PropertyDefinition[]>;
    create: (name: string, type: PropertyType, options?: string[]) => Promise<PropertyDefinition[]>;
    update: (id: string, patch: PropertyPatch) => Promise<PropertyUpdateResult>;
    remove: (id: string) => Promise<PropertyDefinition[]>;
  }

  // Dictionnaire personnel des {{occurrences}} (voir OccurrencesPanel.tsx,
  // lib/markdownPlugins.ts, lib/mdxLivePreview.ts). Renommer un mot
  // (`update` avec `word`) réécrit `{{ancien}}`→`{{nouveau}}` dans tout le
  // vault côté main process (apps/desktop/electron/occurrences.js) — pas
  // juste dans le registre.
  interface OccurrenceEntry {
    id: string;
    word: string;
    description: string;
    createdAt: string;
  }

  interface OccurrencePatch {
    word?: string;
    description?: string;
  }

  interface OccurrencesBridge {
    list: () => Promise<OccurrenceEntry[]>;
    create: (word: string, description?: string) => Promise<OccurrenceEntry[]>;
    update: (id: string, patch: OccurrencePatch) => Promise<OccurrenceEntry[]>;
    remove: (id: string) => Promise<OccurrenceEntry[]>;
    findNotes: (word: string) => Promise<string[]>;
  }

  // Recherche globale (voir SearchDialog.tsx, CommandPalette.tsx,
  // apps/desktop/electron/search.ts) — un résultat peut être un dossier ou
  // une pièce jointe, aucun VaultEntryKind ne les couvre, d'où ce type
  // élargi. 'task'/'calendar-event' étendent la recherche aux modules
  // Tâches/Calendrier — ni l'un ni l'autre n'a de fichier associé, d'où
  // `relPath` vide ('') pour ces deux kinds (voir lib/searchResults.ts pour
  // la logique d'ouverture partagée).
  type SearchResultKind = VaultEntryKind | 'folder' | 'attachment' | 'task' | 'calendar-event';
  type SearchMatchType = 'title' | 'content' | 'tag' | 'property';

  interface SearchResult {
    relPath: string;
    name: string;
    kind: SearchResultKind;
    matchType: SearchMatchType;
    snippet?: string;
    // Uniquement kind==='task' — une tâche n'existe que dans le contexte de
    // sa LISTE (voir TaskListsBridge.switch), les deux identifiants sont
    // donc nécessaires pour la rouvrir.
    taskId?: string;
    taskListId?: string;
    // Uniquement kind==='calendar-event' — `eventDate` (AAAA-MM-JJ) suffit à
    // révéler le bon jour dans le Calendrier (CalendarScreen.tsx, openDay).
    eventId?: string;
    eventDate?: string;
  }

  interface SearchOptions {
    propertyId?: string;
    propertyValue?: string;
  }

  interface SearchBridge {
    run: (query: string, options?: SearchOptions) => Promise<SearchResult[]>;
  }

  // Vue dédiée aux tags (voir NotesScreen.tsx, bascule Fichiers/Tags à côté
  // du bouton de tri ⇅) — un `#mot-clé` peut apparaître dans plusieurs
  // notes, d'où ce regroupement (voir VaultBridge.listTags,
  // apps/desktop/electron/search.ts).
  interface TagNoteRef {
    relPath: string;
    name: string;
  }

  interface TagGroup {
    tag: string;
    notes: TagNoteRef[];
  }

  // Contenu d'un fichier `.chart` (voir defaultContentForKind dans
  // apps/desktop/electron/vault.js) — plus de registre multi-feuilles
  // séparé (SheetListsBridge/SheetBridge supprimés) : un `.chart` est lu/
  // écrit via VaultBridge.readNote/writeNote comme n'importe quel fichier
  // du vault, son CONTENU (texte JSON) a cette forme.
  interface SheetColumn {
    id: string;
    name: string;
  }

  interface SheetRow {
    id: string;
    cells: Record<string, string>;
  }

  type SheetChartType = 'bar' | 'line' | 'pie';

  interface SheetChartConfig {
    type: SheetChartType;
    labelColumnId: string | null;
    valueColumnIds: string[];
  }

  interface SheetData {
    columns: SheetColumn[];
    rows: SheetRow[];
    chart: SheetChartConfig | null;
  }

  // Champs alignés sur JSON Canvas (spec ouverte publiée par Obsidian,
  // https://jsoncanvas.org — voir lib/canvas.ts) : un `.canvas` est un
  // fichier du vault comme un autre (plus de registre séparé, voir
  // CanvasEditor.tsx), lu/écrit via VaultBridge.readNote/writeNote comme
  // n'importe quelle note — son CONTENU (texte JSON) a cette forme.
  type CanvasNodeType = 'text' | 'file';

  interface CanvasNode {
    id: string;
    type: CanvasNodeType;
    x: number;
    y: number;
    width: number;
    height: number;
    text?: string; // type 'text'
    file?: string; // type 'file' — relPath de la note référencée
    title?: string; // type 'file' — titre affiché, mis en cache au choix de la note
  }

  type CanvasEdgeSide = 'top' | 'right' | 'bottom' | 'left';

  interface CanvasEdge {
    id: string;
    fromNode: string;
    fromSide?: CanvasEdgeSide;
    toNode: string;
    toSide?: CanvasEdgeSide;
  }

  interface CanvasData {
    nodes: CanvasNode[];
    edges: CanvasEdge[];
  }

  // Scène Excalidraw minimale (voir ExcalidrawEditor.tsx) — forme du
  // fichier natif `.excalidraw` (https://excalidraw.com), pour rester
  // compatible si le vrai outil de dessin (`@excalidraw/excalidraw`) est
  // intégré plus tard ; `elements`/`appState` volontairement non typés
  // finement tant qu'aucun outil ne les manipule vraiment (scaffolding
  // seulement cette session, voir docs/ARCHITECTURE.md §4).
  interface ExcalidrawData {
    type: 'excalidraw';
    version: number;
    elements: unknown[];
    appState: Record<string, unknown>;
  }

  type UpdaterStatus =
    | { state: 'idle' }
    | { state: 'checking' }
    | { state: 'up-to-date' }
    | { state: 'downloading'; version?: string; percent: number }
    | { state: 'ready'; version: string }
    | { state: 'error'; message: string };

  interface UpdaterBridge {
    getVersion: () => Promise<string>;
    getStatus: () => Promise<UpdaterStatus>;
    check: () => Promise<void>;
    quitAndInstall: () => Promise<void>;
    onStatusChange: (callback: (status: UpdaterStatus) => void) => () => void;
  }

  type ThemeMode = 'system' | 'light' | 'dark';

  interface ToolbarItemConfig {
    id: string;
    visible: boolean;
  }

  type NewNoteLocation = 'vaultRoot' | 'sameFolder' | 'custom';

  type EditorViewMode = 'source' | 'split' | 'reading';

  // Police de l'éditeur (voir MdxEditor.tsx, `.cm-scroller`) — polices web-
  // safe/multiplateforme uniquement (pas de chargement de fichier de police
  // custom pour l'instant), 'system' garde le comportement actuel
  // (`fontFamily: 'inherit'`, hérite de la police système du thème).
  type EditorFontFamily = 'system' | 'sans' | 'serif' | 'mono' | 'dyslexic';

  // Ordre des fichiers/dossiers dans l'explorateur (voir walkTree dans
  // apps/desktop/electron/vault.ts) — 'manual' applique la réorganisation
  // glisser-déposer déjà enregistrée ; les deux autres modes l'ignorent
  // (sans la perdre : re-choisir 'manual' la restaure).
  type FileSortMode = 'alphabetical' | 'recent' | 'oldest' | 'manual';

  // "Fichier ouvert par défaut" (voir NotesScreen.tsx, effet d'ouverture au
  // démarrage) : 'lastOpened' rouvre la dernière note active de CE coffre
  // (voir VaultBridge.getLastOpened/setLastOpened, .123ecriture/state.json
  // côté vault.ts — par coffre, pas app-level, puisque "la dernière note"
  // n'a de sens que dans le coffre où elle a été ouverte) ; 'newNote' crée
  // une note vierge à chaque démarrage ; 'specific' ouvre toujours
  // `defaultOpenSpecificPath` ci-dessous.
  type DefaultOpenMode = 'lastOpened' | 'newNote' | 'specific';

  interface Preferences {
    themeMode: ThemeMode;
    accentColor: string;
    notesToolbarOrder: ToolbarItemConfig[];
    canvasToolbarOrder: ToolbarItemConfig[];
    chartToolbarOrder: ToolbarItemConfig[];
    // Paramètres → Gestion des fichiers et des liens.
    attachmentsFolder: string;
    autoCreateWikilinkTarget: boolean;
    newNoteLocation: NewNoteLocation;
    newNoteCustomFolder: string;
    fileSortMode: FileSortMode;
    defaultOpenMode: DefaultOpenMode;
    // relPath du fichier à ouvrir quand defaultOpenMode==='specific' — '' si
    // aucun choisi (repli silencieux sur l'écran "Sélectionne ou crée une
    // note", pas de crash).
    defaultOpenSpecificPath: string;
    // Paramètres → Éditeur.
    editorFontSize: number;
    editorFontFamily: EditorFontFamily;
    editorDefaultMode: EditorViewMode;
    editorCloseBrackets: boolean;
    editorInlineTitle: boolean;
    // Largeur/repli des 3 barres latérales redimensionnables au curseur
    // (voir lib/useResizablePanel.ts, components/ResizeHandle.tsx) : la
    // nav générale (AppShell.tsx), l'explorateur de fichiers et le panneau
    // droit Propriétés/Occurrences (les deux dans NotesScreen.tsx).
    // `collapsed` est un état séparé de `width` (pas juste width===0) pour
    // pouvoir mémoriser la dernière largeur "dépliée" et la restaurer telle
    // quelle en rouvrant.
    sidebarLayout: SidebarLayoutState;
    // Notes épinglées (voir NotesScreen.tsx, section "⭐ Favoris" en tête de
    // l'explorateur) — relPaths bruts ; un chemin qui ne correspond plus à
    // rien (renommé/supprimé depuis) est ignoré silencieusement à
    // l'affichage (findNodeByPath), jamais purgé automatiquement ici.
    favoriteRelPaths: string[];
    // Paramètres → Compte et synchronisation : synchronise automatiquement
    // (au démarrage + à intervalle régulier) plutôt que seulement sur clic
    // de "Synchroniser maintenant" — voir lib/sync/SyncStatusContext.tsx
    // pour le déclenchement réel. `false` par défaut : la sync manuelle
    // reste le comportement historique, ce choix n'est jamais fait à la
    // place de l'utilisatrice.
    autoSyncEnabled: boolean;
  }

  interface SidebarPanelLayout {
    width: number;
    collapsed: boolean;
  }

  type SidebarPanelId = 'nav' | 'explorer' | 'rightPanel';

  type SidebarLayoutState = Record<SidebarPanelId, SidebarPanelLayout>;

  interface PreferencesBridge {
    get: () => Promise<Preferences>;
    set: (partial: Partial<Preferences>) => Promise<Preferences>;
    reset: () => Promise<Preferences>;
    getConfigPath: () => Promise<string>;
    revealConfigFolder: () => Promise<void>;
  }

  interface ContextMenuItem {
    id: string;
    label: string;
  }

  interface ContextMenuBridge {
    show: (items: ContextMenuItem[]) => Promise<string | null>;
  }

  interface Subtask {
    id: string;
    text: string;
    done: boolean;
  }

  interface TaskAttachment {
    relPath: string;
    name: string;
  }

  interface Task {
    id: string;
    text: string;
    done: boolean;
    createdAt: string;
    listId: string;
    description: string;
    subtasks: Subtask[];
    attachments: TaskAttachment[];
  }

  interface TasksBridge {
    list: () => Promise<Task[]>;
    add: (text: string) => Promise<Task[]>;
    toggle: (id: string) => Promise<Task[]>;
    remove: (id: string) => Promise<Task[]>;
    update: (id: string, patch: { text?: string; description?: string }) => Promise<Task[]>;
    addSubtask: (taskId: string, text: string) => Promise<Task[]>;
    renameSubtask: (taskId: string, subtaskId: string, text: string) => Promise<Task[]>;
    toggleSubtask: (taskId: string, subtaskId: string) => Promise<Task[]>;
    removeSubtask: (taskId: string, subtaskId: string) => Promise<Task[]>;
    addAttachment: (taskId: string, attachment: TaskAttachment) => Promise<Task[]>;
    removeAttachment: (taskId: string, relPath: string) => Promise<Task[]>;
  }

  interface TaskList {
    id: string;
    name: string;
    createdAt: string;
  }

  interface TaskListsBridge {
    list: () => Promise<TaskList[]>;
    getActive: () => Promise<string | null>;
    create: (name: string) => Promise<TaskList[]>;
    rename: (id: string, name: string) => Promise<TaskList[]>;
    remove: (id: string) => Promise<TaskList[]>;
    switch: (id: string) => Promise<TaskList[]>;
    onChanged: (callback: (lists: TaskList[]) => void) => () => void;
  }

  interface Window {
    vault?: VaultBridge;
    vaults?: VaultsBridge;
    updater?: UpdaterBridge;
    preferences?: PreferencesBridge;
    contextMenu?: ContextMenuBridge;
    tasks?: TasksBridge;
    taskLists?: TaskListsBridge;
    auth?: AuthBridge;
    sync?: SyncBridge;
    calendar?: CalendarBridge;
    properties?: PropertiesBridge;
    occurrences?: OccurrencesBridge;
    search?: SearchBridge;
  }
}
