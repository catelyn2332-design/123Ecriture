import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useColorScheme } from 'react-native';

import { DEFAULT_CANVAS_TOOLBAR_ORDER } from '../lib/canvasToolbarActions';
import { DEFAULT_CHART_TOOLBAR_ORDER } from '../lib/chartToolbarActions';
import { DEFAULT_NOTES_TOOLBAR_ORDER, normalizeNotesToolbarOrder } from '../lib/notesToolbarActions';
import { darkTheme, lightTheme, type Theme } from '../theme';

// Point central de la personnalisation de l'interface (voir
// docs/ARCHITECTURE.md §7 et l'écran Paramètres → Personnalisation) :
// résout le thème effectif (mode clair/sombre/système + couleur d'accent)
// et l'ordre/visibilité de la barre d'outils Notes, et fournit les setters
// qui persistent côté Electron (window.preferences) quand disponible. Sur
// web/mobile (pas de window.preferences), tout reste en mémoire pour la
// session — pas de crash, juste pas de persistance.

const DEFAULT_PREFERENCES: Preferences = {
  themeMode: 'system',
  accentColor: lightTheme.accent,
  notesToolbarOrder: DEFAULT_NOTES_TOOLBAR_ORDER,
  canvasToolbarOrder: DEFAULT_CANVAS_TOOLBAR_ORDER,
  chartToolbarOrder: DEFAULT_CHART_TOOLBAR_ORDER,
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

type PreferencesContextValue = {
  preferences: Preferences;
  theme: Theme;
  colorScheme: 'light' | 'dark';
  // Toutes renvoient une Promise qui se résout une fois l'écriture DISQUE
  // terminée (pas seulement l'état React local) — voir `persist` plus bas
  // pour pourquoi c'est nécessaire (course avec `vault:reorder`, qui relit
  // `fileSortMode` depuis le disque à chaque appel).
  setThemeMode: (mode: ThemeMode) => Promise<void>;
  setAccentColor: (color: string) => Promise<void>;
  setNotesToolbarOrder: (order: ToolbarItemConfig[]) => Promise<void>;
  setCanvasToolbarOrder: (order: ToolbarItemConfig[]) => Promise<void>;
  setChartToolbarOrder: (order: ToolbarItemConfig[]) => Promise<void>;
  setAttachmentsFolder: (folder: string) => Promise<void>;
  setAutoCreateWikilinkTarget: (value: boolean) => Promise<void>;
  setNewNoteLocation: (location: NewNoteLocation) => Promise<void>;
  setNewNoteCustomFolder: (folder: string) => Promise<void>;
  setFileSortMode: (mode: FileSortMode) => Promise<void>;
  setDefaultOpenMode: (mode: DefaultOpenMode) => Promise<void>;
  setDefaultOpenSpecificPath: (relPath: string) => Promise<void>;
  setEditorFontSize: (size: number) => Promise<void>;
  setEditorFontFamily: (family: EditorFontFamily) => Promise<void>;
  setEditorDefaultMode: (mode: EditorViewMode) => Promise<void>;
  setEditorCloseBrackets: (value: boolean) => Promise<void>;
  setEditorInlineTitle: (value: boolean) => Promise<void>;
  setSidebarPanelLayout: (id: SidebarPanelId, layout: SidebarPanelLayout) => Promise<void>;
  // Notes épinglées (voir NotesScreen.tsx, menu contextuel "Ajouter aux
  // favoris"/"Retirer des favoris" + section "⭐ Favoris" de l'explorateur) —
  // bascule l'appartenance de `relPath` à `favoriteRelPaths` en une seule
  // opération, plutôt que de laisser chaque appelant reconstruire le
  // tableau à la main (même esprit que les autres setters ci-dessus, qui
  // persistent directement).
  toggleFavorite: (relPath: string) => Promise<void>;
  // Paramètres → Compte et synchronisation, bascule "Synchroniser
  // automatiquement" — voir lib/sync/SyncStatusContext.tsx pour l'effet qui
  // la consomme réellement (démarrage + intervalle).
  setAutoSyncEnabled: (value: boolean) => Promise<void>;
  // Paramètres → Confidentialité et données. `undefined` si non disponible
  // (pas de pont Electron, ex. web/mobile) — laissé à la charge de l'écran
  // d'afficher/masquer les actions correspondantes, même logique de
  // dégradation que le reste des préférences.
  resetPreferences: () => void;
  getConfigPath: (() => Promise<string>) | undefined;
  revealConfigFolder: (() => Promise<void>) | undefined;
  // `false` tant que le premier `bridge.get()` n'a pas résolu (true
  // immédiatement sans pont — web/mobile, rien à charger). Distingue "on ne
  // sait pas encore" de "vraiment DEFAULT_PREFERENCES" : `preferences`
  // vaut `DEFAULT_PREFERENCES` dans LES DEUX cas le temps du premier
  // chargement, ce qui a fait planter une fois "Fichier ouvert par défaut"
  // (NotesScreen.tsx) — un effet lisant `preferences.defaultOpenMode` trop
  // tôt (avant la résolution du bridge) l'ouvrait toujours en 'lastOpened'
  // (la valeur par défaut), jamais le VRAI mode configuré, et son verrou
  // "une fois par coffre" empêchait tout second essai une fois les vraies
  // préférences arrivées.
  preferencesLoaded: boolean;
};

const PreferencesReactContext = createContext<PreferencesContextValue | null>(null);

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const systemScheme = useColorScheme();
  const bridge = typeof window !== 'undefined' ? window.preferences : undefined;
  const [preferences, setPreferences] = useState<Preferences>(DEFAULT_PREFERENCES);
  // Pas de pont (web/mobile) : rien à charger, "chargé" dès le départ.
  const [preferencesLoaded, setPreferencesLoaded] = useState(!bridge);

  useEffect(() => {
    if (!bridge) return;
    void bridge
      .get()
      .then((stored) => {
        const merged = { ...DEFAULT_PREFERENCES, ...stored };
        // Voir notesToolbarActions.ts : convertit un ordre enregistré avant
        // l'éclatement du groupe "H" (id 'heading-group') vers les 6
        // niveaux individuels, sans quoi ce bouton disparaîtrait de la
        // barre pour une utilisatrice ayant déjà personnalisé son ordre.
        merged.notesToolbarOrder = normalizeNotesToolbarOrder(merged.notesToolbarOrder);
        setPreferences(merged);
      })
      .catch((error) => console.error('[preferences] échec du chargement :', error))
      .finally(() => setPreferencesLoaded(true));
  }, [bridge]);

  // Renvoie une Promise qui se résout une fois l'écriture DISQUE (pas
  // seulement l'état React local) effectivement terminée — nécessaire pour
  // les appelants qui doivent enchaîner une action qui dépend de cette
  // préférence déjà persistée côté main process (ex. NotesScreen.tsx,
  // `handleDrop` : `vault:reorder` relit `fileSortMode` depuis le disque à
  // CHAQUE appel, donc appeler `setFileSortMode('manual')` sans attendre
  // la fin réelle de l'écriture avant de réordonner crée une course où le
  // réordonnancement se fait encore lire en mode 'alphabetical' — l'ordre
  // glissé-déposé semble alors "revenir à sa place" puisque `vault:reorder`
  // l'ignore silencieusement dans ce mode). Sans pont (web/mobile), résout
  // immédiatement : rien à attendre, l'état local suffit.
  const persist = useCallback(
    (partial: Partial<Preferences>): Promise<void> => {
      setPreferences((prev) => ({ ...prev, ...partial }));
      if (!bridge) return Promise.resolve();
      return bridge.set(partial).then(
        () => undefined,
        (error) => {
          console.error('[preferences] échec de sauvegarde :', error);
        },
      );
    },
    [bridge],
  );

  const setThemeMode = useCallback((mode: ThemeMode) => persist({ themeMode: mode }), [persist]);
  const setAccentColor = useCallback((color: string) => persist({ accentColor: color }), [persist]);
  const setNotesToolbarOrder = useCallback(
    (order: ToolbarItemConfig[]) => persist({ notesToolbarOrder: order }),
    [persist],
  );
  const setCanvasToolbarOrder = useCallback(
    (order: ToolbarItemConfig[]) => persist({ canvasToolbarOrder: order }),
    [persist],
  );
  const setChartToolbarOrder = useCallback(
    (order: ToolbarItemConfig[]) => persist({ chartToolbarOrder: order }),
    [persist],
  );
  const setAttachmentsFolder = useCallback(
    (folder: string) => persist({ attachmentsFolder: folder }),
    [persist],
  );
  const setAutoCreateWikilinkTarget = useCallback(
    (value: boolean) => persist({ autoCreateWikilinkTarget: value }),
    [persist],
  );
  const setNewNoteLocation = useCallback(
    (location: NewNoteLocation) => persist({ newNoteLocation: location }),
    [persist],
  );
  const setNewNoteCustomFolder = useCallback(
    (folder: string) => persist({ newNoteCustomFolder: folder }),
    [persist],
  );
  const setFileSortMode = useCallback((mode: FileSortMode) => persist({ fileSortMode: mode }), [persist]);
  // Paramètres → Gestion des fichiers et des liens → "Fichier ouvert par
  // défaut" (voir NotesScreen.tsx, effet d'ouverture au démarrage) : quel
  // fichier ouvrir à chaque lancement de l'app / changement de coffre.
  const setDefaultOpenMode = useCallback(
    (mode: DefaultOpenMode) => persist({ defaultOpenMode: mode }),
    [persist],
  );
  const setDefaultOpenSpecificPath = useCallback(
    (relPath: string) => persist({ defaultOpenSpecificPath: relPath }),
    [persist],
  );
  const setEditorFontSize = useCallback((size: number) => persist({ editorFontSize: size }), [persist]);
  const setEditorFontFamily = useCallback(
    (family: EditorFontFamily) => persist({ editorFontFamily: family }),
    [persist],
  );
  const setEditorDefaultMode = useCallback(
    (mode: EditorViewMode) => persist({ editorDefaultMode: mode }),
    [persist],
  );
  const setEditorCloseBrackets = useCallback(
    (value: boolean) => persist({ editorCloseBrackets: value }),
    [persist],
  );
  const setEditorInlineTitle = useCallback(
    (value: boolean) => persist({ editorInlineTitle: value }),
    [persist],
  );
  // Un seul panneau à la fois (voir lib/useResizablePanel.ts) : merge sur
  // l'objet `sidebarLayout` courant plutôt que d'écraser les 3 entrées,
  // sinon redimensionner l'explorateur oublierait la largeur mémorisée du
  // panneau droit.
  const setSidebarPanelLayout = useCallback(
    (id: SidebarPanelId, layout: SidebarPanelLayout) =>
      persist({ sidebarLayout: { ...preferences.sidebarLayout, [id]: layout } }),
    [persist, preferences.sidebarLayout],
  );
  const toggleFavorite = useCallback(
    (relPath: string) => {
      const current = preferences.favoriteRelPaths;
      const next = current.includes(relPath)
        ? current.filter((path) => path !== relPath)
        : [...current, relPath];
      return persist({ favoriteRelPaths: next });
    },
    [persist, preferences.favoriteRelPaths],
  );

  const setAutoSyncEnabled = useCallback((value: boolean) => persist({ autoSyncEnabled: value }), [persist]);

  const resetPreferences = useCallback(() => {
    setPreferences(DEFAULT_PREFERENCES);
    if (bridge) {
      bridge.reset().catch((error) => console.error('[preferences] échec de la réinitialisation :', error));
    }
  }, [bridge]);

  const getConfigPath = bridge?.getConfigPath;
  const revealConfigFolder = bridge?.revealConfigFolder;

  const colorScheme: 'light' | 'dark' =
    preferences.themeMode === 'system' ? (systemScheme === 'dark' ? 'dark' : 'light') : preferences.themeMode;

  const theme = useMemo<Theme>(() => {
    const base = colorScheme === 'dark' ? darkTheme : lightTheme;
    return { ...base, accent: preferences.accentColor };
  }, [colorScheme, preferences.accentColor]);

  const value = useMemo<PreferencesContextValue>(
    () => ({
      preferences,
      preferencesLoaded,
      theme,
      colorScheme,
      setThemeMode,
      setAccentColor,
      setNotesToolbarOrder,
      setCanvasToolbarOrder,
      setChartToolbarOrder,
      setAttachmentsFolder,
      setAutoCreateWikilinkTarget,
      setNewNoteLocation,
      setNewNoteCustomFolder,
      setFileSortMode,
      setDefaultOpenMode,
      setDefaultOpenSpecificPath,
      setEditorFontSize,
      setEditorFontFamily,
      setEditorDefaultMode,
      setEditorCloseBrackets,
      setEditorInlineTitle,
      setSidebarPanelLayout,
      toggleFavorite,
      setAutoSyncEnabled,
      resetPreferences,
      getConfigPath,
      revealConfigFolder,
    }),
    [
      preferences,
      preferencesLoaded,
      theme,
      colorScheme,
      setThemeMode,
      setAccentColor,
      setNotesToolbarOrder,
      setCanvasToolbarOrder,
      setChartToolbarOrder,
      setAttachmentsFolder,
      setAutoCreateWikilinkTarget,
      setNewNoteLocation,
      setNewNoteCustomFolder,
      setFileSortMode,
      setDefaultOpenMode,
      setDefaultOpenSpecificPath,
      setEditorFontSize,
      setEditorFontFamily,
      setEditorDefaultMode,
      setEditorCloseBrackets,
      setEditorInlineTitle,
      setSidebarPanelLayout,
      toggleFavorite,
      setAutoSyncEnabled,
      resetPreferences,
      getConfigPath,
      revealConfigFolder,
    ],
  );

  return <PreferencesReactContext.Provider value={value}>{children}</PreferencesReactContext.Provider>;
}

export function usePreferences(): PreferencesContextValue {
  const ctx = useContext(PreferencesReactContext);
  if (!ctx) {
    throw new Error('usePreferences() doit être appelé sous <PreferencesProvider>');
  }
  return ctx;
}
