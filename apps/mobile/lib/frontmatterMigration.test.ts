import { describe, expect, it } from 'vitest';

import { parseFrontmatter } from './frontmatter';
import { migrateFrontmatterKey } from './frontmatterMigration';

// Voir apps/desktop/electron/properties.ts (`properties:update`) — cette
// fonction pilote la migration réelle du frontmatter de chaque note quand
// une propriété est renommée dans le schéma. Zone "sauvegarde et gestion
// des données" (CLAUDE.md) : couverture volontairement large, y compris
// les cas où on NE DOIT RIEN toucher.

describe('migrateFrontmatterKey', () => {
  it('ne change rien si la clé absente est absente du frontmatter', () => {
    const content = '---\ntitre: Ma note\n---\n\nCorps.';
    const result = migrateFrontmatterKey(content, 'statut', 'etat');
    expect(result).toEqual({ content, changed: false, skipped: false });
  });

  it('migre la clé quand elle est présente et que la nouvelle est libre', () => {
    const content = '---\nstatut: En cours\ntitre: Ma note\n---\n\nCorps.';
    const result = migrateFrontmatterKey(content, 'statut', 'etat');
    expect(result.changed).toBe(true);
    expect(result.skipped).toBe(false);
    expect(result.content).toBe('---\netat: En cours\ntitre: Ma note\n---\n\nCorps.');
  });

  it('ignore la note (contenu intact) si la nouvelle clé existe déjà avec sa propre valeur', () => {
    const content = '---\nstatut: En cours\netat: Terminé\n---\n\nCorps.';
    const result = migrateFrontmatterKey(content, 'statut', 'etat');
    expect(result).toEqual({ content, changed: false, skipped: true });
  });

  it('préserve tout le reste du frontmatter et le corps de la note lors de la migration', () => {
    const content = '---\nstatut: En cours\npriorite: 3\ntags:\n  - a\n  - b\n---\n\nLe corps ne doit pas bouger.';
    const result = migrateFrontmatterKey(content, 'statut', 'etat');
    const { data, body } = parseFrontmatter(result.content);
    expect(data).toEqual({ etat: 'En cours', priorite: 3, tags: ['a', 'b'] });
    expect(body).toBe('Le corps ne doit pas bouger.');
  });

  it('ne plante pas sur un frontmatter absent — rien à migrer', () => {
    const content = 'Juste du texte, pas de propriétés.';
    const result = migrateFrontmatterKey(content, 'statut', 'etat');
    expect(result).toEqual({ content, changed: false, skipped: false });
  });

  it('ne plante pas sur un frontmatter invalide (YAML mal formé) — traité comme absent', () => {
    const content = '---\n: : mal formé : :\n---\n\nCorps.';
    const result = migrateFrontmatterKey(content, 'statut', 'etat');
    expect(result).toEqual({ content, changed: false, skipped: false });
  });
});
