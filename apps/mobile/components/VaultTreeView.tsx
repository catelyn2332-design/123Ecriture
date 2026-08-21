import { Fragment, type ComponentProps, type ComponentType } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import type { Theme } from '../theme';

// `draggable` n'est pas dans les types RN officiels de Pressable (ce n'est
// pas une prop React Native — voir le commentaire plus bas sur
// `onContextMenu`), mais react-native-web la transmet bel et bien telle
// quelle jusqu'au <div> sous-jacent, ce qui est justement ce qui rend le
// glisser-déposer HTML5 délégué (voir NotesScreen.tsx) possible sans
// handler par ligne. Échappatoire de typage locale et explicite plutôt que
// de parsemer des `as any` dans le JSX plus bas. Exportée : réutilisée telle
// quelle par CanvasEditor.tsx pour les mêmes raisons (cartes/poignées de
// connexion glissables).
// //1. 🖱️ DRAGGABLEPRESSABLE
// ////////////////////////////////////////////////////////////////////////

export const DraggablePressable = Pressable as unknown as ComponentType<
  ComponentProps<typeof Pressable> & { draggable?: boolean }
>;

// Rendu récursif de l'arborescence du vault (dossiers + notes). Composant
// purement présentationnel : toutes les données (arbre, sélection en cours,
// dossiers repliés, état de renommage) et les actions vivent dans
// NotesScreen — ce fichier ne fait qu'afficher et relayer les événements,
// pour ne pas éparpiller la logique métier vault entre deux fichiers.
//
// //1. DraggablePressable — échappatoire de typage pour `draggable`.
// //2. Props/rendu — une ligne par nœud (icône, nom, lignes de profondeur,
//      indices de glisser-déposer), récursif sur les enfants d'un dossier.
// //3. Styles.
//
// Le clic droit n'est PAS géré ici : chaque ligne porte juste un
// `dataSet={{ relpath: ... }}` (converti en attribut data-relpath par
// react-native-web), et c'est NotesScreen qui écoute un seul événement
// "contextmenu" délégué sur tout le conteneur puis retrouve la ligne visée
// via cet attribut. Passer `onContextMenu` directement à Pressable ne
// fonctionnait pas de façon fiable (ce n'est pas une prop RN officielle,
// juste transmise "si ça marche" par react-native-web) — la délégation sur
// un seul écouteur, déjà éprouvée pour le clic droit dans le vide, est un
// mécanisme bien plus robuste.

// Icône par `kind` de fichier (voir EXTENSION_TO_KIND dans
// apps/desktop/electron/vault.js) — distingue une note MDX d'un canvas ou
// d'un graphique dans l'arborescence. Exportée : réutilisée telle quelle par
// NotesScreen.tsx pour la section "⭐ Favoris" (mêmes icônes, pas de rendu
// dupliqué à maintenir en double).
export const NOTE_ICON_BY_KIND: Record<VaultEntryKind, string> = {
  markdown: '📝',
  canvas: '🎨',
  chart: '📊',
  excalidraw: '🖍️',
};

export type RenameState = {
  relPath: string;
  value: string;
  onChangeValue: (value: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
};

type Props = {
  nodes: VaultTreeNode[];
  depth?: number;
  theme: Theme;
  activeRelPath?: string;
  collapsedPaths: Set<string>;
  onToggleCollapse: (relPath: string) => void;
  // Reçoit aussi les touches de modification (Ctrl/Cmd/Shift) du clic —
  // voir NotesScreen.tsx, `handleRowPress` : Ctrl/Cmd bascule la ligne dans
  // la multi-sélection SANS ouvrir la note, Shift étend la sélection depuis
  // le dernier élément cliqué, un clic simple ouvre normalement. Lu depuis
  // `event.nativeEvent` — sur web, la vraie MouseEvent du clic (voir
  // PressResponder.onClick de react-native-web, qui le documente comme
  // volontairement "pas un TouchEvent" contrairement au reste du système de
  // responder).
  onOpenNote: (node: VaultNoteNode, modifiers: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }) => void;
  rename: RenameState | null;
  // Lignes actuellement en multi-sélection (voir NotesScreen.tsx) — teintée
  // comme les autres états de l'arbre (glisser, cible de dépôt), `Set`
  // plutôt que tableau pour un test d'appartenance en O(1) à chaque ligne.
  selectedRelPaths?: Set<string>;
  // Glisser pour RÉORDONNER (voir NotesScreen.tsx, qui délègue les
  // évènements DOM dragstart/dragover/drop sur le conteneur plutôt que par
  // ligne — même raison que le clic droit délégué : passer onDragStart/
  // onDragOver directement en props Pressable n'est pas fiable via
  // react-native-web). Ce composant reste purement présentationnel : juste
  // `draggable` + le trait d'insertion, aucune logique ici.
  draggingRelPath?: string | null;
  // 'above'/'below' : trait fin entre deux lignes FRÈRES (réordonner).
  // 'inside' : la ligne ENTIÈRE (forcément un dossier) se teinte de la
  // couleur d'accent — déposer ici déplace DANS ce dossier plutôt que de
  // réordonner (voir NotesScreen.tsx, `resolveInsertion`/`handleDrop`).
  dragOverInsertion?: { relPath: string; edge: 'above' | 'below' | 'inside' } | null;
  // Toujours activé par défaut : glisser un fichier bascule maintenant
  // lui-même Paramètres → Gestion des fichiers et des liens → "Ordre des
  // fichiers" sur 'manual' dès qu'un dépôt aboutit (voir NotesScreen.tsx,
  // `handleDrop`) plutôt que d'exiger ce réglage AU PRÉALABLE — glisser ne
  // faisait sinon rigoureusement rien de visible tant qu'on n'était pas
  // déjà en mode manuel. Piloté uniquement pour le curseur ici (indice
  // visuel) — l'attribut HTML `draggable` réel est posé IMPÉRATIVEMENT
  // depuis NotesScreen.tsx (voir son effet dédié) : react-native-web
  // 0.21 ne transmet PAS les props inconnues comme `draggable` jusqu'au
  // DOM pour Pressable/View (seul `Image` le fait nativement, vérifié
  // dans ses sources) — passer `draggable` en prop ici serait un no-op
  // silencieux malgré l'apparence trompeuse. Vrai par défaut pour ne rien
  // casser des usages existants (ex. si un futur appelant omet la prop).
  dragEnabled?: boolean;
};

// //2. 🌳 PROPS/RENDU
// ////////////////////////////////////////////////////////////////////////

export function VaultTreeView({
  nodes,
  depth = 0,
  theme,
  activeRelPath,
  collapsedPaths,
  onToggleCollapse,
  onOpenNote,
  rename,
  selectedRelPaths,
  draggingRelPath,
  dragOverInsertion,
  dragEnabled = true,
}: Props) {
  return (
    <>
      {nodes.map((node) => {
        const isRenaming = rename?.relPath === node.relPath;
        const isFolder = node.type === 'folder';
        const isCollapsed = isFolder && collapsedPaths.has(node.relPath);
        const isDragging = draggingRelPath === node.relPath;
        const insertionEdge = dragOverInsertion?.relPath === node.relPath ? dragOverInsertion.edge : null;
        const isDropInsideTarget = insertionEdge === 'inside';
        const isSelected = !isFolder && (selectedRelPaths?.has(node.relPath) ?? false);

        return (
          <Fragment key={node.relPath}>
            {insertionEdge === 'above' && (
              <View style={[styles.insertionLine, { paddingLeft: 12 + depth * 16 }]}>
                <View style={[styles.insertionLineBar, { backgroundColor: theme.accent }]} />
              </View>
            )}
            <DraggablePressable
              onPress={(event) => {
                if (isFolder) {
                  onToggleCollapse(node.relPath);
                  return;
                }
                // `nativeEvent` est ici la vraie MouseEvent du clic (voir le
                // commentaire de la prop `onOpenNote` ci-dessus) — cast
                // explicite plutôt qu'un `as any` épars, même échappatoire
                // de typage que `DraggablePressable` en haut de ce fichier.
                const native = event.nativeEvent as unknown as {
                  ctrlKey?: boolean;
                  metaKey?: boolean;
                  shiftKey?: boolean;
                };
                onOpenNote(node, {
                  ctrlKey: native.ctrlKey === true,
                  metaKey: native.metaKey === true,
                  shiftKey: native.shiftKey === true,
                });
              }}
              dataSet={{ relpath: node.relPath }}
              style={[
                styles.row,
                !isFolder &&
                  node.relPath === activeRelPath && { backgroundColor: `${theme.accent}22` },
                !isRenaming && dragEnabled && styles.rowDraggable,
                isDragging && styles.rowDragging,
                isDropInsideTarget && { backgroundColor: `${theme.accent}33`, borderRadius: 6 },
                isSelected && { backgroundColor: `${theme.accent}33` },
              ]}
            >
              {/* Lignes de profondeur — une par ancêtre, pour se repérer
                  dans une arborescence imbriquée sans compter les niveaux
                  d'indentation à l'œil. `alignSelf:'stretch'` reprend la
                  hauteur de CETTE ligne (toutes identiques, `numberOfLines`
                  sur le nom) : empilées, plusieurs lignes consécutives à la
                  même profondeur donnent l'illusion d'un trait continu —
                  pas de vrai suivi de branche (une ligne s'arrête même si
                  ce n'est pas le dernier enfant du dossier), volontairement
                  simple pour une première version. */}
              {Array.from({ length: depth }).map((_, i) => (
                <View key={i} style={styles.indentGuideCell}>
                  <View style={[styles.indentGuideLine, { backgroundColor: theme.border }]} />
                </View>
              ))}
              <Text style={styles.icon}>
                {node.type === 'folder' ? (isCollapsed ? '📁' : '📂') : NOTE_ICON_BY_KIND[node.kind]}
              </Text>
              {isRenaming ? (
                <TextInput
                  autoFocus
                  value={rename.value}
                  onChangeText={rename.onChangeValue}
                  onSubmitEditing={rename.onSubmit}
                  onBlur={rename.onSubmit}
                  onKeyPress={(event) => {
                    if (event.nativeEvent.key === 'Escape') rename.onCancel();
                  }}
                  style={[styles.renameInput, { color: theme.text, borderColor: theme.accent }]}
                />
              ) : (
                <Text style={{ color: theme.text }} numberOfLines={1}>
                  {node.name}
                </Text>
              )}
            </DraggablePressable>
            {insertionEdge === 'below' && (
              <View style={[styles.insertionLine, { paddingLeft: 12 + depth * 16 }]}>
                <View style={[styles.insertionLineBar, { backgroundColor: theme.accent }]} />
              </View>
            )}
            {isFolder && !isCollapsed && (
              <VaultTreeView
                nodes={node.children}
                depth={depth + 1}
                theme={theme}
                activeRelPath={activeRelPath}
                collapsedPaths={collapsedPaths}
                onToggleCollapse={onToggleCollapse}
                onOpenNote={onOpenNote}
                rename={rename}
                selectedRelPaths={selectedRelPaths}
                draggingRelPath={draggingRelPath}
                dragOverInsertion={dragOverInsertion}
                dragEnabled={dragEnabled}
              />
            )}
          </Fragment>
        );
      })}
    </>
  );
}

// //3. 🎨 STYLES
// ////////////////////////////////////////////////////////////////////////

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
    paddingLeft: 12,
    paddingRight: 12,
  },
  icon: {
    fontSize: 14,
  },
  // Largeur (16px) alignée sur le pas d'indentation d'origine
  // (`12 + depth * 16`, voir `insertionLine` plus bas, qui doit rester
  // visuellement aligné) — le trait est centré dedans plutôt que collé à
  // un bord, pour rester lisible même serré contre l'icône du niveau
  // suivant.
  indentGuideCell: {
    width: 16,
    alignSelf: 'stretch',
    alignItems: 'center',
  },
  indentGuideLine: {
    width: 1,
    flex: 1,
  },
  rowDragging: {
    opacity: 0.4,
  },
  // Simple indice visuel (RN Web transmet `cursor` tel quel) — l'attribut
  // HTML `draggable` réel est posé depuis NotesScreen.tsx, voir le
  // commentaire de `dragEnabled` ci-dessus.
  rowDraggable: {
    // Le type RN `CursorValue` n'admet que 'auto'/'pointer' — pas de
    // valeur "grab" disponible, 'pointer' reste le meilleur indice de
    // survol disponible dans ce typage.
    cursor: 'pointer',
  },
  // Hauteur 0 volontaire : le trait (insertionLineBar, en enfant) se
  // dessine par-dessus l'espacement entre deux lignes sans en changer la
  // hauteur — sinon la liste "sauterait" visuellement à chaque position
  // survolée pendant le glisser.
  insertionLine: {
    height: 0,
    paddingRight: 12,
    justifyContent: 'center',
  },
  insertionLineBar: {
    height: 2,
    borderRadius: 1,
  },
  renameInput: {
    flex: 1,
    borderBottomWidth: 1,
    paddingVertical: 2,
    fontSize: 14,
  },
});
