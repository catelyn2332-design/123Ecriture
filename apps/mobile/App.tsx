import { StatusBar } from 'expo-status-bar';
import { useCallback, useRef, useState } from 'react';

import { AppShell, type NotesActions } from './components/AppShell';
import { CalendarScreen } from './components/CalendarScreen';
import { NotesScreen } from './components/NotesScreen';
import { PlaceholderScreen } from './components/PlaceholderScreen';
import { SettingsScreen } from './components/SettingsScreen';
import { TasksScreen } from './components/TasksScreen';
import { AuthProvider } from './lib/sync/AuthContext';
import { SyncStatusProvider } from './lib/sync/SyncStatusContext';
import { VaultsProvider } from './lib/sync/VaultsContext';
import { SECTIONS } from './navigation';
import { PreferencesProvider } from './preferences/PreferencesContext';

function Root() {
  const [activeId, setActiveId] = useState(SECTIONS[0].id);
  const activeSection = SECTIONS.find((section) => section.id === activeId) ?? SECTIONS[0];

  // Mécanisme partagé "ouvrir cet élément" depuis un autre écran (recherche
  // globale, palette de commandes, "Ouvrir la note du jour" du Calendrier —
  // une carte-note de Canvas, elle, s'ouvre directement DANS NotesScreen
  // puisque Canvas y est maintenant embarqué en tant que type de fichier,
  // plus besoin de ce mécanisme pour ce cas) : on bascule sur le bon onglet
  // ET on note QUOI ouvrir ; l'écran cible le consomme dans un effet dès que
  // ça change, puis prévient qu'il l'a fait pour qu'on le remette à null —
  // sinon rouvrir le même onglet sans repasser par ailleurs redéclencherait
  // l'ouverture à chaque fois. Trois champs PARALLÈLES (note/tâche/
  // évènement) plutôt qu'un `pendingOpen` discriminé unique : garde le
  // mécanisme historique `pendingOpenRelPath` intact (aucune régression sur
  // "Ouvrir la note du jour", déjà en prod) tout en l'étendant proprement
  // aux deux nouvelles cibles.
  const [pendingOpenRelPath, setPendingOpenRelPath] = useState<string | null>(null);
  const requestOpenNote = useCallback((relPath: string) => {
    setPendingOpenRelPath(relPath);
    setActiveId('notes');
  }, []);
  const clearPendingOpenNote = useCallback(() => setPendingOpenRelPath(null), []);

  const [pendingOpenTask, setPendingOpenTask] = useState<{ taskListId: string; taskId: string } | null>(null);
  const requestOpenTask = useCallback((taskListId: string, taskId: string) => {
    setPendingOpenTask({ taskListId, taskId });
    setActiveId('tasks');
  }, []);
  const clearPendingOpenTask = useCallback(() => setPendingOpenTask(null), []);

  const [pendingOpenCalendarDate, setPendingOpenCalendarDate] = useState<string | null>(null);
  const requestOpenCalendarDate = useCallback((date: string) => {
    setPendingOpenCalendarDate(date);
    setActiveId('calendar');
  }, []);
  const clearPendingOpenCalendarDate = useCallback(() => setPendingOpenCalendarDate(null), []);

  // "Nouvelle note"/"Nouveau dossier" pour CommandPalette.tsx (montée dans
  // AppShell.tsx, HORS de NotesScreen) — voir NotesScreen.tsx,
  // `onRegisterActions`. Une ref (pas un state) : sa valeur ne doit pas
  // déclencher de re-render de Root, seule CommandPalette la lit, au moment
  // où elle s'ouvre/se filtre.
  const notesActionsRef = useRef<NotesActions | null>(null);
  const registerNotesActions = useCallback((actions: NotesActions) => {
    notesActionsRef.current = actions;
  }, []);

  let content;
  if (activeId === 'notes') {
    content = (
      <NotesScreen
        pendingOpenRelPath={pendingOpenRelPath}
        onOpenedPendingNote={clearPendingOpenNote}
        onRequestOpenTask={requestOpenTask}
        onRequestOpenCalendarDate={requestOpenCalendarDate}
        onRegisterActions={registerNotesActions}
      />
    );
  } else if (activeId === 'tasks') {
    content = <TasksScreen pendingOpenTask={pendingOpenTask} onOpenedPendingTask={clearPendingOpenTask} />;
  } else if (activeId === 'calendar') {
    content = (
      <CalendarScreen
        onRequestOpenNote={requestOpenNote}
        pendingOpenDate={pendingOpenCalendarDate}
        onOpenedPendingDate={clearPendingOpenCalendarDate}
      />
    );
  } else if (activeId === 'settings') {
    content = <SettingsScreen />;
  } else {
    content = <PlaceholderScreen section={activeSection} />;
  }

  return (
    <>
      <AppShell
        sections={SECTIONS}
        activeId={activeId}
        onSelect={setActiveId}
        notesActionsRef={notesActionsRef}
        onRequestOpenNote={requestOpenNote}
        onRequestOpenTask={requestOpenTask}
        onRequestOpenCalendarDate={requestOpenCalendarDate}
      >
        {content}
      </AppShell>
      <StatusBar style="auto" />
    </>
  );
}

export default function App() {
  return (
    <PreferencesProvider>
      <AuthProvider>
        <VaultsProvider>
          {/* Après Auth/Vaults : la sync a besoin d'une session ET d'un
              coffre actif pour savoir s'il y a quoi que ce soit à
              synchroniser (voir SyncStatusContext.tsx). */}
          <SyncStatusProvider>
            <Root />
          </SyncStatusProvider>
        </VaultsProvider>
      </AuthProvider>
    </PreferencesProvider>
  );
}
