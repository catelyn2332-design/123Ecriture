import { Modal, Pressable, ScrollView, StyleSheet, Text } from 'react-native';

import { collectFolderOptions } from '../lib/vaultTree';
import type { Theme } from '../theme';

// Boîte de dialogue "Déplacer vers…" — une liste de dossiers plutôt que du
// glisser-déposer : plus simple et plus fiable à vérifier sans navigateur
// réel sous la main. Le glisser-déposer reste possible plus tard si
// vraiment souhaité.
type Props = {
  node: VaultTreeNode | null;
  tree: VaultTreeNode[];
  theme: Theme;
  onSelect: (destinationRelPath?: string) => void;
  onCancel: () => void;
  // Mode multi-sélection (voir NotesScreen.tsx, barre d'actions groupées
  // "Déplacer…") : pas de nœud UNIQUE à exclure des destinations ni de
  // "dossier déjà là" à désactiver — chaque élément sélectionné peut avoir
  // un parent différent. `multiCount` (nombre d'éléments) pilote juste le
  // titre et le fait de rester monté sans `node`.
  multiCount?: number;
};

export function MoveDialog({ node, tree, theme, onSelect, onCancel, multiCount }: Props) {
  if (!node && !multiCount) return null;
  const options = collectFolderOptions(tree, node?.type === 'folder' ? node.relPath : undefined);
  // En mode multi-sélection (`node` absent), aucune destination n'est
  // présumée "déjà là" : contrairement au mode simple, on ne connaît pas de
  // parent unique à exclure.
  const currentParent =
    node && node.relPath.includes('/') ? node.relPath.slice(0, node.relPath.lastIndexOf('/')) : undefined;
  const rootDisabled = node ? currentParent === undefined : false;
  const title = node ? `Déplacer « ${node.name} » vers…` : `Déplacer ${multiCount} éléments vers…`;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onCancel}>
      <Pressable style={styles.backdrop} onPress={onCancel}>
        <Pressable style={[styles.dialog, { backgroundColor: theme.surface }]} onPress={(e) => e.stopPropagation()}>
          <Text style={[styles.title, { color: theme.text }]}>{title}</Text>
          <ScrollView style={styles.optionsList}>
            <Pressable
              onPress={() => onSelect(undefined)}
              disabled={rootDisabled}
              style={[styles.option, rootDisabled && styles.optionDisabled]}
            >
              <Text style={{ color: theme.text }}>🗄️ Racine du vault</Text>
            </Pressable>
            {options.map((option) => (
              <Pressable
                key={option.relPath}
                onPress={() => onSelect(option.relPath)}
                disabled={option.relPath === currentParent}
                style={[
                  styles.option,
                  { paddingLeft: 16 + option.depth * 16 },
                  option.relPath === currentParent && styles.optionDisabled,
                ]}
              >
                <Text style={{ color: theme.text }}>📁 {option.label}</Text>
              </Pressable>
            ))}
            {options.length === 0 && (
              <Text style={[styles.muted, { color: theme.textMuted }]}>
                Aucun autre dossier dans le vault.
              </Text>
            )}
          </ScrollView>
          <Pressable onPress={onCancel} style={styles.cancelButton}>
            <Text style={{ color: theme.textMuted }}>Annuler</Text>
          </Pressable>
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
    width: 320,
    maxHeight: 400,
    borderRadius: 12,
    padding: 16,
    gap: 12,
  },
  title: {
    fontSize: 15,
    fontWeight: '600',
  },
  optionsList: {
    maxHeight: 260,
  },
  option: {
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 6,
  },
  optionDisabled: {
    opacity: 0.35,
  },
  muted: {
    fontSize: 13,
    padding: 8,
  },
  cancelButton: {
    alignSelf: 'flex-end',
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
});
