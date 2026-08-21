import { ipcMain } from 'electron';
import crypto from 'crypto';
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';

import * as vaults from './vaults';
import type { CalendarEvent, CalendarEventInput } from './types';

// Module "Calendrier" — évènements horodatés (voir docs/ARCHITECTURE.md §8
// et apps/mobile/components/CalendarScreen.tsx). Les notes JOURNALIÈRES,
// elles, vivent comme de vraies notes .mdx (voir vault:ensure-daily-note
// dans vault.js) — seuls les ÉVÈNEMENTS (titre, date, heure optionnelle)
// ont besoin d'un stockage structuré dédié, pas assez "document" pour être
// une note. Même schéma que tasks.js : un fichier caché scopé au coffre
// actif, pas de multi-listes ici (un seul calendrier par coffre a du sens,
// contrairement aux tâches).

function getVaultPath(): string | null {
  return vaults.getActiveVaultPath();
}

function getEventsFilePath(vaultPath: string): string {
  return path.join(vaultPath, '.123ecriture', 'events.json');
}

// Exportée pour search.ts — la recherche globale doit aussi trouver les
// évènements du calendrier, même raison que readTasks/getTaskLists dans
// tasks.ts (même process Electron, pas de duplication de lecture).
export function readEvents(vaultPath: string): CalendarEvent[] {
  try {
    return JSON.parse(fsSync.readFileSync(getEventsFilePath(vaultPath), 'utf8')) as CalendarEvent[];
  } catch {
    return [];
  }
}

async function writeEvents(vaultPath: string, events: CalendarEvent[]): Promise<CalendarEvent[]> {
  const filePath = getEventsFilePath(vaultPath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(events, null, 2), 'utf8');
  return events;
}

export function registerCalendarHandlers(): void {
  ipcMain.handle('calendar:list-events', () => {
    const vaultPath = getVaultPath();
    if (!vaultPath) return [];
    return readEvents(vaultPath);
  });

  ipcMain.handle('calendar:add-event', async (_event, input: CalendarEventInput) => {
    const vaultPath = getVaultPath();
    if (!vaultPath) throw new Error('Aucun vault sélectionné');
    const title = (input?.title ?? '').trim();
    if (!title) throw new Error('Le titre de l’évènement ne peut pas être vide.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input?.date ?? '')) {
      throw new Error('Date invalide (attendu AAAA-MM-JJ).');
    }

    const events = readEvents(vaultPath);
    events.push({
      id: crypto.randomUUID(),
      title,
      date: input.date,
      time: input?.allDay ? null : input?.time || null,
      allDay: Boolean(input?.allDay),
      notes: input?.notes ?? '',
      createdAt: new Date().toISOString(),
    });
    return writeEvents(vaultPath, events);
  });

  ipcMain.handle('calendar:update-event', async (_event, id: string, patch: Partial<CalendarEventInput>) => {
    const vaultPath = getVaultPath();
    if (!vaultPath) throw new Error('Aucun vault sélectionné');
    const events = readEvents(vaultPath).map((ev) => (ev.id === id ? { ...ev, ...patch, id: ev.id } : ev));
    return writeEvents(vaultPath, events);
  });

  ipcMain.handle('calendar:remove-event', async (_event, id: string) => {
    const vaultPath = getVaultPath();
    if (!vaultPath) throw new Error('Aucun vault sélectionné');
    const events = readEvents(vaultPath).filter((ev) => ev.id !== id);
    return writeEvents(vaultPath, events);
  });
}
