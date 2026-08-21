import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import CodeMirror, { EditorView, type ReactCodeMirrorRef } from '@uiw/react-codemirror';
import { markdown } from '@codemirror/lang-markdown';
import { keymap } from '@codemirror/view';
import { Prec } from '@codemirror/state';

import { createLivePreviewExtension } from '../lib/mdxLivePreview';
import { createOccurrenceAutocomplete } from '../lib/occurrenceAutocomplete';
import type { FormattingResult, Selection } from '../lib/mdxFormatting';
import type { Theme } from '../theme';

// Piles de police web-safe pour Paramètres → Éditeur → Police d'écriture.
// 'system' garde le comportement d'origine ('inherit', hérite de la police
// système du thème global) ; les autres sont des piles CSS classiques —
// aucune n'a besoin d'un fichier de police embarqué.
export const EDITOR_FONT_STACKS: Record<EditorFontFamily, string> = {
  system: 'inherit',
  sans: '"Segoe UI", Helvetica, Arial, sans-serif',
  serif: 'Georgia, "Times New Roman", serif',
  mono: '"Fira Code", "JetBrains Mono", Consolas, monospace',
  dyslexic: '"OpenDyslexic", "Comic Sans MS", sans-serif',
};

// Éditeur MDX — remplace l'ancien `TextInput` brut pour les modes "Source"
// et "Intermédiaire" (voir NotesScreen.tsx). Un seul composant pour les
// deux modes : `livePreview=false` = CodeMirror nu (texte brut, comme un
// éditeur de code classique) ; `livePreview=true` = même éditeur + le
// `ViewPlugin` de lib/mdxLivePreview.ts (décorations façon Obsidian —
// gras/italique/titres stylés, liens/tags/occurrences/embeds en pastilles,
// tout révélé en texte brut quand le curseur est dedans). "Aperçu" (lecture
// seule, rendu complet) reste `NoteRenderer.tsx`, inchangé.
//
// S'intègre directement dans l'arbre React Native — l'app tourne comme une
// vraie appli react-dom (web export Expo compilé par react-native-web),
// donc un composant React « DOM pur » comme ce wrapper CodeMirror n'a besoin
// d'aucune échappatoire ref+useEffect (contrairement à SvgOverlay.tsx/
// AudioEmbed.tsx, qui injectent du DOM brut pour des primitives que RN
// n'expose pas du tout).
type Props = {
  value: string;
  onChange: (text: string) => void;
  livePreview: boolean;
  theme: Theme;
  onOpenWikilink: (target: string) => void;
  onOpenOccurrence?: (word: string) => void;
  // Mots du dictionnaire personnel (casse d'origine, voir
  // OccurrencesPanel.tsx) et création à la volée depuis l'autocomplétion
  // `{{` — voir lib/occurrenceAutocomplete.ts. Optionnels : sans eux,
  // taper `{{` ne propose simplement aucune suggestion.
  occurrenceWords?: string[];
  onCreateOccurrence?: (word: string) => Promise<void>;
  onReady?: (ref: ReactCodeMirrorRef) => void;
  // Paramètres → Éditeur (voir PreferencesContext.tsx). Valeurs par défaut
  // alignées sur DEFAULT_PREFERENCES pour rester utilisable si le composant
  // est monté sans ces props (ex. anciens appelants, tests).
  fontSize?: number;
  fontFamily?: EditorFontFamily;
  closeBrackets?: boolean;
  // Raccourcis clavier de la barre de formatage (voir
  // lib/notesToolbarActions.ts, NOTES_TOOLBAR_ACTIONS[].shortcut) — même
  // fonction `run` que le clic sur le bouton correspondant, exécutée ici
  // directement sur l'EditorView plutôt que via NotesScreen.applyFormatting
  // (MdxEditor est le seul à détenir la vraie instance CodeMirror avant que
  // `onReady` ne la remonte). Optionnel : sans cette prop, seuls les
  // raccourcis par défaut de CodeMirror s'appliquent, comme avant.
  shortcuts?: { key: string; run: (text: string, selection: Selection) => FormattingResult }[];
};

export function MdxEditor({
  value,
  onChange,
  livePreview,
  theme,
  onOpenWikilink,
  onOpenOccurrence,
  occurrenceWords,
  onCreateOccurrence,
  onReady,
  fontSize = 15,
  fontFamily = 'system',
  closeBrackets = true,
  shortcuts,
}: Props) {
  const editorTheme = useMemo(
    () =>
      EditorView.theme({
        '&': {
          backgroundColor: theme.background,
          color: theme.text,
          height: '100%',
          fontSize: `${fontSize}px`,
        },
        '.cm-content': { padding: '16px', caretColor: theme.accent },
        '.cm-scroller': { fontFamily: EDITOR_FONT_STACKS[fontFamily], lineHeight: '1.6' },
        '&.cm-focused .cm-cursor': { borderLeftColor: theme.accent },
        '&.cm-focused .cm-selectionBackground, ::selection': { backgroundColor: `${theme.accent}33` },
        '.cm-gutters': { display: 'none' },
        '.cm-activeLine': { backgroundColor: 'transparent' },
      }),
    [theme, fontSize, fontFamily],
  );

  const liveExtension = useMemo(
    () =>
      createLivePreviewExtension(
        { accent: theme.accent, surface: theme.surface, border: theme.border, textMuted: theme.textMuted },
        { onOpenWikilink, onOpenOccurrence },
      ),
    [theme, onOpenWikilink, onOpenOccurrence],
  );

  // Recréée seulement quand le dictionnaire ou le callback de création
  // changent VRAIMENT (une mutation du dictionnaire — création/renommage/
  // suppression — pas à chaque frappe : `occurrenceWords` ne bouge pas
  // pendant la frappe normale) : pas besoin de l'échappatoire "ref lue dans
  // une closure figée" pour rester à jour. Remplace la complétion par
  // défaut de `basicSetup` (désactivée explicitement plus bas) : les deux
  // ne doivent pas coexister, `autocompletion()` est une extension
  // singleton côté CodeMirror.
  const occurrenceAutocomplete = useMemo(
    () =>
      createOccurrenceAutocomplete({
        getKnownWords: () => occurrenceWords ?? [],
        onCreateWord: async (word) => {
          await onCreateOccurrence?.(word);
        },
      }),
    [occurrenceWords, onCreateOccurrence],
  );

  // `Prec.highest` : garantit que ces raccourcis gagnent sur les bindings
  // par défaut de `basicSetup` (ex. historyKeymap) plutôt que de dépendre de
  // l'ordre d'enregistrement des extensions, qui n'est pas garanti stable.
  // La transaction dispatchée est strictement identique à celle
  // d'applyFormatting (NotesScreen.tsx) — même geste, juste déclenché au
  // clavier plutôt qu'au clic.
  const shortcutsExtension = useMemo(() => {
    if (!shortcuts || shortcuts.length === 0) return null;
    return Prec.highest(
      keymap.of(
        shortcuts.map(({ key, run }) => ({
          key,
          run: (view: EditorView) => {
            const sel = view.state.selection.main;
            const result = run(view.state.doc.toString(), { start: sel.from, end: sel.to });
            view.dispatch({
              changes: { from: 0, to: view.state.doc.length, insert: result.text },
              selection: { anchor: result.selection.start, head: result.selection.end },
            });
            return true;
          },
        })),
      ),
    );
  }, [shortcuts]);

  const extensions = useMemo(() => {
    const base = [markdown(), EditorView.lineWrapping, occurrenceAutocomplete];
    const withShortcuts = shortcutsExtension ? [...base, shortcutsExtension] : base;
    return livePreview ? [...withShortcuts, liveExtension] : withShortcuts;
  }, [livePreview, liveExtension, occurrenceAutocomplete, shortcutsExtension]);

  return (
    <View style={styles.container}>
      <CodeMirror
        value={value}
        height="100%"
        // `style` n'est PAS dans la liste des props reconnues par
        // @uiw/react-codemirror (voir son `esm/index.js`, `_excluded`) —
        // il atterrit donc tel quel sur le <div className="cm-theme-none">
        // que le composant rend lui-même pour englober l'éditeur. Ce div
        // n'a autrement AUCUNE hauteur explicite (le prop `height="100%"`
        // ci-dessus ne s'applique qu'à `.cm-editor`/`.cm-scroller`, PAS à
        // ce wrapper, via `theme/dimensionTheme.js`) : par défaut, un item
        // flexible sans hauteur explicite grandit pour englober tout son
        // contenu (`min-height:auto`) plutôt que de respecter la place
        // disponible dans le `View` (`styles.container`, `flex:1`,
        // pourtant bien borné) qui l'entoure — exactement le classique
        // "flexbug" des hauteurs en % dans une chaîne flexbox. Résultat
        // observé : `.cm-scroller` grandissait à la hauteur du CONTENU
        // entier de la note (confirmé : 3152px pour ~120 lignes) au lieu
        // de rester borné avec un scroll interne — l'éditeur semblait
        // "figé" (aucun scroll nulle part, tout le monde plus bas que
        // 800px passait simplement hors champ). `flex:1` + `minHeight:0`
        // ici donnent enfin une hauteur DÉFINIE à ce wrapper, ce qui
        // permet à `height:100%` de `.cm-editor` de se résoudre
        // normalement et à `.cm-scroller` (overflow-y:auto déjà géré en
        // interne par CodeMirror) de redevenir réellement scrollable.
        // `flexDirection:'column'` est IMPÉRATIF ici : par défaut, un
        // `display:'flex'` brut (ce div n'est pas un `View` React Native,
        // ses props ne passent donc PAS par les défauts habituels de RN)
        // vaut `flex-direction:row` — l'unique enfant (`.cm-editor`) se
        // serait alors dimensionné à la largeur de SON CONTENU sur l'axe
        // principal (horizontal) au lieu de s'étirer sur toute la largeur
        // disponible. Régression trouvée après coup : c'est exactement ce
        // qui causait "le fichier ne s'affiche qu'à la moitié de la page".
        style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}
        theme="none"
        extensions={[editorTheme, ...extensions]}
        basicSetup={{
          lineNumbers: false,
          foldGutter: false,
          highlightActiveLine: false,
          autocompletion: false,
          closeBrackets,
        }}
        onChange={onChange}
        ref={(ref) => {
          if (ref) onReady?.(ref);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
