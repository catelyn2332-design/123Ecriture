// Fonctions pures sur l'arborescence du vault — séparées des composants
// pour rester testables sans RN, comme lib/mdxFormatting.ts.
//
// //1. Recherche — findNodeByPath, getParentRelPath, getAncestorRelPaths.
// //2. Listes dérivées — flattenNotes, getChildrenAt.
// //3. Dossiers destination — collectFolderOptions (voir MoveDialog.tsx).
// //4. Chemins (fichiers + dossiers) — collectPathOptions.
// //5. Multi-sélection — flattenVisibleNotes (voir NotesScreen.tsx).

// //1. 🔎 RECHERCHE
// ////////////////////////////////////////////////////////////////////////

// Retrouve un nœud (note ou dossier) par son relPath, en profondeur.
// Utilisé par NotesScreen pour retrouver l'élément visé par un clic droit
// délégué (voir components/NotesScreen.tsx) à partir du data-relpath lu
// dans le DOM.
export function findNodeByPath(nodes: VaultTreeNode[], relPath: string): VaultTreeNode | null {
  for (const node of nodes) {
    if (node.relPath === relPath) return node;
    if (node.type === 'folder') {
      const found = findNodeByPath(node.children, relPath);
      if (found) return found;
    }
  }
  return null;
}

// Chemin du dossier parent d'un relPath, ou undefined si l'élément est déjà
// à la racine du vault. Utilisé par le glisser-déposer (NotesScreen.tsx)
// pour résoudre "on a lâché sur une NOTE" → destination = le dossier qui la
// contient, pas la note elle-même (une note n'est pas un dossier valide).
export function getParentRelPath(relPath: string): string | undefined {
  const idx = relPath.lastIndexOf('/');
  return idx === -1 ? undefined : relPath.slice(0, idx);
}

// TOUS les dossiers ancêtres d'un relPath (du plus proche au plus
// éloigné), racine exclue — utilisé par NotesScreen.tsx pour déplier
// automatiquement le chemin menant à la note active (voir l'effet dédié),
// quelle que soit la façon dont elle a été ouverte (clic, lien interne,
// "fichier ouvert par défaut"...).
export function getAncestorRelPaths(relPath: string): string[] {
  const ancestors: string[] = [];
  let current = getParentRelPath(relPath);
  while (current) {
    ancestors.push(current);
    current = getParentRelPath(current);
  }
  return ancestors;
}

// //2. 📋 LISTES DÉRIVÉES
// ////////////////////////////////////////////////////////////////////////

// Liste plate de toutes les NOTES de l'arborescence (pas les dossiers) —
// utilisé par CanvasEditor.tsx pour proposer un choix de note à référencer
// dans une carte.
export function flattenNotes(nodes: VaultTreeNode[]): VaultNoteNode[] {
  const notes: VaultNoteNode[] = [];
  for (const node of nodes) {
    if (node.type === 'note') {
      notes.push(node);
    } else {
      notes.push(...flattenNotes(node.children));
    }
  }
  return notes;
}

// Liste des enfants (nœuds frères) au niveau `parentRelPath` — la racine du
// vault si omis. Utilisé par le glisser-pour-réordonner (NotesScreen.tsx)
// pour retrouver l'ensemble des frères de l'élément glissé.
export function getChildrenAt(tree: VaultTreeNode[], parentRelPath: string | undefined): VaultTreeNode[] {
  if (parentRelPath === undefined) return tree;
  const parent = findNodeByPath(tree, parentRelPath);
  return parent && parent.type === 'folder' ? parent.children : [];
}

// //3. 📁 DOSSIERS DESTINATION
// ////////////////////////////////////////////////////////////////////////

export type FolderOption = { relPath: string; label: string; depth: number };

// Liste plate de tous les dossiers de l'arborescence (avec leur profondeur,
// pour l'indentation visuelle) — utilisé par MoveDialog pour proposer des
// destinations. `excludeRelPath` retire le dossier qu'on est en train de
// déplacer ET tous ses descendants : on ne peut pas déplacer un dossier
// dans lui-même ou dans l'un de ses propres sous-dossiers.
export function collectFolderOptions(
  nodes: VaultTreeNode[],
  excludeRelPath?: string,
  depth = 0,
  options: FolderOption[] = [],
): FolderOption[] {
  for (const node of nodes) {
    if (node.type !== 'folder') continue;
    const isExcluded =
      excludeRelPath !== undefined &&
      (node.relPath === excludeRelPath || node.relPath.startsWith(`${excludeRelPath}/`));
    if (isExcluded) continue;

    options.push({ relPath: node.relPath, label: node.name, depth });
    collectFolderOptions(node.children, excludeRelPath, depth + 1, options);
  }
  return options;
}

// //4. 🗺️ CHEMINS (fichiers + dossiers)
// ////////////////////////////////////////////////////////////////////////

export type PathOption = { relPath: string; label: string; depth: number; kind: 'folder' | 'note' };

// Liste plate de TOUS les nœuds (dossiers ET notes), pour la mini page de
// navigation du type de propriété "Chemin" (voir PropertyValueField.tsx) —
// contrairement à collectFolderOptions, ne filtre rien : on peut y choisir
// aussi bien un dossier qu'un fichier.
export function collectPathOptions(nodes: VaultTreeNode[], depth = 0, options: PathOption[] = []): PathOption[] {
  for (const node of nodes) {
    if (node.type === 'folder') {
      options.push({ relPath: node.relPath, label: node.name, depth, kind: 'folder' });
      collectPathOptions(node.children, depth + 1, options);
    } else {
      options.push({ relPath: node.relPath, label: node.name, depth, kind: 'note' });
    }
  }
  return options;
}

// //5. 🖱️ MULTI-SÉLECTION
// ////////////////////////////////////////////////////////////////////////

// Liste plate des NOTES actuellement VISIBLES dans l'explorateur, dans
// l'ordre d'affichage réel (comme walkTree côté main process : dossiers
// d'abord puis notes, à chaque niveau) — les descendants d'un dossier
// REPLIÉ sont exclus. Utilisé par le Shift+clic de la multi-sélection (voir
// NotesScreen.tsx, `handleRowPress`) pour étendre la sélection entre le
// dernier élément cliqué et la ligne cliquée : l'étendue doit suivre ce que
// l'utilisatrice VOIT à l'écran, pas l'ordre "brut" de l'arbre en mémoire
// (qui contient aussi les enfants, invisibles, d'un dossier replié).
export function flattenVisibleNotes(nodes: VaultTreeNode[], collapsedPaths: Set<string>): VaultNoteNode[] {
  const notes: VaultNoteNode[] = [];
  for (const node of nodes) {
    if (node.type === 'note') {
      notes.push(node);
    } else if (!collapsedPaths.has(node.relPath)) {
      notes.push(...flattenVisibleNotes(node.children, collapsedPaths));
    }
  }
  return notes;
}
