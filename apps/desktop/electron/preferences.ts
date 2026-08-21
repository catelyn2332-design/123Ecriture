import { ipcMain, shell } from 'electron';

import { getConfigPath, readConfig, writeConfig } from './config';
import type { Preferences, ToolbarItemConfig } from './types';

// Personnalisation de l'interface — voir docs/ARCHITECTURE.md §7. Stockée
// pour l'instant dans le config.json app-level (userData), pas encore
// vault-scopée (`.123ecriture/theme.json`) comme prévu à terme dans
// l'architecture : ça fonctionne même sans vault sélectionné, et évite de
// coupler la personnalisation à la présence d'un vault tant que la sync
// compte (Phase 3) n'existe pas. À revisiter quand la personnalisation
// devra suivre l'utilisateur·rice plutôt que la machine.
export const DEFAULT_PREFERENCES: Preferences = {
  themeMode: 'system',
  accentColor: '#4f46e5',
  // Ordre + visibilité des boutons de la barre d'outils Notes. La liste des
  // ids possibles vit côté renderer (apps/mobile/lib/notesToolbarActions.ts)
  // — le process principal ne connaît que la structure générique.
  notesToolbarOrder: [
    // 'heading-group' remplace les anciennes entrées h1/h2/h3 séparées —
    // un seul bouton "H" qui déploie H1-H6 (voir
    // apps/mobile/lib/notesToolbarActions.ts et EditorToolbar.tsx). Les
    // configs déjà enregistrées avec les anciens ids h1/h2/h3 les
    // perdent silencieusement (id inconnu, filtré au rendu — voir
    // NotesScreen.tsx) et gagnent 'heading-group' à la fin via
    // mergeToolbarOrder ci-dessous.
    { id: 'heading-group', visible: true },
    { id: 'bold', visible: true },
    { id: 'italic', visible: true },
    { id: 'code', visible: true },
    { id: 'quote', visible: true },
    { id: 'bullet', visible: true },
    { id: 'numbered', visible: true },
    { id: 'link', visible: true },
    { id: 'table', visible: true },
  ],
  // Même principe pour Canvas et Graphiques (voir
  // apps/mobile/lib/canvasToolbarActions.ts / chartToolbarActions.ts).
  canvasToolbarOrder: [
    { id: 'add-text', visible: true },
    { id: 'add-note', visible: true },
  ],
  chartToolbarOrder: [
    { id: 'add-column', visible: true },
    { id: 'add-row', visible: true },
    { id: 'create-chart', visible: true },
  ],
  attachmentsFolder: 'attachments',
  autoCreateWikilinkTarget: true,
  newNoteLocation: 'vaultRoot',
  newNoteCustomFolder: '',
  fileSortMode: 'alphabetical',
  defaultOpenMode: 'lastOpened',
  defaultOpenSpecificPath: '',
  editorFontSize: 15,
  editorFontFamily: 'system',
  editorDefaultMode: 'source',
  editorCloseBrackets: true,
  editorInlineTitle: false,
  // Voir apps/mobile/lib/useResizablePanel.ts pour la logique de
  // redimensionnement/repli au curseur elle-même — ceci n'est que l'état
  // persisté par défaut.
  sidebarLayout: {
    nav: { width: 220, collapsed: false },
    explorer: { width: 260, collapsed: false },
    rightPanel: { width: 280, collapsed: false },
  },
  favoriteRelPaths: [],
  // Sync manuelle par défaut — choix déjà tranché (voir CLAUDE.md), ne
  // JAMAIS passer à `true` ici.
  autoSyncEnabled: false,
};

// Les 3 listes `*ToolbarOrder` (Notes/Canvas/Graphiques) ont besoin d'une
// fusion plus fine que le reste : une config déjà enregistrée AVANT l'ajout
// d'un nouveau bouton par défaut (ex. "table") ne le contient pas encore —
// une fusion superficielle prendrait la liste stockée telle quelle et le
// nouveau bouton disparaîtrait silencieusement. On l'ajoute plutôt à la fin
// (règle CLAUDE.md : un nouveau bouton doit être visible et fonctionnel, pas
// juste présent dans le code).
function mergeToolbarOrder(
  defaults: ToolbarItemConfig[],
  stored: ToolbarItemConfig[] | undefined,
): ToolbarItemConfig[] {
  if (!stored) return defaults;
  const knownIds = new Set(stored.map((item) => item.id));
  const missing = defaults.filter((item) => !knownIds.has(item.id));
  return [...stored, ...missing];
}

export function getPreferences(): Preferences {
  const stored = readConfig().preferences;
  // Fusion superficielle : tolère qu'une version future ajoute un champ par
  // défaut sans planter sur une config plus ancienne qui ne l'a pas encore.
  const merged: Preferences = { ...DEFAULT_PREFERENCES, ...stored };

  merged.notesToolbarOrder = mergeToolbarOrder(DEFAULT_PREFERENCES.notesToolbarOrder, stored?.notesToolbarOrder);
  merged.canvasToolbarOrder = mergeToolbarOrder(DEFAULT_PREFERENCES.canvasToolbarOrder, stored?.canvasToolbarOrder);
  merged.chartToolbarOrder = mergeToolbarOrder(DEFAULT_PREFERENCES.chartToolbarOrder, stored?.chartToolbarOrder);

  return merged;
}

export function registerPreferencesHandlers(): void {
  ipcMain.handle('preferences:get', () => getPreferences());

  ipcMain.handle('preferences:set', (_event, partial: Partial<Preferences>) => {
    const next = { ...getPreferences(), ...partial };
    writeConfig({ preferences: next });
    return next;
  });

  // Paramètres → Confidentialité et données : remet uniquement la
  // personnalisation (préférences) aux valeurs par défaut, sans toucher aux
  // coffres ni au contenu des notes — voir DEFAULT_PREFERENCES ci-dessus.
  ipcMain.handle('preferences:reset', () => {
    writeConfig({ preferences: DEFAULT_PREFERENCES });
    return DEFAULT_PREFERENCES;
  });

  ipcMain.handle('preferences:get-config-path', () => getConfigPath());

  ipcMain.handle('preferences:reveal-config-folder', () => {
    shell.showItemInFolder(getConfigPath());
  });
}
