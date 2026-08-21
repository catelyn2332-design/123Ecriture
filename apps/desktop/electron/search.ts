import { ipcMain } from 'electron';
import fs from 'fs/promises';
import path from 'path';
import { load } from 'js-yaml';

import { readEvents } from './calendar';
import { getTaskLists, readTasks } from './tasks';
import * as vaults from './vaults';
import type { SearchOptions, SearchResult, SearchResultKind, TagGroup, VaultEntryKind } from './types';

// Module "Recherche globale" (voir .claude/References/Sources.md §2,
// bouton en haut de l'explorateur de fichiers) : parcourt le coffre à la
// demande à chaque requête, comme occurrences.ts (`walkMdxFiles` +
// `findNotesContaining`) — pas d'index précalculé, cohérent avec le reste
// de l'app à cette échelle (coffre personnel, pas un moteur de recherche
// d'entreprise).
//
// Contrairement à walkTree (vault.ts), ce parcours ne filtre PAS par
// EXTENSION_TO_KIND : la recherche doit aussi trouver les pièces jointes et
// les dossiers par leur nom, pas seulement les notes/canvas/graphiques.

const NOTE_EXTENSIONS: Record<string, VaultEntryKind> = {
  '.mdx': 'markdown',
  '.md': 'markdown',
  '.canvas': 'canvas',
  '.chart': 'chart',
  '.excalidraw': 'excalidraw',
};

const SNIPPET_RADIUS = 60;

function getVaultPath(): string | null {
  return vaults.getActiveVaultPath();
}

type WalkedEntry = {
  fullPath: string;
  relPath: string;
  name: string;
  isFolder: boolean;
  kind: SearchResultKind;
};

async function walkAll(dir: string, vaultRoot: string, out: WalkedEntry[] = []): Promise<WalkedEntry[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    // Ignore les fichiers/dossiers cachés (.123ecriture/ config vault,
    // .git...) — même règle que walkTree/walkMdxFiles.
    if (entry.name.startsWith('.')) continue;
    const fullPath = path.join(dir, entry.name);
    const relPath = path.relative(vaultRoot, fullPath);

    if (entry.isDirectory()) {
      out.push({ fullPath, relPath, name: entry.name, isFolder: true, kind: 'folder' });
      await walkAll(fullPath, vaultRoot, out);
    } else if (entry.isFile()) {
      const extension = path.extname(entry.name);
      const noteKind = NOTE_EXTENSIONS[extension];
      if (noteKind) {
        out.push({ fullPath, relPath, name: entry.name.slice(0, -extension.length), isFolder: false, kind: noteKind });
      } else {
        out.push({ fullPath, relPath, name: entry.name, isFolder: false, kind: 'attachment' });
      }
    }
  }
  return out;
}

// Même découpage frontmatter que apps/mobile/lib/frontmatter.ts, dupliqué
// ici (le process principal Electron et le renderer sont deux paquets
// séparés, pas de package partagé aujourd'hui — voir la même convention
// pour walkAndHash/walkMdxFiles dans sync.ts/occurrences.ts).
const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

function parseFrontmatter(content: string): { data: Record<string, unknown>; body: string } {
  const match = FRONTMATTER_PATTERN.exec(content);
  if (!match) return { data: {}, body: content };
  try {
    const parsed: unknown = load(match[1]);
    const data = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
    return { data, body: content.slice(match[0].length).replace(/^\n+/, '') };
  } catch {
    return { data: {}, body: content };
  }
}

// Même règle de limite de mot que TAG_PATTERN dans
// apps/mobile/lib/markdownPlugins.ts (précédé d'un espace/saut de
// ligne/tabulation ou début de texte), reproduite ici en scan global sur
// tout le texte plutôt qu'en règle markdown-it ligne par ligne.
const TAG_PATTERN = /(^|[\s])#([\p{L}\p{N}_-]+)/gu;

function extractTags(text: string): string[] {
  const tags = new Set<string>();
  for (const match of text.matchAll(TAG_PATTERN)) {
    tags.add(match[2].toLowerCase());
  }
  return [...tags];
}

function buildSnippet(text: string, matchIndex: number, matchLength: number): string {
  const start = Math.max(0, matchIndex - SNIPPET_RADIUS);
  const end = Math.min(text.length, matchIndex + matchLength + SNIPPET_RADIUS);
  const prefix = start > 0 ? '…' : '';
  const suffix = end < text.length ? '…' : '';
  return `${prefix}${text.slice(start, end).replace(/\s+/g, ' ').trim()}${suffix}`;
}

// Étend la recherche globale aux TÂCHES (voir electron/tasks.ts) — cherche
// le texte de la tâche ET sa description, un résultat par tâche
// correspondante. `taskId`/`taskListId` (pas de `relPath`, une tâche n'a pas
// de fichier) portent de quoi la rouvrir côté renderer (voir
// lib/searchResults.ts, `openSearchResult`).
function searchTasks(vaultPath: string, needle: string): SearchResult[] {
  // Assure la migration (listId attribué à toute tâche créée avant les
  // listes multiples) avant de lire — sans ça une tâche legacy remonterait
  // sans `taskListId` exploitable pour la rouvrir.
  getTaskLists(vaultPath);
  const results: SearchResult[] = [];

  for (const task of readTasks(vaultPath)) {
    const textIndex = task.text.toLowerCase().indexOf(needle);
    if (textIndex !== -1) {
      results.push({
        relPath: '',
        name: task.text,
        kind: 'task',
        matchType: 'title',
        taskId: task.id,
        taskListId: task.listId,
      });
      continue;
    }

    const description = task.description ?? '';
    const descriptionIndex = description.toLowerCase().indexOf(needle);
    if (descriptionIndex !== -1) {
      results.push({
        relPath: '',
        name: task.text,
        kind: 'task',
        matchType: 'content',
        snippet: buildSnippet(description, descriptionIndex, needle.length),
        taskId: task.id,
        taskListId: task.listId,
      });
    }
  }

  return results;
}

// Étend la recherche globale aux ÉVÈNEMENTS du calendrier (voir
// electron/calendar.ts) — cherche le titre ET les notes de l'évènement.
// `eventDate` (AAAA-MM-JJ) suffit à révéler le bon jour côté renderer
// (CalendarScreen.tsx, `openDay`) ; `eventId` sert surtout de clé de rendu.
function searchCalendarEvents(vaultPath: string, needle: string): SearchResult[] {
  const results: SearchResult[] = [];

  for (const event of readEvents(vaultPath)) {
    const titleIndex = event.title.toLowerCase().indexOf(needle);
    if (titleIndex !== -1) {
      results.push({
        relPath: '',
        name: event.title,
        kind: 'calendar-event',
        matchType: 'title',
        eventId: event.id,
        eventDate: event.date,
      });
      continue;
    }

    const notes = event.notes ?? '';
    const notesIndex = notes.toLowerCase().indexOf(needle);
    if (notesIndex !== -1) {
      results.push({
        relPath: '',
        name: event.title,
        kind: 'calendar-event',
        matchType: 'content',
        snippet: buildSnippet(notes, notesIndex, needle.length),
        eventId: event.id,
        eventDate: event.date,
      });
    }
  }

  return results;
}

async function runSearch(vaultPath: string, query: string, options: SearchOptions | undefined): Promise<SearchResult[]> {
  const trimmedQuery = (query ?? '').trim();
  const propertyId = options?.propertyId;
  // Ni texte ni filtre : pas de "tout lister", la recherche reste vide
  // tant qu'on ne lui demande rien de précis.
  if (!trimmedQuery && !propertyId) return [];

  const needle = trimmedQuery.toLowerCase();
  const entries = await walkAll(vaultPath, vaultPath);
  const results: SearchResult[] = [];

  for (const entry of entries) {
    // Filtre par propriété : ne concerne que les notes (le frontmatter
    // n'existe que là), silencieusement ignoré pour dossiers/pièces
    // jointes/canvas/graphiques plutôt que de les exclure par erreur.
    if (propertyId && entry.kind !== 'markdown') continue;

    let data: Record<string, unknown> = {};
    let body = '';
    let hasReadContent = false;
    const readNoteOnce = async () => {
      if (hasReadContent) return;
      hasReadContent = true;
      try {
        const content = await fs.readFile(entry.fullPath, 'utf8');
        ({ data, body } = parseFrontmatter(content));
      } catch {
        // Fichier illisible entre le listage et la lecture (supprimé,
        // permissions...) — ignoré plutôt que de faire échouer toute la
        // recherche pour un seul fichier.
      }
    };

    if (propertyId) {
      await readNoteOnce();
      const rawValue = data[propertyId];
      if (rawValue === undefined || rawValue === null || rawValue === '') continue;
      if (options?.propertyValue) {
        const serialized = String(rawValue).toLowerCase();
        if (!serialized.includes(options.propertyValue.toLowerCase())) continue;
      }
    }

    if (!trimmedQuery) {
      // Filtre par propriété seul, sans texte — tout ce qui a passé le
      // filtre ci-dessus est un résultat.
      results.push({ relPath: entry.relPath, name: entry.name, kind: entry.kind, matchType: 'property' });
      continue;
    }

    const nameIndex = entry.name.toLowerCase().indexOf(needle);
    if (nameIndex !== -1) {
      results.push({ relPath: entry.relPath, name: entry.name, kind: entry.kind, matchType: 'title' });
      continue;
    }

    if (entry.kind !== 'markdown') continue;

    await readNoteOnce();

    const tags = extractTags(body);
    if (tags.some((tag) => tag.includes(needle))) {
      results.push({ relPath: entry.relPath, name: entry.name, kind: entry.kind, matchType: 'tag' });
      continue;
    }

    const bodyLower = body.toLowerCase();
    const contentIndex = bodyLower.indexOf(needle);
    if (contentIndex !== -1) {
      results.push({
        relPath: entry.relPath,
        name: entry.name,
        kind: entry.kind,
        matchType: 'content',
        snippet: buildSnippet(body, contentIndex, needle.length),
      });
    }
  }

  // Tâches et évènements du calendrier n'ont pas de frontmatter/propriétés
  // — un filtre par propriété actif les exclut donc entièrement plutôt que
  // de les inclure à tort (ils ne peuvent jamais satisfaire ce filtre).
  if (trimmedQuery && !propertyId) {
    results.push(...searchTasks(vaultPath, needle));
    results.push(...searchCalendarEvents(vaultPath, needle));
  }

  // Titre d'abord, puis mots-clés, puis contenu, puis propriété seule —
  // une correspondance "plus directe" (le nom lui-même) est plus
  // pertinente qu'une mention perdue dans le corps.
  const priority: Record<SearchResult['matchType'], number> = { title: 0, tag: 1, content: 2, property: 3 };
  results.sort((a, b) => priority[a.matchType] - priority[b.matchType]);

  return results;
}

// Vue dédiée aux tags (voir NotesScreen.tsx, bascule Fichiers/Tags) —
// réutilise le même parcours + la même extraction de tags que la recherche
// globale ci-dessus (walkAll, parseFrontmatter, TAG_PATTERN via
// extractTags) plutôt que de dupliquer une seconde fois cette logique, déjà
// dupliquée une fois volontairement entre ce fichier et
// apps/mobile/lib/markdownPlugins.ts (voir le commentaire de TAG_PATTERN
// plus haut) — inutile d'ajouter une TROISIÈME copie côté main process
// alors qu'un seul module la porte déjà ici. Regroupe par tag (un
// `#mot-clé` pouvant apparaître dans plusieurs notes), trié
// alphabétiquement.
async function listTags(vaultPath: string): Promise<TagGroup[]> {
  const entries = await walkAll(vaultPath, vaultPath);
  const notesByTag = new Map<string, { relPath: string; name: string }[]>();

  for (const entry of entries) {
    if (entry.isFolder || entry.kind !== 'markdown') continue;
    let content: string;
    try {
      content = await fs.readFile(entry.fullPath, 'utf8');
    } catch {
      // Fichier illisible entre le listage et la lecture — ignoré plutôt
      // que de faire échouer tout le chargement pour un seul fichier (même
      // esprit que runSearch ci-dessus).
      continue;
    }
    const { body } = parseFrontmatter(content);
    for (const tag of extractTags(body)) {
      const notes = notesByTag.get(tag) ?? [];
      notes.push({ relPath: entry.relPath, name: entry.name });
      notesByTag.set(tag, notes);
    }
  }

  return [...notesByTag.entries()]
    .map(([tag, notes]) => ({ tag, notes }))
    .sort((a, b) => a.tag.localeCompare(b.tag, 'fr'));
}

export function registerSearchHandlers(): void {
  ipcMain.handle('vault:search', async (_event, query: string, options?: SearchOptions) => {
    const vaultPath = getVaultPath();
    if (!vaultPath) return [];
    return runSearch(vaultPath, query, options);
  });

  ipcMain.handle('vault:list-tags', async () => {
    const vaultPath = getVaultPath();
    if (!vaultPath) return [];
    return listTags(vaultPath);
  });
}
