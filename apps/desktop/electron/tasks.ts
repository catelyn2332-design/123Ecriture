import { ipcMain, type BrowserWindow } from 'electron';
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import crypto from 'crypto';

import * as vaults from './vaults';
import type { Subtask, Task, TaskAttachment, TaskList, TaskListsData } from './types';

type GetWindow = () => BrowserWindow | null;

// Module de productivité "Tâches" (voir docs/ARCHITECTURE.md §8) : listes de
// tâches, stockées DANS le vault (pas dans le config.json app-level comme
// les préférences) — les tâches sont du contenu utilisateur au même titre
// que les notes, pas un réglage de l'app. Fichiers cachés dédiés plutôt que
// des notes .mdx : plus simple à lire/écrire comme données structurées, et
// .123ecriture/ est déjà le dossier réservé à la config du vault (voir
// docs/ARCHITECTURE.md §4).
//
// Comme vault.js, délègue au coffre ACTIF du registre multi-coffres
// (vaults.js) — chaque coffre a son propre jeu de listes de tâches.
//
// Plusieurs LISTES nommées (pas juste une liste plate comme avant) : un
// fichier `.123ecriture/tasklists.json` ({ lists: [...], activeListId })
// tient le registre des listes, un seul `.123ecriture/tasks.json` continue
// de porter TOUTES les tâches de toutes les listes du coffre (chacune
// taguée `listId`) — plus simple qu'un fichier par liste, et cohérent avec
// le fait que le nombre de tâches par coffre reste petit. Toutes les
// opérations (`tasks:list/add/toggle/remove`) restent scopées à la liste
// ACTIVE, exactement comme vault.js scope tout au coffre actif — même
// pattern, pour rester prévisible.
//
// Pas encore de vrai registre de modules (§8) : prématuré tant qu'il n'y a
// qu'un seul module — à construire quand un deuxième (calendrier...)
// arrivera et qu'un pattern commun se dessinera vraiment.

function getVaultPath(): string | null {
  return vaults.getActiveVaultPath();
}

function getTasksFilePath(vaultPath: string): string {
  return path.join(vaultPath, '.123ecriture', 'tasks.json');
}

function getTaskListsFilePath(vaultPath: string): string {
  return path.join(vaultPath, '.123ecriture', 'tasklists.json');
}

// Tolère les tâches écrites avant l'ajout de description/sous-étapes/
// pièces jointes (refonte façon Microsoft To Do) : normalise à la LECTURE
// plutôt que de migrer le fichier sur disque — même esprit que
// frontmatter.ts, pas de réécriture silencieuse tant que rien n'a été
// modifié.
function normalizeTask(task: Task): Task {
  return {
    ...task,
    description: task.description ?? '',
    subtasks: task.subtasks ?? [],
    attachments: task.attachments ?? [],
  };
}

// Exportées (pas seulement internes à ce module) pour être réutilisées par
// search.ts — la recherche globale doit aussi trouver les tâches, sans
// dupliquer la lecture de tasks.json/tasklists.json (même process Electron,
// pas la même justification que la duplication frontmatter.ts/search.ts,
// qui elle traverse la frontière renderer/main).
export function readTasks(vaultPath: string): Task[] {
  try {
    const raw = JSON.parse(fsSync.readFileSync(getTasksFilePath(vaultPath), 'utf8')) as Task[];
    return raw.map(normalizeTask);
  } catch {
    return [];
  }
}

function findTaskOrThrow(tasks: Task[], id: string): Task {
  const task = tasks.find((t) => t.id === id);
  if (!task) throw new Error('Tâche introuvable.');
  return task;
}

async function writeTasks(vaultPath: string, tasks: Task[]): Promise<Task[]> {
  const filePath = getTasksFilePath(vaultPath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(tasks, null, 2), 'utf8');
  return tasks;
}

function readTaskListsRaw(vaultPath: string): TaskListsData | null {
  try {
    return JSON.parse(fsSync.readFileSync(getTaskListsFilePath(vaultPath), 'utf8')) as TaskListsData;
  } catch {
    return null;
  }
}

function writeTaskLists(vaultPath: string, data: TaskListsData): TaskListsData {
  const filePath = getTaskListsFilePath(vaultPath);
  fsSync.mkdirSync(path.dirname(filePath), { recursive: true });
  fsSync.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
  return data;
}

// Migration paresseuse et idempotente : la toute première fois qu'un coffre
// (nouveau ou déjà utilisé avant l'introduction des listes multiples) est
// consulté, crée une liste par défaut et y rattache les tâches existantes
// qui n'ont pas encore de `listId` (tâches créées avant cette fonctionnalité
// — jamais perdues, juste rangées dans la liste par défaut).
function migrateTaskLists(vaultPath: string): TaskListsData {
  let data = readTaskListsRaw(vaultPath);
  if (data) return data;

  const defaultList: TaskList = { id: crypto.randomUUID(), name: 'Tâches', createdAt: new Date().toISOString() };
  data = { lists: [defaultList], activeListId: defaultList.id };
  writeTaskLists(vaultPath, data);

  const tasks = readTasks(vaultPath);
  if (tasks.some((task) => !task.listId)) {
    const migratedTasks = tasks.map((task) => (task.listId ? task : { ...task, listId: defaultList.id }));
    // Synchrone (pas d'await ici, cette fonction est volontairement non
    // async pour rester appelable depuis n'importe quel accesseur sans
    // propager `async` partout) — fs.writeFileSync plutôt que writeTasks().
    fsSync.writeFileSync(getTasksFilePath(vaultPath), JSON.stringify(migratedTasks, null, 2), 'utf8');
  }

  return data;
}

// Exportée pour search.ts, même raison que readTasks ci-dessus — appelée
// avant readTasks pour garantir la migration paresseuse (attribution d'un
// listId à toute tâche créée avant les listes multiples) : sans ça, une
// tâche pourrait remonter dans les résultats de recherche sans identifiant
// de liste exploitable pour la rouvrir.
export function getTaskLists(vaultPath: string): TaskList[] {
  return migrateTaskLists(vaultPath).lists;
}

function getActiveListId(vaultPath: string): string | null {
  return migrateTaskLists(vaultPath).activeListId;
}

function findListOrThrow(lists: TaskList[], id: string): TaskList {
  const list = lists.find((l) => l.id === id);
  if (!list) throw new Error('Liste introuvable.');
  return list;
}

function broadcastTaskListsChanged(getWindow: GetWindow, vaultPath: string): void {
  const win = getWindow?.();
  if (win) win.webContents.send('tasklists:changed', getTaskLists(vaultPath));
}

export function registerTasksHandlers(getWindow: GetWindow): void {
  ipcMain.handle('tasklists:list', () => {
    const vaultPath = getVaultPath();
    if (!vaultPath) return [];
    return getTaskLists(vaultPath);
  });

  ipcMain.handle('tasklists:get-active', () => {
    const vaultPath = getVaultPath();
    if (!vaultPath) return null;
    return getActiveListId(vaultPath);
  });

  ipcMain.handle('tasklists:create', (_event, name: string) => {
    const vaultPath = getVaultPath();
    if (!vaultPath) throw new Error('Aucun vault sélectionné');
    const trimmed = (name ?? '').trim();
    if (!trimmed) throw new Error('Le nom de la liste ne peut pas être vide.');

    const data = migrateTaskLists(vaultPath);
    const list: TaskList = { id: crypto.randomUUID(), name: trimmed, createdAt: new Date().toISOString() };
    data.lists.push(list);
    data.activeListId = list.id;
    writeTaskLists(vaultPath, data);
    broadcastTaskListsChanged(getWindow, vaultPath);
    return data.lists;
  });

  ipcMain.handle('tasklists:rename', (_event, id: string, name: string) => {
    const vaultPath = getVaultPath();
    if (!vaultPath) throw new Error('Aucun vault sélectionné');
    const trimmed = (name ?? '').trim();
    if (!trimmed) throw new Error('Le nom de la liste ne peut pas être vide.');

    const data = migrateTaskLists(vaultPath);
    findListOrThrow(data.lists, id).name = trimmed;
    writeTaskLists(vaultPath, data);
    broadcastTaskListsChanged(getWindow, vaultPath);
    return data.lists;
  });

  // Supprime la liste ET ses tâches (comme la plupart des apps de listes de
  // tâches : une liste est un panier jetable, contrairement à une note/un
  // dossier du vault, qu'on ne supprime jamais silencieusement dans cette
  // app — voir vault.js, qui n'expose d'ailleurs aucune suppression). Si
  // c'était la dernière liste, le coffre se retrouve sans liste active ;
  // l'écran Tâches propose alors d'en créer une nouvelle (même traitement
  // que "0 coffre" côté Paramètres).
  ipcMain.handle('tasklists:remove', (_event, id: string) => {
    const vaultPath = getVaultPath();
    if (!vaultPath) throw new Error('Aucun vault sélectionné');

    const data = migrateTaskLists(vaultPath);
    data.lists = data.lists.filter((l) => l.id !== id);
    if (data.activeListId === id) {
      data.activeListId = data.lists[0]?.id ?? null;
    }
    writeTaskLists(vaultPath, data);

    const remainingTasks = readTasks(vaultPath).filter((task) => task.listId !== id);
    void writeTasks(vaultPath, remainingTasks);

    broadcastTaskListsChanged(getWindow, vaultPath);
    return data.lists;
  });

  ipcMain.handle('tasklists:switch', (_event, id: string) => {
    const vaultPath = getVaultPath();
    if (!vaultPath) throw new Error('Aucun vault sélectionné');

    const data = migrateTaskLists(vaultPath);
    findListOrThrow(data.lists, id);
    data.activeListId = id;
    writeTaskLists(vaultPath, data);
    broadcastTaskListsChanged(getWindow, vaultPath);
    return data.lists;
  });

  ipcMain.handle('tasks:list', () => {
    const vaultPath = getVaultPath();
    if (!vaultPath) return [];
    const activeListId = getActiveListId(vaultPath);
    return readTasks(vaultPath).filter((task) => task.listId === activeListId);
  });

  ipcMain.handle('tasks:add', async (_event, text: string) => {
    const vaultPath = getVaultPath();
    if (!vaultPath) throw new Error('Aucun vault sélectionné');
    const trimmed = (text ?? '').trim();
    if (!trimmed) throw new Error('Le texte de la tâche ne peut pas être vide.');
    const activeListId = getActiveListId(vaultPath);
    if (!activeListId) throw new Error('Aucune liste sélectionnée — crées-en une d’abord.');

    const tasks = readTasks(vaultPath);
    // En tête plutôt qu'en fin de liste : une tâche ajoutée reste visible
    // sans avoir à faire défiler, même quand la liste est déjà longue —
    // sinon l'ajout peut sembler "ne rien faire" si la nouvelle tâche
    // apparaît hors champ tout en bas.
    tasks.unshift({
      id: crypto.randomUUID(),
      text: trimmed,
      done: false,
      createdAt: new Date().toISOString(),
      listId: activeListId,
      description: '',
      subtasks: [],
      attachments: [],
    });
    await writeTasks(vaultPath, tasks);
    return tasks.filter((task) => task.listId === activeListId);
  });

  ipcMain.handle('tasks:toggle', async (_event, id: string) => {
    const vaultPath = getVaultPath();
    if (!vaultPath) throw new Error('Aucun vault sélectionné');
    const activeListId = getActiveListId(vaultPath);
    const tasks = readTasks(vaultPath).map((task) =>
      task.id === id ? { ...task, done: !task.done } : task,
    );
    await writeTasks(vaultPath, tasks);
    return tasks.filter((task) => task.listId === activeListId);
  });

  ipcMain.handle('tasks:remove', async (_event, id: string) => {
    const vaultPath = getVaultPath();
    if (!vaultPath) throw new Error('Aucun vault sélectionné');
    const activeListId = getActiveListId(vaultPath);
    const tasks = readTasks(vaultPath).filter((task) => task.id !== id);
    await writeTasks(vaultPath, tasks);
    return tasks.filter((task) => task.listId === activeListId);
  });

  // Renommage du texte ET édition de la description — un seul point
  // d'entrée générique (`patch` partiel) plutôt que deux handlers quasi
  // identiques, même esprit que `preferences:set`.
  ipcMain.handle('tasks:update', async (_event, id: string, patch: { text?: string; description?: string }) => {
    const vaultPath = getVaultPath();
    if (!vaultPath) throw new Error('Aucun vault sélectionné');
    const activeListId = getActiveListId(vaultPath);
    const tasks = readTasks(vaultPath);
    findTaskOrThrow(tasks, id);
    const next = tasks.map((task) => {
      if (task.id !== id) return task;
      const text = patch.text !== undefined ? patch.text.trim() : task.text;
      if (!text) throw new Error('Le texte de la tâche ne peut pas être vide.');
      return { ...task, text, description: patch.description ?? task.description };
    });
    await writeTasks(vaultPath, next);
    return next.filter((task) => task.listId === activeListId);
  });

  ipcMain.handle('tasks:add-subtask', async (_event, taskId: string, text: string) => {
    const vaultPath = getVaultPath();
    if (!vaultPath) throw new Error('Aucun vault sélectionné');
    const activeListId = getActiveListId(vaultPath);
    const trimmed = (text ?? '').trim();
    if (!trimmed) throw new Error('Le texte de la sous-étape ne peut pas être vide.');
    const tasks = readTasks(vaultPath);
    findTaskOrThrow(tasks, taskId);
    const subtask: Subtask = { id: crypto.randomUUID(), text: trimmed, done: false };
    const next = tasks.map((task) =>
      task.id === taskId ? { ...task, subtasks: [...task.subtasks, subtask] } : task,
    );
    await writeTasks(vaultPath, next);
    return next.filter((task) => task.listId === activeListId);
  });

  ipcMain.handle(
    'tasks:rename-subtask',
    async (_event, taskId: string, subtaskId: string, text: string) => {
      const vaultPath = getVaultPath();
      if (!vaultPath) throw new Error('Aucun vault sélectionné');
      const activeListId = getActiveListId(vaultPath);
      const trimmed = (text ?? '').trim();
      if (!trimmed) throw new Error('Le texte de la sous-étape ne peut pas être vide.');
      const tasks = readTasks(vaultPath);
      findTaskOrThrow(tasks, taskId);
      const next = tasks.map((task) =>
        task.id === taskId
          ? {
              ...task,
              subtasks: task.subtasks.map((s) => (s.id === subtaskId ? { ...s, text: trimmed } : s)),
            }
          : task,
      );
      await writeTasks(vaultPath, next);
      return next.filter((task) => task.listId === activeListId);
    },
  );

  ipcMain.handle('tasks:toggle-subtask', async (_event, taskId: string, subtaskId: string) => {
    const vaultPath = getVaultPath();
    if (!vaultPath) throw new Error('Aucun vault sélectionné');
    const activeListId = getActiveListId(vaultPath);
    const tasks = readTasks(vaultPath);
    findTaskOrThrow(tasks, taskId);
    const next = tasks.map((task) =>
      task.id === taskId
        ? { ...task, subtasks: task.subtasks.map((s) => (s.id === subtaskId ? { ...s, done: !s.done } : s)) }
        : task,
    );
    await writeTasks(vaultPath, next);
    return next.filter((task) => task.listId === activeListId);
  });

  ipcMain.handle('tasks:remove-subtask', async (_event, taskId: string, subtaskId: string) => {
    const vaultPath = getVaultPath();
    if (!vaultPath) throw new Error('Aucun vault sélectionné');
    const activeListId = getActiveListId(vaultPath);
    const tasks = readTasks(vaultPath);
    findTaskOrThrow(tasks, taskId);
    const next = tasks.map((task) =>
      task.id === taskId ? { ...task, subtasks: task.subtasks.filter((s) => s.id !== subtaskId) } : task,
    );
    await writeTasks(vaultPath, next);
    return next.filter((task) => task.listId === activeListId);
  });

  // Pas de copie de fichier ICI : le renderer appelle déjà
  // `window.vault.importAttachment()` (vault.ts, copie dans
  // `<vault>/attachments/`, dédoublonnage inclus) et transmet juste le
  // `{relPath, name}` résultant — ce handler se contente de l'ajouter à la
  // tâche, pas de dupliquer un mécanisme d'import déjà existant.
  ipcMain.handle('tasks:add-attachment', async (_event, taskId: string, attachment: TaskAttachment) => {
    const vaultPath = getVaultPath();
    if (!vaultPath) throw new Error('Aucun vault sélectionné');
    const activeListId = getActiveListId(vaultPath);
    const tasks = readTasks(vaultPath);
    findTaskOrThrow(tasks, taskId);
    const next = tasks.map((task) =>
      task.id === taskId ? { ...task, attachments: [...task.attachments, attachment] } : task,
    );
    await writeTasks(vaultPath, next);
    return next.filter((task) => task.listId === activeListId);
  });

  ipcMain.handle('tasks:remove-attachment', async (_event, taskId: string, relPath: string) => {
    const vaultPath = getVaultPath();
    if (!vaultPath) throw new Error('Aucun vault sélectionné');
    const activeListId = getActiveListId(vaultPath);
    const tasks = readTasks(vaultPath);
    findTaskOrThrow(tasks, taskId);
    const next = tasks.map((task) =>
      task.id === taskId
        ? { ...task, attachments: task.attachments.filter((a) => a.relPath !== relPath) }
        : task,
    );
    await writeTasks(vaultPath, next);
    return next.filter((task) => task.listId === activeListId);
  });
}
