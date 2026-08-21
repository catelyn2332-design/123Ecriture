import { Pressable, StyleSheet, Text, View } from 'react-native';

import { CANVAS_TOOLBAR_DESCRIPTIONS } from '../../lib/canvasToolbarActions';
import { EDITOR_FONT_STACKS } from '../MdxEditor';
import { CHART_TOOLBAR_DESCRIPTIONS } from '../../lib/chartToolbarActions';
import { NOTES_TOOLBAR_DESCRIPTIONS, NOTES_TOOLBAR_SHORTCUT_LABELS } from '../../lib/notesToolbarActions';
import { usePreferences } from '../../preferences/PreferencesContext';
import { SettingsToggle } from './SettingsToggle';
import { settingsStyles as s } from './settingsStyles';
import { ToolbarOrderEditor } from './ToolbarOrderEditor';

const MIN_FONT_SIZE = 12;
const MAX_FONT_SIZE = 22;

const DEFAULT_MODE_OPTIONS: { value: EditorViewMode; label: string }[] = [
  { value: 'source', label: 'Source' },
  { value: 'split', label: 'Intermédiaire' },
  { value: 'reading', label: 'Aperçu' },
];

const FONT_FAMILY_OPTIONS: { value: EditorFontFamily; label: string }[] = [
  { value: 'system', label: 'Système' },
  { value: 'sans', label: 'Sans-serif' },
  { value: 'serif', label: 'Serif' },
  { value: 'mono', label: 'Monospace' },
  { value: 'dyslexic', label: 'Dyslexie' },
];

// Section "Éditeur" — réglages lus par MdxEditor.tsx et NotesScreen.tsx à
// chaque ouverture/rendu de note (voir usages de `preferences.editorFontSize`,
// `.editorDefaultMode`, `.editorCloseBrackets`, `.editorInlineTitle`), plus
// les barres d'outils Notes/Canvas/Graphiques (lues par NotesScreen.tsx/
// CanvasEditor.tsx/ChartEditor.tsx via `preferences.notesToolbarOrder`/
// `canvasToolbarOrder`/`chartToolbarOrder`) — regroupées ici plutôt que la
// barre Notes dans Personnalisation et les deux autres ici : les 3 réglages
// de barre d'outils vivent au même endroit.
export function EditorSection() {
  const {
    preferences,
    theme,
    setEditorFontSize,
    setEditorFontFamily,
    setEditorDefaultMode,
    setEditorCloseBrackets,
    setEditorInlineTitle,
    setNotesToolbarOrder,
    setCanvasToolbarOrder,
    setChartToolbarOrder,
  } = usePreferences();

  const adjustFontSize = (delta: 1 | -1) => {
    const next = preferences.editorFontSize + delta;
    if (next < MIN_FONT_SIZE || next > MAX_FONT_SIZE) return;
    void setEditorFontSize(next);
  };

  return (
    <View style={styles.stack}>
      <View style={[s.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
        <Text style={[s.cardTitle, { color: theme.text }]}>✍️ Éditeur</Text>

        <Text style={[s.label, { color: theme.textMuted }]}>Taille de police</Text>
        <View style={s.stepperRow}>
          <Pressable
            onPress={() => adjustFontSize(-1)}
            disabled={preferences.editorFontSize <= MIN_FONT_SIZE}
            style={[
              s.stepperButton,
              { borderColor: theme.border },
              preferences.editorFontSize <= MIN_FONT_SIZE && { opacity: 0.3 },
            ]}
          >
            <Text style={{ color: theme.text }}>−</Text>
          </Pressable>
          <Text style={[s.stepperValue, { color: theme.text }]}>{preferences.editorFontSize}px</Text>
          <Pressable
            onPress={() => adjustFontSize(1)}
            disabled={preferences.editorFontSize >= MAX_FONT_SIZE}
            style={[
              s.stepperButton,
              { borderColor: theme.border },
              preferences.editorFontSize >= MAX_FONT_SIZE && { opacity: 0.3 },
            ]}
          >
            <Text style={{ color: theme.text }}>+</Text>
          </Pressable>
        </View>

        <Text style={[s.label, { color: theme.textMuted }]}>Police d’écriture</Text>
        <View style={s.row}>
          {FONT_FAMILY_OPTIONS.map((option) => {
            const isActive = preferences.editorFontFamily === option.value;
            return (
              <Pressable
                key={option.value}
                onPress={() => void setEditorFontFamily(option.value)}
                style={[
                  s.modeButton,
                  { borderColor: theme.border },
                  isActive && { backgroundColor: theme.accent, borderColor: theme.accent },
                ]}
              >
                <Text
                  style={{
                    color: isActive ? '#fff' : theme.text,
                    fontFamily: option.value === 'system' ? undefined : EDITOR_FONT_STACKS[option.value],
                  }}
                >
                  {option.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <Text style={[s.label, { color: theme.textMuted }]}>Mode d’édition par défaut à l’ouverture</Text>
        <View style={s.row}>
          {DEFAULT_MODE_OPTIONS.map((option) => {
            const isActive = preferences.editorDefaultMode === option.value;
            return (
              <Pressable
                key={option.value}
                onPress={() => void setEditorDefaultMode(option.value)}
                style={[
                  s.modeButton,
                  { borderColor: theme.border },
                  isActive && { backgroundColor: theme.accent, borderColor: theme.accent },
                ]}
              >
                <Text style={{ color: isActive ? '#fff' : theme.text }}>{option.label}</Text>
              </Pressable>
            );
          })}
        </View>

        <SettingsToggle
          label="Association automatique de crochets/guillemets"
          value={preferences.editorCloseBrackets}
          onChange={(value) => void setEditorCloseBrackets(value)}
          theme={theme}
        />
        <SettingsToggle
          label="Titre en ligne avec le contenu"
          value={preferences.editorInlineTitle}
          onChange={(value) => void setEditorInlineTitle(value)}
          theme={theme}
        />
      </View>

      <View style={[s.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
        <Text style={[s.cardTitle, { color: theme.text }]}>📝 Barre d’outils Notes</Text>
        <Text style={[s.label, { color: theme.textMuted }]}>Ordre et boutons affichés</Text>
        <ToolbarOrderEditor
          items={preferences.notesToolbarOrder}
          descriptions={NOTES_TOOLBAR_DESCRIPTIONS}
          shortcuts={NOTES_TOOLBAR_SHORTCUT_LABELS}
          onChange={(order) => void setNotesToolbarOrder(order)}
          theme={theme}
        />
      </View>

      <View style={[s.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
        <Text style={[s.cardTitle, { color: theme.text }]}>🖼️ Barre d’outils Canvas</Text>
        <Text style={[s.label, { color: theme.textMuted }]}>Ordre et boutons affichés</Text>
        <ToolbarOrderEditor
          items={preferences.canvasToolbarOrder}
          descriptions={CANVAS_TOOLBAR_DESCRIPTIONS}
          onChange={(order) => void setCanvasToolbarOrder(order)}
          theme={theme}
        />
      </View>

      <View style={[s.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
        <Text style={[s.cardTitle, { color: theme.text }]}>📊 Barre d’outils Graphiques</Text>
        <Text style={[s.label, { color: theme.textMuted }]}>Ordre et boutons affichés</Text>
        <ToolbarOrderEditor
          items={preferences.chartToolbarOrder}
          descriptions={CHART_TOOLBAR_DESCRIPTIONS}
          onChange={(order) => void setChartToolbarOrder(order)}
          theme={theme}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  stack: {
    gap: 16,
  },
});
