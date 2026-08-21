import { describe, expect, it } from 'vitest';

import { flattenVisibleNotes, getAncestorRelPaths, getParentRelPath } from './vaultTree';

describe('getParentRelPath', () => {
  it('renvoie undefined à la racine', () => {
    expect(getParentRelPath('Note.mdx')).toBeUndefined();
  });

  it('renvoie le dossier parent direct', () => {
    expect(getParentRelPath('Dossier/SousDossier/Note.mdx')).toBe('Dossier/SousDossier');
  });
});

describe('getAncestorRelPaths', () => {
  it('vide à la racine', () => {
    expect(getAncestorRelPaths('Note.mdx')).toEqual([]);
  });

  it('liste tous les ancêtres, du plus proche au plus éloigné', () => {
    expect(getAncestorRelPaths('Dossier/SousDossier/Note.mdx')).toEqual(['Dossier/SousDossier', 'Dossier']);
  });
});

describe('flattenVisibleNotes', () => {
  const tree: VaultTreeNode[] = [
    {
      type: 'note',
      relPath: 'A.mdx',
      name: 'A',
      modifiedAt: 0,
      kind: 'markdown',
    },
    {
      type: 'folder',
      relPath: 'Dossier',
      name: 'Dossier',
      children: [
        {
          type: 'note',
          relPath: 'Dossier/B.mdx',
          name: 'B',
          modifiedAt: 0,
          kind: 'markdown',
        },
      ],
    },
    {
      type: 'note',
      relPath: 'C.mdx',
      name: 'C',
      modifiedAt: 0,
      kind: 'markdown',
    },
  ];

  it('inclut les notes des dossiers dépliés, dans l’ordre d’affichage', () => {
    expect(flattenVisibleNotes(tree, new Set()).map((n) => n.relPath)).toEqual(['A.mdx', 'Dossier/B.mdx', 'C.mdx']);
  });

  it('exclut les notes des dossiers repliés', () => {
    expect(flattenVisibleNotes(tree, new Set(['Dossier'])).map((n) => n.relPath)).toEqual(['A.mdx', 'C.mdx']);
  });
});
