import {
  applyHeading,
  insertLink,
  insertTable,
  toggleLinePrefix,
  toggleNumberedList,
  wrapSelection,
  type FormattingResult,
  type Selection,
} from './mdxFormatting';

// Registre unique des actions de la barre de formatage Notes — utilisé à la
// fois par l'éditeur (components/NotesScreen.tsx, pour exécuter l'action et
// câbler les raccourcis clavier, voir `shortcut` ci-dessous) et par
// Paramètres (components/settings/EditorSection.tsx, pour proposer de
// réordonner/masquer chaque bouton). Les préférences ne stockent que des
// ids (voir apps/desktop/electron/preferences.ts) ; ce fichier est la seule
// source de vérité sur ce qu'un id représente concrètement.

export type ToolbarActionId =
  | 'h1'
  | 'h2'
  | 'h3'
  | 'h4'
  | 'h5'
  | 'h6'
  | 'bold'
  | 'italic'
  | 'code'
  | 'quote'
  | 'bullet'
  | 'numbered'
  | 'link'
  | 'table';

export type ToolbarAction = {
  id: ToolbarActionId;
  label: string;
  run: (text: string, selection: Selection) => FormattingResult;
  // Raccourci clavier CodeMirror (syntaxe `@codemirror/view` — 'Mod' = Cmd
  // sur macOS / Ctrl ailleurs) câblé dans MdxEditor.tsx et affiché dans
  // Paramètres → Éditeur (voir NOTES_TOOLBAR_SHORTCUT_LABELS). Absent pour
  // 'table', qui n'a pas d'équivalent standard.
  shortcut?: string;
};

// Historique : les 6 niveaux de titre vivaient sous un seul bouton "H" qui
// déployait un sous-menu (voir EditorToolbar.tsx, mécanisme `subItems`,
// encore utilisé par ce composant mais plus par Notes). Éclatés en 6 actions
// individuelles pour que chaque niveau soit réordonnable/masquable à part
// dans Paramètres (ex. quelqu'un qui n'utilise jamais H5/H6) — voir aussi
// `normalizeNotesToolbarOrder` plus bas pour la migration d'un ordre déjà
// enregistré avec l'ancien id 'heading-group'.
const HEADING_ACTIONS: ToolbarAction[] = ([1, 2, 3, 4, 5, 6] as const).map((level) => ({
  id: `h${level}` as ToolbarActionId,
  label: `H${level}`,
  run: (text: string, sel: Selection) => applyHeading(text, sel, level),
  shortcut: `Mod-${level}`,
}));

export const NOTES_TOOLBAR_ACTIONS: ToolbarAction[] = [
  ...HEADING_ACTIONS,
  { id: 'bold', label: 'G', run: (text, sel) => wrapSelection(text, sel, '**'), shortcut: 'Mod-b' },
  { id: 'italic', label: 'I', run: (text, sel) => wrapSelection(text, sel, '_'), shortcut: 'Mod-i' },
  { id: 'code', label: '</>', run: (text, sel) => wrapSelection(text, sel, '`'), shortcut: 'Mod-e' },
  // Mod-Shift-7/8/9 : suite mnémotechnique liste numérotée/à puces/citation
  // (7/8 reprennent la convention Google Docs/Word pour les listes).
  { id: 'quote', label: '❝', run: (text, sel) => toggleLinePrefix(text, sel, '> '), shortcut: 'Mod-Shift-9' },
  { id: 'bullet', label: '•', run: (text, sel) => toggleLinePrefix(text, sel, '- '), shortcut: 'Mod-Shift-8' },
  { id: 'numbered', label: '1.', run: (text, sel) => toggleNumberedList(text, sel), shortcut: 'Mod-Shift-7' },
  { id: 'link', label: '🔗', run: (text, sel) => insertLink(text, sel), shortcut: 'Mod-k' },
  { id: 'table', label: '▦', run: (text, sel) => insertTable(text, sel) },
];

// Libellés lisibles pour la liste de réorganisation dans Paramètres (plus
// explicites que les glyphes courts affichés sur les boutons eux-mêmes).
export const NOTES_TOOLBAR_DESCRIPTIONS: Record<ToolbarActionId, string> = {
  h1: 'Titre 1',
  h2: 'Titre 2',
  h3: 'Titre 3',
  h4: 'Titre 4',
  h5: 'Titre 5',
  h6: 'Titre 6',
  bold: 'Gras',
  italic: 'Italique',
  code: 'Code',
  quote: 'Citation',
  bullet: 'Liste à puces',
  numbered: 'Liste numérotée',
  link: 'Lien',
  table: 'Tableau',
};

// Affichage humain du raccourci (⌘/Ctrl selon la plateforme) pour Paramètres
// → Éditeur — 'Mod' de CodeMirror ne se traduit pas tout seul en glyphe.
function formatShortcutLabel(shortcut: string): string {
  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform ?? '');
  const modKey = isMac ? '⌘' : 'Ctrl';
  return shortcut
    .split('-')
    .map((part) => (part === 'Mod' ? modKey : part === 'Shift' ? 'Maj' : part))
    .join('+');
}

export const NOTES_TOOLBAR_SHORTCUT_LABELS: Partial<Record<ToolbarActionId, string>> = Object.fromEntries(
  NOTES_TOOLBAR_ACTIONS.filter((action) => action.shortcut).map((action) => [
    action.id,
    formatShortcutLabel(action.shortcut as string),
  ]),
);

export const DEFAULT_NOTES_TOOLBAR_ORDER: { id: ToolbarActionId; visible: boolean }[] =
  NOTES_TOOLBAR_ACTIONS.map((action) => ({ id: action.id, visible: true }));

// Migration d'un ordre déjà enregistré sur disque (voir PreferencesContext,
// chargé via window.preferences) : une préférence sauvegardée AVANT
// l'éclatement du groupe "H" contient encore l'id 'heading-group' au lieu
// des 6 ids h1..h6. Sans cette conversion, ce bouton disparaîtrait
// silencieusement de la barre (NOTES_TOOLBAR_ACTIONS ne le connaît plus) —
// on le remplace par les 6 niveaux, à la même position, avec la même
// visibilité. Ajoute aussi en fin de liste toute action absente de l'ordre
// stocké (même logique que le merge `{...DEFAULT_PREFERENCES, ...stored}` :
// un futur nouveau bouton doit apparaître visible plutôt que masqué).
export function normalizeNotesToolbarOrder(order: ToolbarItemConfig[]): ToolbarItemConfig[] {
  const expanded: ToolbarItemConfig[] = [];
  for (const item of order) {
    if ((item.id as string) === 'heading-group') {
      HEADING_ACTIONS.forEach((heading) => expanded.push({ id: heading.id, visible: item.visible }));
    } else {
      expanded.push(item);
    }
  }
  for (const action of NOTES_TOOLBAR_ACTIONS) {
    if (!expanded.some((item) => item.id === action.id)) expanded.push({ id: action.id, visible: true });
  }
  return expanded;
}
