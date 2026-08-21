// Logique partagée autour d'un `SearchResult` (voir
// apps/desktop/electron/search.ts) — icône/libellé d'affichage, "ce résultat
// est-il cliquable ?", clé de rendu stable, et "comment l'ouvrir" une fois
// cliqué. Utilisé par SearchDialog.tsx (recherche de l'explorateur, bouton
// 🔍) ET CommandPalette.tsx (Ctrl/Cmd+K) — regroupé ici pour que les deux
// UI restent visuellement/comportementalement identiques sans dupliquer
// cette logique.

// Icône par type de résultat — ✅/📅 pour tâche/évènement, cohérent avec les
// icônes de section (voir navigation.ts, SECTIONS).
export const SEARCH_RESULT_ICON: Record<SearchResultKind, string> = {
  markdown: '📝',
  canvas: '🎨',
  chart: '📊',
  excalidraw: '🖍️',
  folder: '📁',
  attachment: '📎',
  task: '✅',
  'calendar-event': '📅',
};

export const SEARCH_MATCH_LABEL: Record<SearchMatchType, string> = {
  title: 'titre',
  content: 'contenu',
  tag: 'mot-clé',
  property: 'propriété',
};

// Seuls markdown/canvas/graphique/excalidraw (ouverts dans Notes),
// tâche et évènement (ouverts dans Tâches/Calendrier) ont un vrai
// "endroit" où s'ouvrir — dossiers et pièces jointes n'ont pas d'éditeur
// dédié aujourd'hui, la ligne reste donc informative plutôt que de
// prétendre à un clic qui ne ferait rien (règle CLAUDE.md : un bouton doit
// faire ce qu'il annonce).
export function isSearchResultOpenable(kind: SearchResultKind): boolean {
  return (
    kind === 'markdown' ||
    kind === 'canvas' ||
    kind === 'chart' ||
    kind === 'excalidraw' ||
    kind === 'task' ||
    kind === 'calendar-event'
  );
}

// Clé de rendu stable — `relPath` seul ne suffit plus (vide pour
// tâche/évènement, voir SearchResult), on retombe alors sur l'identifiant
// propre au kind.
export function searchResultKey(result: SearchResult): string {
  return `${result.kind}:${result.relPath || result.taskId || result.eventId || result.name}`;
}

// Ce qu'un appelant doit savoir faire pour ouvrir chaque famille de
// résultat — une note s'ouvre "sur place" (voir openNoteByRelPath dans
// NotesScreen.tsx), une tâche/un évènement basculent sur un AUTRE écran ET
// révèlent l'élément trouvé (voir App.tsx, `requestOpenTask`/
// `requestOpenCalendarDate`, généralisation de `pendingOpenRelPath`).
export type SearchResultOpenHandlers = {
  openNote: (relPath: string) => void;
  openTask: (taskListId: string, taskId: string) => void;
  openCalendarEvent: (date: string) => void;
};

// Aiguille un résultat cliqué vers le bon handler — le seul point commun
// entre SearchDialog.tsx (déjà sur l'écran Notes, ouvre directement) et
// CommandPalette.tsx (n'importe quel écran, passe par les callbacks
// App.tsx) : les DEUX finissent par appeler ceci avec des `handlers`
// adaptés à leur contexte. Dossier/pièce jointe : aucun handler à
// appeler, cohérent avec `isSearchResultOpenable` ci-dessus.
export function openSearchResult(result: SearchResult, handlers: SearchResultOpenHandlers): void {
  switch (result.kind) {
    case 'markdown':
    case 'canvas':
    case 'chart':
    case 'excalidraw':
      handlers.openNote(result.relPath);
      return;
    case 'task':
      if (result.taskListId && result.taskId) handlers.openTask(result.taskListId, result.taskId);
      return;
    case 'calendar-event':
      if (result.eventDate) handlers.openCalendarEvent(result.eventDate);
      return;
    case 'folder':
    case 'attachment':
      return;
  }
}
