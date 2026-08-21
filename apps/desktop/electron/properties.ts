import { ipcMain } from 'electron';
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import crypto from 'crypto';

import * as vaults from './vaults';
import type { PropertyDefinition, PropertyPatch, PropertyRenameMigrationSummary, PropertyType } from './types';
// Fonction pure de migration de clé de frontmatter — voir
// apps/mobile/lib/frontmatterMigration.ts (testée par Vitest côté
// apps/mobile, aucun équivalent Electron-only à maintenir). Contrairement à
// search.ts (qui duplique un mini-parseur frontmatter en lecture seule),
// cette migration RÉÉCRIT des notes existantes — zone "sauvegarde et
// gestion des données" (CLAUDE.md) : une seule implémentation testée,
// importée telle quelle plutôt que dupliquée, esbuild la bundle sans
// problème (vérifié) même si apps/mobile et apps/desktop restent deux
// paquets séparés.
import { migrateFrontmatterKey } from '../../mobile/lib/frontmatterMigration';

// Module "Propriétés" (voir docs/ARCHITECTURE.md §4/§8, panneau
// PropertiesPanel.tsx dans la barre latérale) : schéma global de
// propriétés typées, DANS le vault (comme tasks.js/calendar.js — contenu
// utilisateur, pas un réglage app-level). Un seul fichier PLAT
// `.123ecriture/properties.json` — contrairement à tasklists.json, il n'y a
// qu'UN schéma par coffre, pas une notion de "plusieurs schémas actifs".
//
// Ce fichier ne porte QUE la définition (nom + type) de chaque propriété —
// les VALEURS, elles, vivent dans le frontmatter YAML de chaque note (voir
// apps/mobile/lib/frontmatter.ts), pas ici.
//
// RENOMMER une propriété (properties:update avec `name`) migre en plus la
// CLÉ de frontmatter dans toutes les notes du coffre qui la portent (voir
// migrateRenamedPropertyInVault plus bas) — sans quoi la valeur déjà écrite
// deviendrait orpheline du point de vue de l'UI (qui lit désormais le
// nouveau nom). Changer le TYPE ou supprimer une propriété, en revanche, ne
// touche toujours JAMAIS les notes déjà écrites : ça ne modifie que ce
// registre, une valeur devient "orpheline" (plus rattachée à aucune
// définition du schéma) mais reste intacte dans la note — choix assumé pour
// rester simple, cohérent avec le reste de l'app qui ne fait jamais de
// migration silencieuse de contenu EN DEHORS de ce cas précis du renommage
// (demande explicite de l'utilisatrice : une propriété renommée doit rester
// utilisable sur les notes qui l'utilisaient déjà).
const PROPERTY_TYPES: PropertyType[] = [
  'text',
  'list',
  'number',
  'checkbox',
  'date',
  'datetime',
  'path',
  'options',
];

function getVaultPath(): string | null {
  return vaults.getActiveVaultPath();
}

function getPropertiesFilePath(vaultPath: string): string {
  return path.join(vaultPath, '.123ecriture', 'properties.json');
}

function readProperties(vaultPath: string): PropertyDefinition[] {
  try {
    return JSON.parse(fsSync.readFileSync(getPropertiesFilePath(vaultPath), 'utf8')) as PropertyDefinition[];
  } catch {
    return [];
  }
}

async function writeProperties(vaultPath: string, properties: PropertyDefinition[]): Promise<PropertyDefinition[]> {
  const filePath = getPropertiesFilePath(vaultPath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(properties, null, 2), 'utf8');
  return properties;
}

function isPropertyType(value: unknown): value is PropertyType {
  return typeof value === 'string' && (PROPERTY_TYPES as string[]).includes(value);
}

// Type 'options' uniquement — normalise en tableau de chaînes non vides,
// trim(). `undefined` reste `undefined` (pas de champ `options` à écrire du
// tout pour les autres types), une liste vide devient `[]` (pas d'options
// configurées pour l'instant, pas une erreur).
function normalizeOptions(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error('La liste d’options est invalide.');
  return value.map((item) => String(item).trim()).filter((item) => item.length > 0);
}

// Parcourt tout le coffre à la recherche des notes `.mdx`/`.md` — même
// convention locale que walkMdxFiles (occurrences.ts) et walkAll
// (search.ts) : chaque module qui a besoin de parcourir le vault a son
// propre petit walker plutôt qu'une dépendance vers vault.ts (dont
// `walkTree` n'est de toute façon pas exporté). Étendu aux DEUX extensions
// de note (contrairement à walkMdxFiles, `.mdx` seulement) : une note
// importée en `.md` peut tout aussi bien porter la propriété renommée.
async function walkNoteFiles(dir: string, out: string[] = []): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walkNoteFiles(fullPath, out);
    } else if (entry.isFile() && (entry.name.endsWith('.mdx') || entry.name.endsWith('.md'))) {
      out.push(fullPath);
    }
  }
  return out;
}

// Migre la clé de frontmatter `oldName` → `newName` dans toutes les notes du
// coffre, appelée UNIQUEMENT après le succès de l'écriture du schéma (voir
// properties:update ci-dessous) — jamais de notes migrées à moitié pour un
// renommage de schéma qui aurait échoué. Continue sur erreur fichier par
// fichier (lecture/écriture) plutôt que d'interrompre toute la migration :
// un fichier verrouillé/supprimé entre le listage et l'accès ne doit jamais
// faire perdre la migration des autres notes (CLAUDE.md, "sauvegarde et
// gestion des données"). La logique de décision (migrer/ignorer) elle-même
// est déléguée à `migrateFrontmatterKey`, pure et testée côté
// apps/mobile/lib.
async function migrateRenamedPropertyInVault(
  vaultPath: string,
  oldName: string,
  newName: string,
): Promise<PropertyRenameMigrationSummary> {
  const summary: PropertyRenameMigrationSummary = { migratedCount: 0, skippedCount: 0, errorCount: 0 };
  const files = await walkNoteFiles(vaultPath);

  for (const fullPath of files) {
    try {
      const content = await fs.readFile(fullPath, 'utf8');
      const result = migrateFrontmatterKey(content, oldName, newName);
      if (result.skipped) {
        summary.skippedCount += 1;
        continue;
      }
      if (!result.changed) continue;
      await fs.writeFile(fullPath, result.content, 'utf8');
      summary.migratedCount += 1;
    } catch (err) {
      // Log-et-continue : une note en échec ne doit jamais interrompre la
      // migration des suivantes, voir le commentaire de la fonction.
      console.error(`[properties] échec de la migration du frontmatter pour "${fullPath}" :`, err);
      summary.errorCount += 1;
    }
  }

  return summary;
}

export function registerPropertiesHandlers(): void {
  ipcMain.handle('properties:list', () => {
    const vaultPath = getVaultPath();
    if (!vaultPath) return [];
    return readProperties(vaultPath);
  });

  ipcMain.handle('properties:create', async (_event, name: string, type: unknown, options?: unknown) => {
    const vaultPath = getVaultPath();
    if (!vaultPath) throw new Error('Aucun vault sélectionné');
    const trimmed = (name ?? '').trim();
    if (!trimmed) throw new Error('Le nom de la propriété ne peut pas être vide.');
    if (!isPropertyType(type)) throw new Error('Type de propriété invalide.');

    const properties = readProperties(vaultPath);
    if (properties.some((p) => p.name.toLowerCase() === trimmed.toLowerCase())) {
      throw new Error('Une propriété porte déjà ce nom.');
    }
    const normalizedOptions = normalizeOptions(options);
    properties.push({
      id: crypto.randomUUID(),
      name: trimmed,
      type,
      createdAt: new Date().toISOString(),
      ...(normalizedOptions !== undefined ? { options: normalizedOptions } : {}),
    });
    return writeProperties(vaultPath, properties);
  });

  ipcMain.handle('properties:update', async (_event, id: string, patch: PropertyPatch | undefined) => {
    const vaultPath = getVaultPath();
    if (!vaultPath) throw new Error('Aucun vault sélectionné');
    const properties = readProperties(vaultPath);
    const existing = properties.find((p) => p.id === id);
    if (!existing) throw new Error('Propriété introuvable.');

    // Nom AVANT modification — comparé au nom final ci-dessous pour savoir
    // si une migration de frontmatter est nécessaire (voir plus bas).
    const previousName = existing.name;

    if (patch?.name !== undefined) {
      const trimmed = patch.name.trim();
      if (!trimmed) throw new Error('Le nom de la propriété ne peut pas être vide.');
      if (properties.some((p) => p.id !== id && p.name.toLowerCase() === trimmed.toLowerCase())) {
        throw new Error('Une propriété porte déjà ce nom.');
      }
      existing.name = trimmed;
    }
    if (patch?.type !== undefined) {
      if (!isPropertyType(patch.type)) throw new Error('Type de propriété invalide.');
      existing.type = patch.type;
    }
    if (patch?.options !== undefined) {
      existing.options = normalizeOptions(patch.options);
    }

    // Écrit le SCHÉMA d'abord. La migration des notes ci-dessous ne
    // démarre que si cette écriture a réussi (sinon writeProperties a déjà
    // levé, et la fonction s'est arrêtée avant d'arriver ici) — jamais de
    // notes migrées pour un renommage de schéma qui a échoué.
    const updatedProperties = await writeProperties(vaultPath, properties);

    // Le nom a réellement changé (pas juste un changement de type/options,
    // ni un "renommage" vers le même nom) : migre la clé de frontmatter
    // dans toutes les notes du coffre qui la portent.
    if (existing.name !== previousName) {
      const migration = await migrateRenamedPropertyInVault(vaultPath, previousName, existing.name);
      return { properties: updatedProperties, migration };
    }

    return { properties: updatedProperties };
  });

  ipcMain.handle('properties:remove', async (_event, id: string) => {
    const vaultPath = getVaultPath();
    if (!vaultPath) throw new Error('Aucun vault sélectionné');
    const properties = readProperties(vaultPath).filter((p) => p.id !== id);
    return writeProperties(vaultPath, properties);
  });
}
