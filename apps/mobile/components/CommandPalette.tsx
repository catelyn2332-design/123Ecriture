import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { isSearchResultOpenable, openSearchResult, SEARCH_MATCH_LABEL, SEARCH_RESULT_ICON, searchResultKey } from '../lib/searchResults';
import type { Section } from '../navigation';
import type { Theme } from '../theme';
import type { NotesActions } from './AppShell';

// Palette de commandes (Ctrl/Cmd+K, voir AppShell.tsx pour le raccourci
// clavier global) — même coquille modale que SearchDialog.tsx (backdrop
// cliquable, boîte centrale, champ de requête débouncé) pour rester
// cohérente visuellement, mais deux listes plutôt qu'une :
//   1. des ACTIONS statiques ("Aller à...", "Nouvelle note"...), filtrées
//      par sous-chaîne insensible à la casse sur leur libellé ;
//   2. les résultats de la recherche globale (window.search, MÊME backend
//      que SearchDialog.tsx — voir lib/searchResults.ts pour la logique
//      partagée d'icône/ouverture, pas de duplication).
// Contrairement à SearchDialog.tsx (qui montre TOUT, y compris dossiers/
// pièces jointes non cliquables, pour naviguer/parcourir), cette palette ne
// propose QUE des résultats de recherche OUVRABLES — une palette de
// commandes sert à "faire quelque chose", pas à parcourir passivement.
const SEARCH_DEBOUNCE_MS = 300;

type PaletteAction = {
  id: string;
  label: string;
  icon: string;
  // `run` reste absent pour "new-note"/"new-folder" — lire
  // `notesActionsRef.current` doit se faire au moment de l'ACTIVATION
  // (dans `activateItem`, un vrai gestionnaire d'évènement), jamais pendant
  // le rendu ; React interdit de lire une ref n'importe où dans le corps du
  // composant AUTREMENT que dans un gestionnaire d'évènement/effet — même
  // "passer" la ref à une fonction stockée dans ce tableau (calculé
  // pendant le rendu) est refusé. `activateItem` distingue donc ces deux ids
  // par un `switch` plutôt que de leur donner un `run` ici.
  run?: () => void;
};

type PaletteItem = { type: 'action'; action: PaletteAction } | { type: 'result'; result: SearchResult };

type Props = {
  theme: Theme;
  sections: Section[];
  activeId: string;
  onSelect: (id: string) => void;
  notesActionsRef: RefObject<NotesActions | null>;
  onRequestOpenNote: (relPath: string) => void;
  onRequestOpenTask: (taskListId: string, taskId: string) => void;
  onRequestOpenCalendarDate: (date: string) => void;
  onClose: () => void;
};

// Icône par section — reprend celle déjà déclarée dans navigation.ts
// (`section.icon`) plutôt que d'en inventer une deuxième ici.
function gotoLabel(section: Section): string {
  return `Aller à ${section.label}`;
}

export function CommandPalette({
  theme,
  sections,
  activeId,
  onSelect,
  notesActionsRef,
  onRequestOpenNote,
  onRequestOpenTask,
  onRequestOpenCalendarDate,
  onClose,
}: Props) {
  const searchBridge = typeof window !== 'undefined' ? window.search : undefined;

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Actions statiques — "Nouvelle note"/"Nouveau dossier" ne sont proposées
  // QUE si Notes est déjà l'écran actif : solution la plus simple qui reste
  // correcte, plutôt qu'un registre d'actions générique par écran alors
  // qu'un seul écran expose ce genre d'action aujourd'hui. En pratique
  // NotesScreen s'enregistre (`onRegisterActions`) dès son montage, bien
  // avant qu'on puisse cliquer ici.
  const staticActions = useMemo<PaletteAction[]>(() => {
    const actions: PaletteAction[] = sections.map((section) => ({
      id: `goto-${section.id}`,
      label: gotoLabel(section),
      icon: section.icon,
      run: () => onSelect(section.id),
    }));
    if (activeId === 'notes') {
      actions.push(
        { id: 'new-note', label: 'Nouvelle note', icon: '📝' },
        { id: 'new-folder', label: 'Nouveau dossier', icon: '📁' },
      );
    }
    return actions;
  }, [sections, activeId, onSelect]);

  const filteredActions = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return staticActions;
    return staticActions.filter((action) => action.label.toLowerCase().includes(needle));
  }, [staticActions, query]);

  // Résultats de recherche globale — uniquement ceux qu'on peut réellement
  // ouvrir (voir le commentaire de tête). Débouncé comme SearchDialog.tsx ;
  // même idiome que SearchDialog.tsx : pas de `setResults([])` explicite
  // quand la requête est vide, `hasQuery` ci-dessous masque simplement les
  // résultats périmés plutôt que de forcer un setState synchrone en tête
  // d'effet (voir SearchDialog.tsx, commentaire `hasQuery`).
  const hasQuery = Boolean(query.trim());
  useEffect(() => {
    if (!searchBridge || !hasQuery) return;
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      setLoading(true);
      void searchBridge
        .run(query)
        .then((found) => setResults(found.filter((result) => isSearchResultOpenable(result.kind))))
        .catch(() => setResults([]))
        .finally(() => setLoading(false));
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, [query, searchBridge, hasQuery]);

  const searchResults = useMemo(() => (hasQuery ? results : []), [hasQuery, results]);

  const items = useMemo<PaletteItem[]>(
    () => [
      ...filteredActions.map((action): PaletteItem => ({ type: 'action', action })),
      ...searchResults.map((result): PaletteItem => ({ type: 'result', result })),
    ],
    [filteredActions, searchResults],
  );

  // Recale la sélection au premier élément à chaque changement de liste
  // (nouvelle requête, actions filtrées différemment...) — évite une
  // sélection périmée pointant sur un élément qui a disparu. Ajustement
  // PENDANT le rendu (comparaison à un état, PAS une ref — React interdit de
  // lire une ref pendant le rendu) : même correctif documenté par React que
  // DraftTextField.tsx (`prevInitialValue`) pour "réinitialiser un état
  // dérivé d'une valeur qui change".
  const itemsSignature = `${query}:${items.length}`;
  const [lastItemsSignature, setLastItemsSignature] = useState(itemsSignature);
  if (lastItemsSignature !== itemsSignature) {
    setLastItemsSignature(itemsSignature);
    if (selectedIndex !== 0) setSelectedIndex(0);
  }

  // Seul VRAI gestionnaire d'évènement à lire `notesActionsRef.current`
  // (voir PaletteAction.run ci-dessus) — appelé uniquement depuis onPress/
  // le clavier, jamais pendant le rendu.
  const activateItem = (item: PaletteItem) => {
    if (item.type === 'action') {
      if (item.action.id === 'new-note') notesActionsRef.current?.createNote();
      else if (item.action.id === 'new-folder') notesActionsRef.current?.createFolder();
      else item.action.run?.();
    } else {
      openSearchResult(item.result, {
        openNote: onRequestOpenNote,
        openTask: onRequestOpenTask,
        openCalendarEvent: onRequestOpenCalendarDate,
      });
    }
    onClose();
  };

  // Navigation clavier globale (flèches/Entrée/Échap) — voir AppShell.tsx
  // pour le raccourci d'OUVERTURE (Ctrl/Cmd+K) ; celui-ci gère la nav UNE
  // FOIS la palette ouverte, réenregistré à chaque changement de liste/
  // sélection (léger, pas de souci de perf pour une modale).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setSelectedIndex((i) => Math.min(items.length - 1, i + 1));
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setSelectedIndex((i) => Math.max(0, i - 1));
        return;
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        const item = items[selectedIndex];
        if (item) activateItem(item);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, selectedIndex]);

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={[styles.dialog, { backgroundColor: theme.surface }]} onPress={(e) => e.stopPropagation()}>
          <TextInput
            autoFocus
            value={query}
            onChangeText={setQuery}
            // Repli clavier natif (mobile, pas d'écouteur `window`) — active
            // l'élément actuellement sélectionné, même comportement
            // qu'Entrée sur desktop.
            onSubmitEditing={() => {
              const item = items[selectedIndex];
              if (item) activateItem(item);
            }}
            placeholder="Tapez une commande ou recherchez…"
            placeholderTextColor={theme.textMuted}
            style={[styles.input, { color: theme.text, borderColor: theme.border }]}
          />

          <ScrollView style={styles.resultsList}>
            {filteredActions.map((action, index) => {
              const isSelected = index === selectedIndex;
              return (
                <Pressable
                  key={action.id}
                  onPress={() => activateItem({ type: 'action', action })}
                  style={[
                    styles.result,
                    { borderColor: theme.border },
                    isSelected && { backgroundColor: `${theme.accent}22` },
                  ]}
                >
                  <Text style={styles.resultIcon}>{action.icon}</Text>
                  <Text style={{ color: theme.text, flex: 1 }}>{action.label}</Text>
                </Pressable>
              );
            })}

            {loading && (
              <View style={styles.statusRow}>
                <ActivityIndicator size="small" color={theme.accent} />
                <Text style={{ color: theme.textMuted }}>Recherche…</Text>
              </View>
            )}

            {!loading &&
              searchResults.map((result, resultIndex) => {
                const index = filteredActions.length + resultIndex;
                const isSelected = index === selectedIndex;
                return (
                  <Pressable
                    key={searchResultKey(result)}
                    onPress={() => activateItem({ type: 'result', result })}
                    style={[
                      styles.result,
                      { borderColor: theme.border },
                      isSelected && { backgroundColor: `${theme.accent}22` },
                    ]}
                  >
                    <Text style={styles.resultIcon}>{SEARCH_RESULT_ICON[result.kind]}</Text>
                    <View style={styles.resultBody}>
                      <Text style={{ color: theme.text }} numberOfLines={1}>
                        {result.name}
                      </Text>
                      {result.snippet && (
                        <Text style={[styles.snippet, { color: theme.textMuted }]} numberOfLines={1}>
                          {result.snippet}
                        </Text>
                      )}
                    </View>
                    <Text style={[styles.matchType, { color: theme.textMuted }]}>
                      {SEARCH_MATCH_LABEL[result.matchType]}
                    </Text>
                  </Pressable>
                );
              })}

            {!loading && hasQuery && items.length === 0 && (
              <Text style={[styles.muted, { color: theme.textMuted }]}>Aucun résultat.</Text>
            )}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dialog: {
    width: 480,
    maxHeight: 480,
    borderRadius: 12,
    padding: 16,
    gap: 10,
  },
  input: {
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    fontSize: 15,
  },
  resultsList: {
    maxHeight: 380,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 8,
  },
  muted: {
    fontSize: 13,
    padding: 8,
  },
  result: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
    paddingHorizontal: 8,
    borderRadius: 6,
  },
  resultIcon: {
    fontSize: 16,
  },
  resultBody: {
    flex: 1,
  },
  snippet: {
    fontSize: 12,
    marginTop: 2,
  },
  matchType: {
    fontSize: 11,
  },
});
