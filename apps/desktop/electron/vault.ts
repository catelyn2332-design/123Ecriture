import { dialog, ipcMain, type BrowserWindow } from 'electron';
import crypto from 'crypto';
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';

import { readConfig } from './config';
import * as vaults from './vaults';
import type { FileSortMode, VaultEntryKind, VaultOrder, VaultTreeNode } from './types';

type GetWindow = () => BrowserWindow | null;

// ////////////////////////////////////////////////////////////////////////
// 🗂️ SOMMAIRE — backend du vault (fichiers/dossiers du coffre actif)
// ////////////////////////////////////////////////////////////////////////
// //1. Types de fichiers et gabarits — extensions reconnues, kind, contenu
//      initial par type (defaultContentForKind).
// //2. Résolution de chemin et utilitaires — resolveInVault (garde-fou
//      hors-vault), findAvailableName, escapeRegExp, guessMimeType.
// //3. Ordre des fichiers — tri automatique (alphabétique/récent/ancien) ET
//      ordre manuel glissé-déposé (.123ecriture/order.json).
// //4. Dernier fichier ouvert — état PAR COFFRE (.123ecriture/state.json),
//      voir Paramètres → "Fichier ouvert par défaut".
// //5. Arborescence — walkTree, lit le disque + applique tri/ordre.
// //6. Handlers IPC — Lecture (list-tree, read-note, pièces jointes,
//      dernier fichier ouvert).
// //7. Handlers IPC — Création/écriture (write-note, create-note/-folder,
//      duplication, note journalière, import de pièce jointe).
// //8. Handlers IPC — Organisation (reorder, rename, move, set-path,
//      delete).
// Voir aussi apps/mobile/components/VaultTreeView.tsx (rendu de
// l'explorateur), NotesScreen.tsx (logique côté renderer : glisser-déposer,
// clic droit, ouverture par défaut) et FilesLinksSection.tsx (réglages).

// //1. 🗺️ TYPES DE FICHIERS ET GABARITS
// ////////////////////////////////////////////////////////////////////////

// Nom par défaut du dossier de pièces jointes — configurable depuis
// Paramètres → Gestion des fichiers et des liens (voir
// SettingsScreen.tsx/preferences.ts) ; ce fallback n'est utilisé qu'en
// l'absence de réglage stocké (ex. première utilisation, config.json
// absent).
const DEFAULT_ATTACHMENTS_FOLDER = 'attachments';

function getAttachmentsFolder(): string {
  return readConfig().preferences?.attachmentsFolder || DEFAULT_ATTACHMENTS_FOLDER;
}

// Paramètres → Gestion des fichiers et des liens → "Ordre des fichiers".
function getFileSortMode(): FileSortMode {
  return readConfig().preferences?.fileSortMode ?? 'alphabetical';
}

const MIME_BY_EXTENSION: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.flac': 'audio/flac',
};

function guessMimeType(fileName: string): string {
  return MIME_BY_EXTENSION[path.extname(fileName).toLowerCase()] ?? 'application/octet-stream';
}

// Un fichier du vault est reconnu comme "note" (feuille de l'arbre, ouvrable
// dans NotesScreen.tsx) selon son extension, qui détermine aussi son `kind`
// — pilote l'éditeur affiché côté renderer (MDX/CanvasEditor/ChartEditor,
// voir NotesScreen.tsx) et l'icône dans VaultTreeView.tsx. `.canvas` aligné
// sur JSON Canvas (https://jsoncanvas.org), `.chart` sur le format maison
// déjà utilisé par sheets.js (voir defaultContentForKind ci-dessous).
const EXTENSION_TO_KIND: Record<string, VaultEntryKind> = {
  '.mdx': 'markdown',
  // Fichiers `.md` importés depuis Obsidian (ou tout autre éditeur
  // Markdown standard) — reconnus comme notes au même titre que `.mdx`,
  // juste avec une extension différente. Les nouvelles notes créées PAR
  // l'app restent en `.mdx` (voir KIND_TO_EXTENSION) ; `.md` n'est accepté
  // qu'en LECTURE d'un fichier déjà existant sur disque.
  '.md': 'markdown',
  '.canvas': 'canvas',
  '.chart': 'chart',
  '.excalidraw': 'excalidraw',
};

const KIND_TO_EXTENSION: Record<VaultEntryKind, string> = {
  markdown: '.mdx',
  canvas: '.canvas',
  chart: '.chart',
  excalidraw: '.excalidraw',
};

// Contenu initial d'un fichier fraîchement créé, selon son `kind` — gabarit
// frontmatter pour une note, structures JSON vides mais valides sinon (un
// CanvasEditor/ChartEditor vide doit pouvoir parser le fichier tel quel dès
// sa création, sans cas particulier "fichier neuf").
function defaultContentForKind(kind: VaultEntryKind, safeName: string): string {
  if (kind === 'canvas') {
    return JSON.stringify({ nodes: [], edges: [] }, null, 2);
  }
  if (kind === 'chart') {
    return JSON.stringify(
      {
        columns: [
          { id: crypto.randomUUID(), name: 'Colonne A' },
          { id: crypto.randomUUID(), name: 'Colonne B' },
        ],
        rows: [],
        chart: null,
      },
      null,
      2,
    );
  }
  if (kind === 'excalidraw') {
    // Forme du fichier natif `.excalidraw` (https://excalidraw.com) — vide
    // mais valide, pour rester compatible si le vrai outil de dessin est
    // intégré plus tard (scaffolding seulement cette session, voir
    // ExcalidrawEditor.tsx).
    return JSON.stringify({ type: 'excalidraw', version: 2, elements: [], appState: {} }, null, 2);
  }
  return `---\ntitle: ${safeName}\ncreated: ${new Date().toISOString()}\n---\n\n`;
}

// Phase 1 : vault local minimal — un dossier choisi par l'utilisateur·rice,
// des fichiers .mdx et des dossiers dedans, exposés comme une vraie
// arborescence (voir walkTree). Voir docs/ARCHITECTURE.md §5.
//
// Depuis l'introduction des coffres multiples (vaults.js), ce fichier ne
// connaît plus de `vaultPath` en dur : `getVaultPath()` délègue au coffre
// ACTIF du registre. Tout le reste (walkTree, resolveInVault, les handlers
// vault:*) est inchangé — un seul point de couture avec vaults.js.
function getVaultPath(): string | null {
  return vaults.getActiveVaultPath();
}

// //2. 🔒 RÉSOLUTION DE CHEMIN ET UTILITAIRES
// ////////////////////////////////////////////////////////////////////////

// La fenêtre est sandboxée (contextIsolation, pas de nodeIntegration) donc
// le renderer ne peut pas manipuler fs directement, mais mieux vaut quand
// même ne jamais faire confiance à un relPath IPC sans vérifier qu'il reste
// dans le vault (ex. contre un "../../etc/passwd" mal intentionné ou bugué).
function resolveInVault(vaultPath: string, relPath: string): string {
  const root = path.resolve(vaultPath);
  const resolved = path.resolve(root, relPath);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error(`Chemin hors du vault refusé : ${relPath}`);
  }
  return resolved;
}

// Échappe les caractères spéciaux regex — utilisé pour retirer une
// extension de fichier (`.mdx`, `.md`...) d'un nom sans que le `.` soit
// interprété comme "n'importe quel caractère". Même utilitaire que
// occurrences.ts (dupliqué à dessein, voir le commentaire de walkAndHash
// dans sync.ts sur cette convention).
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Trouve un nom de fichier/dossier disponible dans `dir` en suffixant
// " 2", " 3"... si `candidate` existe déjà — mêmes règles pour les notes et
// les dossiers.
function findAvailableName(dir: string, candidate: string, extension = ''): string {
  let name = candidate;
  let counter = 2;
  while (fsSync.existsSync(path.join(dir, `${name}${extension}`))) {
    name = `${candidate} ${counter}`;
    counter += 1;
  }
  return `${name}${extension}`;
}

// //3. 🔀 ORDRE DES FICHIERS
// ////////////////////////////////////////////////////////////////////////

function getOrderFilePath(vaultPath: string): string {
  return path.join(vaultPath, '.123ecriture', 'order.json');
}

// Ordre manuel des enfants d'un dossier — voir vault:reorder plus bas et
// apps/mobile/components/NotesScreen.tsx (glisser pour réordonner). Une clé
// par dossier PARENT (chemin relatif, "" pour la racine du vault), valeur =
// noms d'enfants dans l'ordre voulu. Absent/illisible = pas encore de tri
// manuel dans ce vault, on retombe sur le tri alphabétique par défaut.
function readOrder(vaultPath: string): VaultOrder {
  try {
    return JSON.parse(fsSync.readFileSync(getOrderFilePath(vaultPath), 'utf8')) as VaultOrder;
  } catch {
    return {};
  }
}

async function writeOrder(vaultPath: string, order: VaultOrder): Promise<VaultOrder> {
  const filePath = getOrderFilePath(vaultPath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(order, null, 2), 'utf8');
  return order;
}

// //4. 📍 DERNIER FICHIER OUVERT
// ////////////////////////////////////////////////////////////////////////

function getStateFilePath(vaultPath: string): string {
  return path.join(vaultPath, '.123ecriture', 'state.json');
}

// Dernière note ouverte DANS CE COFFRE — voir Paramètres → Gestion des
// fichiers et des liens → "Fichier ouvert par défaut" = "Dernier ouvert"
// (apps/mobile/components/NotesScreen.tsx). PAR coffre plutôt qu'une
// préférence app-level (comme fileSortMode) : "la dernière note ouverte"
// n'a de sens que dans le coffre où elle l'a été, pas globalement. Même
// forme minimale que order.json/tasklists.json : un petit fichier dédié
// dans .123ecriture/ plutôt qu'alourdir un fichier existant.
function readLastOpened(vaultPath: string): string | null {
  try {
    const data = JSON.parse(fsSync.readFileSync(getStateFilePath(vaultPath), 'utf8')) as { lastOpenedRelPath?: string };
    return data.lastOpenedRelPath ?? null;
  } catch {
    return null;
  }
}

async function writeLastOpened(vaultPath: string, relPath: string | null): Promise<void> {
  const filePath = getStateFilePath(vaultPath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify({ lastOpenedRelPath: relPath }, null, 2), 'utf8');
}

// //5. 🌳 ARBORESCENCE
// ////////////////////////////////////////////////////////////////////////

// Arborescence complète du vault : dossiers avec leurs enfants, notes en
// feuilles. Tri par défaut : dossiers d'abord puis notes, alphabétique à
// chaque niveau — plus stable pour naviguer qu'un tri par date de
// modification. Si `order` contient une entrée pour ce dossier (voir
// readOrder), elle prime : les enfants qui y figurent sortent dans cet
// ordre-là, ceux qui n'y figurent pas (nouveaux, ou order.json pas encore
// mis à jour) restent à la suite dans leur ordre alphabétique habituel —
// pas besoin de purger les noms obsolètes (renommés/supprimés), ils sont
// simplement ignorés puisqu'introuvables dans `nodes`.
async function walkTree(dir: string, vaultRoot: string, order: VaultOrder): Promise<VaultTreeNode[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const nodes: VaultTreeNode[] = [];

  for (const entry of entries) {
    // Ignore les dossiers/fichiers cachés (.123ecriture/ config vault,
    // .git...).
    if (entry.name.startsWith('.')) continue;
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      const children = await walkTree(fullPath, vaultRoot, order);
      nodes.push({
        type: 'folder',
        relPath: path.relative(vaultRoot, fullPath),
        name: entry.name,
        children,
      });
    } else if (entry.isFile() && EXTENSION_TO_KIND[path.extname(entry.name)]) {
      const stat = await fs.stat(fullPath);
      const extension = path.extname(entry.name);
      nodes.push({
        type: 'note',
        relPath: path.relative(vaultRoot, fullPath),
        name: entry.name.slice(0, -extension.length),
        modifiedAt: stat.mtimeMs,
        kind: EXTENSION_TO_KIND[extension],
      });
    }
  }

  const sortMode = getFileSortMode();
  nodes.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
    // "Plus récent d'abord" ne s'applique qu'aux notes (pas de mtime
    // suivi sur les dossiers eux-mêmes) — les dossiers entre eux restent
    // alphabétiques quel que soit le mode, seul un repère stable et
    // prévisible pour naviguer dedans.
    if (sortMode === 'recent' && a.type === 'note' && b.type === 'note') {
      return b.modifiedAt - a.modifiedAt;
    }
    if (sortMode === 'oldest' && a.type === 'note' && b.type === 'note') {
      return a.modifiedAt - b.modifiedAt;
    }
    return a.name.localeCompare(b.name, 'fr');
  });

  // Le tri manuel (glisser-déposer, .123ecriture/order.json) ne s'applique
  // qu'en mode 'manual' — dans les autres modes, un ordre déjà enregistré
  // reste ignoré (pas supprimé : re-choisir 'manual' le restaure tel quel)
  // pour que le mode choisi soit sans ambiguïté.
  if (sortMode === 'manual') {
    const orderKey = path.relative(vaultRoot, dir);
    const savedOrder = order?.[orderKey];
    if (savedOrder && savedOrder.length > 0) {
      const rank = new Map(savedOrder.map((name, index) => [name, index]));
      // Tri stable (garantie ES2019+) : les nœuds absents de `rank` (rang
      // Infinity, tous égaux entre eux) conservent l'ordre déjà établi
      // ci-dessus plutôt que d'être mélangés.
      nodes.sort((a, b) => (rank.get(a.name) ?? Infinity) - (rank.get(b.name) ?? Infinity));
    }
  }

  return nodes;
}

export function registerVaultHandlers(getWindow: GetWindow): void {
  // //6. 📡 HANDLERS IPC — LECTURE
  // //////////////////////////////////////////////////////////////////////

  // Gardé tel quel (nom + signature) car consommé directement par
  // NotesScreen.tsx/TasksScreen.tsx (écran vide "Choisir un dossier") —
  // délègue maintenant à vaults.js (ajoute+active le dossier choisi dans le
  // registre multi-coffres) plutôt que d'écrire un `vaultPath` isolé.
  ipcMain.handle('vault:choose-folder', async () => {
    const vault = await vaults.pickAndAddExistingVault();
    if (vault) vaults.broadcastVaultsChanged(getWindow);
    return getVaultPath();
  });

  ipcMain.handle('vault:get-current-path', () => getVaultPath());

  ipcMain.handle('vault:list-tree', async () => {
    const vaultPath = getVaultPath();
    if (!vaultPath) return [];
    return walkTree(vaultPath, vaultPath, readOrder(vaultPath));
  });

  // Persiste l'ordre manuel des enfants d'un dossier (glisser pour
  // réordonner, voir NotesScreen.tsx) et renvoie l'arborescence à jour —
  // même forme de réponse que vault:list-tree, pour éviter un aller-retour
  // supplémentaire côté renderer après un reorder.
  ipcMain.handle('vault:reorder', async (_event, parentRelPath: string | undefined, orderedNames: unknown) => {
    const vaultPath = getVaultPath();
    if (!vaultPath) throw new Error('Aucun vault sélectionné');
    if (!Array.isArray(orderedNames)) throw new Error('Ordre invalide.');

    const order = readOrder(vaultPath);
    order[parentRelPath ?? ''] = orderedNames as string[];
    await writeOrder(vaultPath, order);
    return walkTree(vaultPath, vaultPath, order);
  });

  ipcMain.handle('vault:read-note', async (_event, relPath: string) => {
    const vaultPath = getVaultPath();
    if (!vaultPath) throw new Error('Aucun vault sélectionné');
    return fs.readFile(resolveInVault(vaultPath, relPath), 'utf8');
  });

  // //7. 📡 HANDLERS IPC — CRÉATION / ÉCRITURE
  // //////////////////////////////////////////////////////////////////////

  ipcMain.handle('vault:write-note', async (_event, relPath: string, content: string) => {
    const vaultPath = getVaultPath();
    if (!vaultPath) throw new Error('Aucun vault sélectionné');
    await fs.writeFile(resolveInVault(vaultPath, relPath), content, 'utf8');
  });

  // `parentRelPath` optionnel : crée à la racine du vault si omis, sinon
  // dans le dossier visé (clic droit sur un dossier → "Nouvelle note ici").
  // `kind` optionnel (défaut 'markdown') : voir EXTENSION_TO_KIND/
  // defaultContentForKind — même handler pour note/canvas/graphique, seul le
  // gabarit change (clic droit → "Nouveau canvas"/"Nouveau graphique").
  ipcMain.handle(
    'vault:create-note',
    async (_event, name: string, parentRelPath: string | undefined, kind: string | undefined) => {
      const vaultPath = getVaultPath();
      if (!vaultPath) throw new Error('Aucun vault sélectionné');
      const parentFull = parentRelPath ? resolveInVault(vaultPath, parentRelPath) : vaultPath;

      const safeKind: VaultEntryKind = kind && kind in KIND_TO_EXTENSION ? (kind as VaultEntryKind) : 'markdown';
      const extension = KIND_TO_EXTENSION[safeKind];
      const safeName = name && name.trim().length > 0 ? name.trim() : 'Sans titre';
      const fileName = findAvailableName(parentFull, safeName, extension);
      const fullPath = path.join(parentFull, fileName);
      await fs.writeFile(fullPath, defaultContentForKind(safeKind, safeName), 'utf8');
      const stat = await fs.stat(fullPath);

      return {
        relPath: path.relative(vaultPath, fullPath),
        name: fileName.slice(0, -extension.length),
        modifiedAt: stat.mtimeMs,
        kind: safeKind,
      };
    },
  );

  // Duplique une note/canvas/graphique/excalidraw existant dans SON PROPRE
  // dossier — utile pour partir d'un gabarit sans repartir de zéro (voir
  // NotesScreen.tsx, menu contextuel "Dupliquer"). Suffixe explicite
  // " (copie)", puis " (copie 2)"... en cas de collision, plutôt que
  // `findAvailableName` telle quelle (qui suffixerait juste " 2", " 3"...) :
  // une copie doit rester identifiable comme telle, pas ressembler à une
  // note distincte du même nom numéroté.
  ipcMain.handle('vault:duplicate', async (_event, relPath: string) => {
    const vaultPath = getVaultPath();
    if (!vaultPath) throw new Error('Aucun vault sélectionné');

    const sourceFull = resolveInVault(vaultPath, relPath);
    if (!fsSync.existsSync(sourceFull) || !fsSync.statSync(sourceFull).isFile()) {
      throw new Error('Élément introuvable.');
    }

    const extension = path.extname(sourceFull);
    const baseName = path.basename(sourceFull, extension);
    const dir = path.dirname(sourceFull);
    const kind: VaultEntryKind = EXTENSION_TO_KIND[extension] ?? 'markdown';

    let candidateName = `${baseName} (copie)`;
    let counter = 2;
    while (fsSync.existsSync(path.join(dir, `${candidateName}${extension}`))) {
      candidateName = `${baseName} (copie ${counter})`;
      counter += 1;
    }

    const content = await fs.readFile(sourceFull, 'utf8');
    const destFull = path.join(dir, `${candidateName}${extension}`);
    await fs.writeFile(destFull, content, 'utf8');
    const stat = await fs.stat(destFull);

    return {
      relPath: path.relative(vaultPath, destFull),
      name: candidateName,
      modifiedAt: stat.mtimeMs,
      kind,
    };
  });

  ipcMain.handle('vault:create-folder', async (_event, name: string, parentRelPath: string | undefined) => {
    const vaultPath = getVaultPath();
    if (!vaultPath) throw new Error('Aucun vault sélectionné');
    const parentFull = parentRelPath ? resolveInVault(vaultPath, parentRelPath) : vaultPath;

    const safeName = name && name.trim().length > 0 ? name.trim() : 'Nouveau dossier';
    const folderName = findAvailableName(parentFull, safeName);
    const fullPath = path.join(parentFull, folderName);
    await fs.mkdir(fullPath);

    return { relPath: path.relative(vaultPath, fullPath), name: folderName };
  });

  // Note journalière — voir apps/mobile/components/CalendarScreen.tsx.
  // Convention de CHEMIN plutôt que propriété frontmatter interrogeable (le
  // vault n'a pas encore de système de propriétés — hors périmètre) : un
  // dossier fixe `Journal/`, un fichier par jour nommé AAAA-MM-JJ.mdx.
  // Idempotent : si la note existe déjà, la renvoie telle quelle sans la
  // toucher (jamais d'écrasement d'une note journalière déjà écrite).
  ipcMain.handle('vault:ensure-daily-note', async (_event, dateIso: string) => {
    const vaultPath = getVaultPath();
    if (!vaultPath) throw new Error('Aucun vault sélectionné');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateIso ?? '')) {
      throw new Error('Date invalide (attendu AAAA-MM-JJ).');
    }

    const folderFull = path.join(vaultPath, 'Journal');
    await fs.mkdir(folderFull, { recursive: true });
    const mdxPath = path.join(folderFull, `${dateIso}.mdx`);
    // Une note journalière du jour peut déjà exister en `.md` (import
    // Obsidian, plugin Daily Notes natif) — la retrouver plutôt que de
    // créer un doublon `.mdx` à côté.
    const mdPath = path.join(folderFull, `${dateIso}.md`);
    const fullPath = fsSync.existsSync(mdPath) && !fsSync.existsSync(mdxPath) ? mdPath : mdxPath;

    if (!fsSync.existsSync(fullPath)) {
      const template = `---\ntitle: ${dateIso}\ncreated: ${new Date().toISOString()}\n---\n\n`;
      await fs.writeFile(fullPath, template, 'utf8');
    }
    const stat = await fs.stat(fullPath);

    return {
      relPath: path.relative(vaultPath, fullPath),
      name: dateIso,
      modifiedAt: stat.mtimeMs,
    };
  });

  // Pièce jointe (image/audio/fichier) pour une note — voir
  // apps/mobile/components/NoteRenderer.tsx (rendu de `![[...]]`, syntaxe
  // d'embed Obsidian). Copiée dans un dossier `attachments/` à la RACINE du
  // vault (pas à côté de la note) : une pièce jointe référencée par son seul
  // nom reste valide même si la note qui la référence est ensuite déplacée/
  // renommée — un dossier par note aurait cassé ce lien à chaque
  // déplacement.
  ipcMain.handle('vault:import-attachment', async () => {
    const vaultPath = getVaultPath();
    if (!vaultPath) throw new Error('Aucun vault sélectionné');

    const result = await dialog.showOpenDialog({ properties: ['openFile'] });
    if (result.canceled || result.filePaths.length === 0) return null;

    const sourcePath = result.filePaths[0];
    const attachmentsDir = path.join(vaultPath, getAttachmentsFolder());
    await fs.mkdir(attachmentsDir, { recursive: true });
    const extension = path.extname(sourcePath);
    const baseName = path.basename(sourcePath, extension);
    const finalName = findAvailableName(attachmentsDir, baseName, extension);
    const destPath = path.join(attachmentsDir, finalName);
    await fs.copyFile(sourcePath, destPath);

    return { relPath: path.relative(vaultPath, destPath), name: finalName };
  });

  // Contenu d'une pièce jointe en URI `data:` (image/audio affichés inline
  // dans NoteRenderer.tsx) — plus simple et plus fiable ici qu'un protocole
  // personnalisé dédié (le renderer charge déjà tout via `app://`/le
  // serveur de dev Expo, un `file://` direct se heurterait aux règles de
  // sécurité de Chromium selon l'origine). Accepte un nom seul (résolu dans
  // `attachments/`) ou un relPath complet, pour rester utilisable si des
  // pièces jointes non conventionnelles apparaissent plus tard.
  ipcMain.handle('vault:read-attachment-data-url', async (_event, relPath: string) => {
    const vaultPath = getVaultPath();
    if (!vaultPath) throw new Error('Aucun vault sélectionné');
    const target = relPath && relPath.includes('/') ? relPath : path.join(getAttachmentsFolder(), relPath ?? '');
    const fullPath = resolveInVault(vaultPath, target);
    const buffer = await fs.readFile(fullPath);
    return `data:${guessMimeType(fullPath)};base64,${buffer.toString('base64')}`;
  });

  // //8. 📡 HANDLERS IPC — ORGANISATION (renommer/déplacer/supprimer)
  // //////////////////////////////////////////////////////////////////////

  // Renomme une note ou un dossier (détection automatique du type via
  // fs.stat) — reste dans le même dossier parent, pas de déplacement.
  ipcMain.handle('vault:rename', async (_event, relPath: string, newName: string) => {
    const vaultPath = getVaultPath();
    if (!vaultPath) throw new Error('Aucun vault sélectionné');

    const oldFull = resolveInVault(vaultPath, relPath);
    if (!fsSync.existsSync(oldFull)) throw new Error('Élément introuvable.');
    const isNote = fsSync.statSync(oldFull).isFile();
    // Préserve l'extension RÉELLE du fichier (`.mdx`, `.md`, `.canvas`,
    // `.chart`...) plutôt que de forcer `.mdx` sur tout — un ancien bug qui
    // corrompait silencieusement tout fichier non-`.mdx` renommé (ex. un
    // `.canvas` devenait `truc.canvas.mdx`, disparaissait de l'arborescence
    // car `.canvas.mdx` n'est reconnu par aucun kind).
    const extension = isNote ? path.extname(oldFull) : '';

    // Un nom ne doit pas pouvoir contenir de séparateur de chemin : un
    // renommage reste un renommage, pas un déplacement déguisé.
    const trimmed = (newName ?? '').trim().replace(/[/\\]/g, '');
    if (!trimmed) throw new Error('Le nom ne peut pas être vide.');

    const baseName = isNote && extension ? trimmed.replace(new RegExp(`${escapeRegExp(extension)}$`, 'i'), '') : trimmed;
    const finalName = isNote ? `${baseName}${extension}` : baseName;
    const parentDir = path.dirname(oldFull);
    const newFull = path.join(parentDir, finalName);

    if (newFull !== oldFull && fsSync.existsSync(newFull)) {
      throw new Error(`"${finalName}" existe déjà à cet endroit.`);
    }

    await fs.rename(oldFull, newFull);
    return { relPath: path.relative(vaultPath, newFull), name: baseName };
  });

  // Déplace une note ou un dossier vers un autre dossier du vault (ou la
  // racine si destinationParentRelPath est omis). Contrairement à
  // vault:rename, ça change le dossier parent — le nom reste le même sauf
  // collision à destination.
  ipcMain.handle('vault:move', async (_event, relPath: string, destinationParentRelPath: string | undefined) => {
    const vaultPath = getVaultPath();
    if (!vaultPath) throw new Error('Aucun vault sélectionné');

    const oldFull = resolveInVault(vaultPath, relPath);
    if (!fsSync.existsSync(oldFull)) throw new Error('Élément introuvable.');

    const destFull = destinationParentRelPath
      ? resolveInVault(vaultPath, destinationParentRelPath)
      : vaultPath;
    if (!fsSync.existsSync(destFull) || !fsSync.statSync(destFull).isDirectory()) {
      throw new Error('Destination invalide.');
    }

    // Un dossier ne peut pas être déplacé dans lui-même ni dans l'un de ses
    // propres sous-dossiers (casserait l'arborescence).
    if (destFull === oldFull || destFull.startsWith(oldFull + path.sep)) {
      throw new Error('Impossible de déplacer un dossier dans lui-même ou l’un de ses sous-dossiers.');
    }

    const isNote = fsSync.statSync(oldFull).isFile();
    // Préserve l'extension réelle (voir vault:rename ci-dessus pour le
    // détail du bug que ça corrige).
    const extension = isNote ? path.extname(oldFull) : '';
    const baseName = isNote ? path.basename(oldFull, extension) : path.basename(oldFull);
    const finalName = findAvailableName(destFull, baseName, extension);
    const newFull = path.join(destFull, finalName);

    if (newFull === oldFull) {
      // Déjà à cet endroit — no-op plutôt qu'une erreur fs.rename inutile.
      return { relPath: path.relative(vaultPath, oldFull), name: baseName };
    }

    await fs.rename(oldFull, newFull);
    return {
      relPath: path.relative(vaultPath, newFull),
      name: extension ? finalName.replace(new RegExp(`${escapeRegExp(extension)}$`, 'i'), '') : finalName,
    };
  });

  // Édition manuelle du chemin complet (dossier + nom) en une seule
  // opération, à partir d'un chemin tapé à la main — voir
  // apps/mobile/components/EditPathDialog.tsx. Contrairement à vault:rename
  // (jamais de séparateur, reste dans le même dossier) et vault:move (choisit
  // parmi les dossiers EXISTANTS), ceci accepte un chemin arbitraire et crée
  // les dossiers intermédiaires manquants — comportement attendu d'une
  // édition "manuelle" de chemin. Contrairement à create-note/create-folder,
  // AUCUN renommage automatique en " 2"/" 3" en cas de collision : c'est une
  // erreur, l'utilisatrice a tapé ce chemin précis exprès.
  ipcMain.handle('vault:set-path', async (_event, relPath: string, newRelPath: string) => {
    const vaultPath = getVaultPath();
    if (!vaultPath) throw new Error('Aucun vault sélectionné');

    const oldFull = resolveInVault(vaultPath, relPath);
    if (!fsSync.existsSync(oldFull)) throw new Error('Élément introuvable.');
    const isNote = fsSync.statSync(oldFull).isFile();
    // Préserve l'extension réelle (voir vault:rename plus haut).
    const extension = isNote ? path.extname(oldFull) : '';

    const trimmed = (newRelPath ?? '')
      .trim()
      .replace(/^\/+/, '')
      .replace(/\/+$/, '');
    if (!trimmed) throw new Error('Le chemin ne peut pas être vide.');
    if (trimmed.split('/').some((segment) => segment.trim() === '' || segment === '.' || segment === '..')) {
      throw new Error('Chemin invalide.');
    }

    const strippedTrimmed =
      isNote && extension ? trimmed.replace(new RegExp(`${escapeRegExp(extension)}$`, 'i'), '') : trimmed;
    const finalRelPath = isNote ? `${strippedTrimmed}${extension}` : trimmed;
    const newFull = resolveInVault(vaultPath, finalRelPath);

    if (newFull === oldFull) {
      // Déjà à cet endroit — no-op plutôt qu'une erreur fs.rename inutile.
      return {
        relPath: path.relative(vaultPath, newFull),
        name: isNote ? path.basename(newFull, extension) : path.basename(newFull),
      };
    }

    if (!isNote && (newFull === oldFull || newFull.startsWith(oldFull + path.sep))) {
      throw new Error('Impossible de déplacer un dossier dans lui-même ou l’un de ses sous-dossiers.');
    }
    if (fsSync.existsSync(newFull)) {
      throw new Error(`"${finalRelPath}" existe déjà.`);
    }

    await fs.mkdir(path.dirname(newFull), { recursive: true });
    await fs.rename(oldFull, newFull);
    return {
      relPath: path.relative(vaultPath, newFull),
      name: isNote ? path.basename(newFull, extension) : path.basename(newFull),
    };
  });

  // Suppression — jusqu'ici volontairement absente (voir l'historique de ce
  // fichier : "aucune suppression exposée", cohérent avec le fait que
  // renommer/déplacer ne perdent jamais de contenu). Ajoutée à la demande
  // explicite de l'utilisatrice, mais avec une confirmation NATIVE
  // (`dialog.showMessageBox`, même mécanisme que `vault:choose-folder`)
  // avant toute suppression réelle — jamais silencieuse, et le message
  // distingue explicitement "note" de "dossier ET tout son contenu" pour
  // qu'une suppression de dossier ne surprenne personne. Recours à
  // `fs.rm(..., {recursive:true})` : fonctionne aussi bien pour un fichier
  // que pour un dossier, pas besoin de deux chemins de code séparés.
  ipcMain.handle('vault:delete', async (_event, relPath: string) => {
    const vaultPath = getVaultPath();
    if (!vaultPath) throw new Error('Aucun vault sélectionné');

    const fullPath = resolveInVault(vaultPath, relPath);
    if (!fsSync.existsSync(fullPath)) throw new Error('Élément introuvable.');
    const isFolder = fsSync.statSync(fullPath).isDirectory();
    const name = path.basename(fullPath);

    const win = getWindow();
    const messageBoxOptions = {
      type: 'warning' as const,
      buttons: ['Annuler', 'Supprimer'],
      defaultId: 0,
      cancelId: 0,
      message: isFolder ? `Supprimer le dossier « ${name} » ?` : `Supprimer « ${name} » ?`,
      detail: isFolder
        ? 'Ce dossier et TOUT son contenu (notes, sous-dossiers, pièces jointes qu’il contient) seront supprimés définitivement.'
        : 'Cette note sera supprimée définitivement.',
    };
    const { response } = win
      ? await dialog.showMessageBox(win, messageBoxOptions)
      : await dialog.showMessageBox(messageBoxOptions);
    if (response !== 1) return { deleted: false };

    await fs.rm(fullPath, { recursive: true, force: true });
    return { deleted: true };
  });

  // Voir "Fichier ouvert par défaut" ci-dessus (readLastOpened/
  // writeLastOpened) — le renderer appelle `setLastOpened` à chaque
  // ouverture RÉUSSIE d'une note (voir NotesScreen.tsx, `openNote`), et
  // `getLastOpened` une fois au démarrage/changement de coffre pour savoir
  // quoi rouvrir.
  ipcMain.handle('vault:get-last-opened', () => {
    const vaultPath = getVaultPath();
    if (!vaultPath) return null;
    return readLastOpened(vaultPath);
  });

  ipcMain.handle('vault:set-last-opened', async (_event, relPath: string | null) => {
    const vaultPath = getVaultPath();
    if (!vaultPath) return;
    await writeLastOpened(vaultPath, relPath);
  });
}
