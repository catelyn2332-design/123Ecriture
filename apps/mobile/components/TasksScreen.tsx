import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { useVaults } from '../lib/sync/VaultsContext';
import { usePreferences } from '../preferences/PreferencesContext';
import { DraftTextField } from './DraftTextField';

// Écran Tâches — module de productivité (voir docs/ARCHITECTURE.md §8).
// Stocké dans le vault (.123ecriture/tasks.json + tasklists.json, voir
// apps/desktop/electron/tasks.ts) — chaque coffre a son propre jeu de
// LISTES nommées, chaque liste ses propres tâches. Une seule liste "active"
// à la fois, même logique que le coffre actif (voir VaultsContext).
//
// Refonte façon Microsoft To Do (voir .claude/References/Sources.md §3) :
// chaque tâche peut porter une description, des sous-étapes cochables et
// des pièces jointes, et son texte reste éditable après création — les 4
// manques que documentait l'ancienne version de ce commentaire sont
// comblés. Une tâche "à plat" (checkbox + texte) reste la vue par défaut ;
// cliquer son chevron déplie une "fiche" avec le reste, même idée que
// PropertiesPanel.tsx/OccurrencesPanel.tsx pour les notes.
type Props = {
  // Révélation d'une tâche demandée par un AUTRE écran (recherche globale,
  // palette de commandes — voir App.tsx, `requestOpenTask`) : bascule sur la
  // liste qui la contient puis déplie sa fiche. Même mécanique que
  // `pendingOpenRelPath` pour les notes (voir NotesScreen.tsx) —
  // `onOpenedPendingTask` prévient le parent une fois fait, pour qu'il
  // remette ce champ à null.
  pendingOpenTask?: { taskListId: string; taskId: string } | null;
  onOpenedPendingTask?: () => void;
};

export function TasksScreen({ pendingOpenTask, onOpenedPendingTask }: Props = {}) {
  const { theme } = usePreferences();
  const vault = typeof window !== 'undefined' ? window.vault : undefined;
  const tasksBridge = typeof window !== 'undefined' ? window.tasks : undefined;
  const taskListsBridge = typeof window !== 'undefined' ? window.taskLists : undefined;
  const contextMenuBridge = typeof window !== 'undefined' ? window.contextMenu : undefined;
  const { activeVaultPath: vaultPath } = useVaults();

  const [taskLists, setTaskLists] = useState<TaskList[]>([]);
  const [activeListId, setActiveListId] = useState<string | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [draft, setDraft] = useState('');
  const [addError, setAddError] = useState<string | null>(null);
  const [listActionError, setListActionError] = useState<string | null>(null);
  const [taskActionError, setTaskActionError] = useState<string | null>(null);
  const [renamingListId, setRenamingListId] = useState<string | null>(null);
  const [renameListDraft, setRenameListDraft] = useState('');
  const [showCreateListForm, setShowCreateListForm] = useState(false);
  const [createListDraft, setCreateListDraft] = useState('');
  // Une seule "fiche" de tâche dépliée à la fois — même idée que le rail
  // de RightSidebar.tsx, évite une liste qui s'étire dans tous les sens si
  // plusieurs tâches étaient dépliées en même temps.
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
  const [newSubtaskDraft, setNewSubtaskDraft] = useState('');

  const refreshTaskLists = useCallback(async () => {
    if (!taskListsBridge) return;
    const [lists, active] = await Promise.all([taskListsBridge.list(), taskListsBridge.getActive()]);
    setTaskLists(lists);
    setActiveListId(active);
  }, [taskListsBridge]);

  const refreshTasks = useCallback(async () => {
    if (!tasksBridge) return;
    setTasks(await tasksBridge.list());
  }, [tasksBridge]);

  useEffect(() => {
    if (!vault || !vaultPath || !taskListsBridge) return;
    void (async () => {
      try {
        await refreshTaskLists();
      } catch (error) {
        console.error('[tasklists] échec du chargement initial :', error);
      }
    })();
    const unsubscribe = taskListsBridge.onChanged((lists) => {
      setTaskLists(lists);
      void taskListsBridge.getActive().then(setActiveListId);
    });
    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vault, vaultPath, taskListsBridge]);

  useEffect(() => {
    if (!vault || !vaultPath || !activeListId) return;
    void (async () => {
      try {
        await refreshTasks();
      } catch (error) {
        console.error('[tasks] échec du chargement :', error);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vault, vaultPath, activeListId]);

  // Révèle une tâche demandée par un AUTRE écran (voir Props ci-dessus) —
  // bascule d'abord sur SA liste si ce n'est pas déjà la liste active
  // (`taskListsBridge.switch`, l'effet ci-dessus rechargera alors `tasks`
  // via le changement d'`activeListId`), puis déplie sa fiche. Compare à
  // `activeListId` lu à l'exécution (pas dans les deps) : ce qui compte est
  // l'état COURANT au moment de la demande, pas de re-déclencher cet effet
  // à chaque changement de liste par ailleurs.
  useEffect(() => {
    if (!pendingOpenTask || !taskListsBridge) return;
    void (async () => {
      try {
        if (pendingOpenTask.taskListId !== activeListId) {
          setTaskLists(await taskListsBridge.switch(pendingOpenTask.taskListId));
          setActiveListId(pendingOpenTask.taskListId);
        }
        setExpandedTaskId(pendingOpenTask.taskId);
      } catch (error) {
        console.error('[tasks] échec de la révélation de la tâche demandée :', error);
      } finally {
        onOpenedPendingTask?.();
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingOpenTask, taskListsBridge]);

  const handleChooseFolder = async () => {
    if (!vault) return;
    try {
      await vault.chooseFolder();
    } catch (error) {
      console.error('[vault] échec du choix de dossier :', error);
    }
  };

  const runListAction = useCallback(async (action: () => Promise<void>) => {
    setListActionError(null);
    try {
      await action();
    } catch (error) {
      console.error('[tasklists] échec :', error);
      setListActionError(error instanceof Error ? error.message : String(error));
    }
  }, []);

  // Même idée que runListAction, pour les actions sur une tâche/sous-étape/
  // pièce jointe — regroupées ici puisqu'elles suivent toutes le même
  // schéma (appel bridge → `setTasks` du résultat → erreur visible).
  const runTaskAction = useCallback(async (action: () => Promise<Task[]>) => {
    setTaskActionError(null);
    try {
      setTasks(await action());
    } catch (error) {
      console.error('[tasks] échec :', error);
      setTaskActionError(error instanceof Error ? error.message : String(error));
    }
  }, []);

  const handleSwitchList = useCallback(
    (id: string) => runListAction(async () => {
      if (!taskListsBridge) return;
      setTaskLists(await taskListsBridge.switch(id));
      setActiveListId(id);
    }),
    [taskListsBridge, runListAction],
  );

  const submitCreateList = useCallback(async () => {
    const name = createListDraft.trim();
    if (!name || !taskListsBridge) return;
    setShowCreateListForm(false);
    setCreateListDraft('');
    await runListAction(async () => {
      setTaskLists(await taskListsBridge.create(name));
      setActiveListId(await taskListsBridge.getActive());
    });
  }, [createListDraft, taskListsBridge, runListAction]);

  const startRenameList = useCallback((list: TaskList) => {
    setRenamingListId(list.id);
    setRenameListDraft(list.name);
  }, []);

  const submitRenameList = useCallback(async () => {
    if (!renamingListId || !taskListsBridge) return;
    const id = renamingListId;
    const name = renameListDraft;
    setRenamingListId(null);
    await runListAction(async () => {
      setTaskLists(await taskListsBridge.rename(id, name));
    });
  }, [renamingListId, renameListDraft, taskListsBridge, runListAction]);

  const handleRemoveList = useCallback(
    (id: string) => runListAction(async () => {
      if (!taskListsBridge) return;
      setTaskLists(await taskListsBridge.remove(id));
      setActiveListId(await taskListsBridge.getActive());
    }),
    [taskListsBridge, runListAction],
  );

  const showListSwitcher = useCallback(() => {
    if (!contextMenuBridge) return;
    const items = [
      ...taskLists.map((list) => ({
        id: list.id,
        label: list.id === activeListId ? `✅ ${list.name}` : list.name,
      })),
      { id: '__new__', label: '➕ Nouvelle liste' },
    ];
    void contextMenuBridge.show(items).then((choice) => {
      if (!choice) return;
      if (choice === '__new__') {
        setShowCreateListForm(true);
        return;
      }
      void handleSwitchList(choice);
    });
  }, [contextMenuBridge, taskLists, activeListId, handleSwitchList]);

  const handleAddTask = useCallback(async () => {
    if (!tasksBridge) return;
    const text = draft.trim();
    if (!text) return;
    setAddError(null);
    try {
      setTasks(await tasksBridge.add(text));
      setDraft('');
    } catch (error) {
      console.error('[tasks] échec de l’ajout :', error);
      setAddError(error instanceof Error ? error.message : String(error));
    }
  }, [tasksBridge, draft]);

  const handleToggleTask = useCallback(
    (id: string) => runTaskAction(async () => {
      if (!tasksBridge) return tasks;
      return tasksBridge.toggle(id);
    }),
    [tasksBridge, runTaskAction, tasks],
  );

  const handleRemoveTask = useCallback(
    (id: string) => runTaskAction(async () => {
      if (!tasksBridge) return tasks;
      if (expandedTaskId === id) setExpandedTaskId(null);
      return tasksBridge.remove(id);
    }),
    [tasksBridge, runTaskAction, tasks, expandedTaskId],
  );

  const handleRenameTask = useCallback(
    (id: string, text: string) => runTaskAction(async () => {
      if (!tasksBridge) return tasks;
      return tasksBridge.update(id, { text });
    }),
    [tasksBridge, runTaskAction, tasks],
  );

  const handleChangeDescription = useCallback(
    (id: string, description: string) => runTaskAction(async () => {
      if (!tasksBridge) return tasks;
      return tasksBridge.update(id, { description });
    }),
    [tasksBridge, runTaskAction, tasks],
  );

  const handleAddSubtask = useCallback(
    async (taskId: string) => {
      const text = newSubtaskDraft.trim();
      if (!text || !tasksBridge) return;
      setNewSubtaskDraft('');
      await runTaskAction(() => tasksBridge.addSubtask(taskId, text));
    },
    [newSubtaskDraft, tasksBridge, runTaskAction],
  );

  const handleRenameSubtask = useCallback(
    (taskId: string, subtaskId: string, text: string) =>
      runTaskAction(async () => {
        if (!tasksBridge) return tasks;
        return tasksBridge.renameSubtask(taskId, subtaskId, text);
      }),
    [tasksBridge, runTaskAction, tasks],
  );

  const handleToggleSubtask = useCallback(
    (taskId: string, subtaskId: string) =>
      runTaskAction(async () => {
        if (!tasksBridge) return tasks;
        return tasksBridge.toggleSubtask(taskId, subtaskId);
      }),
    [tasksBridge, runTaskAction, tasks],
  );

  const handleRemoveSubtask = useCallback(
    (taskId: string, subtaskId: string) =>
      runTaskAction(async () => {
        if (!tasksBridge) return tasks;
        return tasksBridge.removeSubtask(taskId, subtaskId);
      }),
    [tasksBridge, runTaskAction, tasks],
  );

  // Réutilise le bridge vault GÉNÉRIQUE d'import de pièce jointe (voir
  // NotesScreen.tsx, `handleInsertAttachment`) — pas de mécanisme d'import
  // séparé pour les tâches, juste un ajout du `{relPath, name}` résultant
  // sur la tâche (voir tasks.ts, `tasks:add-attachment`).
  const handleAddAttachment = useCallback(
    async (taskId: string) => {
      if (!vault || !tasksBridge) return;
      try {
        const result = await vault.importAttachment();
        if (!result) return; // dialogue annulé
        await runTaskAction(() => tasksBridge.addAttachment(taskId, result));
      } catch (error) {
        console.error('[tasks] échec de l’ajout de la pièce jointe :', error);
        setTaskActionError(error instanceof Error ? error.message : String(error));
      }
    },
    [vault, tasksBridge, runTaskAction],
  );

  const handleRemoveAttachment = useCallback(
    (taskId: string, relPath: string) =>
      runTaskAction(async () => {
        if (!tasksBridge) return tasks;
        return tasksBridge.removeAttachment(taskId, relPath);
      }),
    [tasksBridge, runTaskAction, tasks],
  );

  if (!vault || !tasksBridge) {
    return (
      <View style={styles.centered}>
        <Text style={[styles.title, { color: theme.text }]}>✅ Tâches</Text>
        <Text style={[styles.muted, { color: theme.textMuted }]}>
          Disponible sur la version desktop pour l’instant (Phase 2 pour mobile/web).
        </Text>
      </View>
    );
  }

  if (!vaultPath) {
    return (
      <View style={styles.centered}>
        <Text style={[styles.title, { color: theme.text }]}>✅ Tâches</Text>
        <Text style={[styles.muted, { color: theme.textMuted }]}>
          Choisis un dossier local pour en faire ton vault (le même que pour tes notes).
        </Text>
        <Pressable
          onPress={() => void handleChooseFolder()}
          style={[styles.button, { backgroundColor: theme.accent }]}
        >
          <Text style={styles.buttonText}>Choisir un dossier</Text>
        </Pressable>
      </View>
    );
  }

  const activeList = taskLists.find((l) => l.id === activeListId) ?? null;
  const isRenamingActiveList = renamingListId === activeListId;

  const pending = tasks.filter((task) => !task.done);
  const done = tasks.filter((task) => task.done);

  const renderTask = (task: Task) => {
    const isExpanded = expandedTaskId === task.id;
    const doneSubtasks = task.subtasks.filter((s) => s.done).length;

    return (
      <View key={task.id} style={[styles.taskCard, { borderColor: theme.border }]}>
        <View style={styles.taskRow}>
          <Pressable
            onPress={() => void handleToggleTask(task.id)}
            style={[
              styles.checkbox,
              { borderColor: theme.border },
              task.done && { backgroundColor: theme.accent, borderColor: theme.accent },
            ]}
          >
            {task.done && <Text style={styles.checkboxMark}>✓</Text>}
          </Pressable>
          <DraftTextField
            initialValue={task.text}
            onCommit={(text) => text.trim() && void handleRenameTask(task.id, text.trim())}
            theme={theme}
            style={[
              styles.taskTextInput,
              { color: task.done ? theme.textMuted : theme.text },
              task.done && styles.taskTextDone,
            ] as unknown as object}
          />
          {task.subtasks.length > 0 && (
            <Text style={[styles.subtaskBadge, { color: theme.textMuted, borderColor: theme.border }]}>
              {doneSubtasks}/{task.subtasks.length}
            </Text>
          )}
          <Pressable
            onPress={() => setExpandedTaskId(isExpanded ? null : task.id)}
            style={styles.chevronButton}
            accessibilityLabel={isExpanded ? 'Masquer les détails' : 'Afficher les détails'}
          >
            <Text style={{ color: theme.textMuted }}>{isExpanded ? '▾' : '▸'}</Text>
          </Pressable>
          <Pressable onPress={() => void handleRemoveTask(task.id)} style={styles.removeButton}>
            <Text style={{ color: theme.textMuted }}>✕</Text>
          </Pressable>
        </View>

        {isExpanded && (
          <View style={[styles.taskDetails, { borderColor: theme.border }]}>
            <Text style={[styles.detailLabel, { color: theme.textMuted }]}>Description</Text>
            <DraftTextField
              initialValue={task.description}
              onCommit={(text) => void handleChangeDescription(task.id, text)}
              placeholder="Ajouter une description…"
              multiline
              theme={theme}
              style={[styles.descriptionInput, { color: theme.text, borderColor: theme.border }] as unknown as object}
            />

            <Text style={[styles.detailLabel, { color: theme.textMuted }]}>Sous-étapes</Text>
            {task.subtasks.map((subtask) => (
              <View key={subtask.id} style={styles.subtaskRow}>
                <Pressable
                  onPress={() => void handleToggleSubtask(task.id, subtask.id)}
                  style={[
                    styles.checkboxSmall,
                    { borderColor: theme.border },
                    subtask.done && { backgroundColor: theme.accent, borderColor: theme.accent },
                  ]}
                >
                  {subtask.done && <Text style={styles.checkboxMarkSmall}>✓</Text>}
                </Pressable>
                <DraftTextField
                  initialValue={subtask.text}
                  onCommit={(text) => text.trim() && void handleRenameSubtask(task.id, subtask.id, text.trim())}
                  theme={theme}
                  style={[
                    styles.subtaskTextInput,
                    { color: subtask.done ? theme.textMuted : theme.text },
                    subtask.done && styles.taskTextDone,
                  ] as unknown as object}
                />
                <Pressable onPress={() => void handleRemoveSubtask(task.id, subtask.id)} style={styles.removeButton}>
                  <Text style={{ color: theme.textMuted }}>✕</Text>
                </Pressable>
              </View>
            ))}
            <View style={styles.addRow}>
              <TextInput
                value={newSubtaskDraft}
                onChangeText={setNewSubtaskDraft}
                onSubmitEditing={() => void handleAddSubtask(task.id)}
                placeholder="Nouvelle sous-étape…"
                placeholderTextColor={theme.textMuted}
                style={[styles.input, { color: theme.text, borderColor: theme.border }]}
              />
              <Pressable
                onPress={() => void handleAddSubtask(task.id)}
                style={[styles.addButton, { backgroundColor: theme.accent }]}
              >
                <Text style={styles.buttonText}>Ajouter</Text>
              </Pressable>
            </View>

            <Text style={[styles.detailLabel, { color: theme.textMuted }]}>Pièces jointes</Text>
            {task.attachments.map((attachment) => (
              <View key={attachment.relPath} style={styles.attachmentChip}>
                <Text style={[styles.attachmentName, { color: theme.text }]} numberOfLines={1}>
                  📎 {attachment.name}
                </Text>
                <Pressable onPress={() => void handleRemoveAttachment(task.id, attachment.relPath)}>
                  <Text style={{ color: theme.textMuted }}>✕</Text>
                </Pressable>
              </View>
            ))}
            <Pressable onPress={() => void handleAddAttachment(task.id)} style={styles.addAttachmentButton}>
              <Text style={{ color: theme.accent, fontSize: 12 }}>📎 Joindre un fichier</Text>
            </Pressable>
          </View>
        )}
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.listHeaderRow}>
        {isRenamingActiveList ? (
          <TextInput
            autoFocus
            value={renameListDraft}
            onChangeText={setRenameListDraft}
            onSubmitEditing={() => void submitRenameList()}
            onBlur={() => void submitRenameList()}
            style={[styles.listNameInput, { color: theme.text, borderColor: theme.accent }]}
          />
        ) : (
          <Pressable onPress={showListSwitcher} style={styles.listSwitcher}>
            <Text style={[styles.listName, { color: theme.text }]} numberOfLines={1}>
              📋 {activeList ? activeList.name : 'Aucune liste'} {taskLists.length > 0 ? '▾' : ''}
            </Text>
          </Pressable>
        )}
        {activeList && !isRenamingActiveList && (
          <>
            <Pressable onPress={() => startRenameList(activeList)} style={styles.listHeaderAction}>
              <Text style={{ color: theme.textMuted }}>✏️</Text>
            </Pressable>
            <Pressable onPress={() => void handleRemoveList(activeList.id)} style={styles.listHeaderAction}>
              <Text style={{ color: theme.textMuted }}>🗑️</Text>
            </Pressable>
          </>
        )}
        {!activeList && (
          <Pressable
            onPress={() => setShowCreateListForm((prev) => !prev)}
            style={[styles.button, styles.smallButton, { backgroundColor: theme.accent }]}
          >
            <Text style={styles.buttonText}>Nouvelle liste</Text>
          </Pressable>
        )}
      </View>

      {showCreateListForm && (
        <View style={styles.addRow}>
          <TextInput
            autoFocus
            value={createListDraft}
            onChangeText={setCreateListDraft}
            onSubmitEditing={() => void submitCreateList()}
            placeholder="Nom de la liste…"
            placeholderTextColor={theme.textMuted}
            style={[styles.input, { color: theme.text, borderColor: theme.border }]}
          />
          <Pressable
            onPress={() => void submitCreateList()}
            style={[styles.addButton, { backgroundColor: theme.accent }]}
          >
            <Text style={styles.buttonText}>Créer</Text>
          </Pressable>
        </View>
      )}
      {listActionError && <Text style={styles.error}>⚠️ {listActionError}</Text>}
      {taskActionError && <Text style={styles.error}>⚠️ {taskActionError}</Text>}

      {!activeList ? (
        <Text style={[styles.muted, { color: theme.textMuted }]}>
          Aucune liste pour l’instant — crées-en une pour commencer.
        </Text>
      ) : (
        <>
          <View style={styles.addRow}>
            <TextInput
              value={draft}
              onChangeText={(text) => {
                setDraft(text);
                if (addError) setAddError(null);
              }}
              onSubmitEditing={() => void handleAddTask()}
              placeholder="Nouvelle tâche…"
              placeholderTextColor={theme.textMuted}
              style={[styles.input, { color: theme.text, borderColor: theme.border }]}
            />
            <Pressable
              onPress={() => void handleAddTask()}
              style={[styles.addButton, { backgroundColor: theme.accent }]}
            >
              <Text style={styles.buttonText}>Ajouter</Text>
            </Pressable>
          </View>
          {addError && <Text style={styles.error}>⚠️ {addError}</Text>}

          <ScrollView contentContainerStyle={styles.list}>
            {[...pending, ...done].map(renderTask)}
            {tasks.length === 0 && (
              <Text style={[styles.muted, { color: theme.textMuted }]}>Aucune tâche pour l’instant.</Text>
            )}
          </ScrollView>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
    maxWidth: 560,
    width: '100%',
    alignSelf: 'center',
    gap: 16,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    gap: 12,
  },
  title: {
    fontSize: 22,
    fontWeight: '600',
  },
  muted: {
    fontSize: 14,
    textAlign: 'center',
    maxWidth: 360,
  },
  button: {
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 8,
  },
  smallButton: {
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  buttonText: {
    color: '#fff',
    fontWeight: '600',
  },
  listHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  listSwitcher: {
    flex: 1,
    paddingVertical: 4,
  },
  listName: {
    fontSize: 18,
    fontWeight: '600',
  },
  listNameInput: {
    flex: 1,
    fontSize: 18,
    fontWeight: '600',
    borderBottomWidth: 1,
    paddingVertical: 2,
  },
  listHeaderAction: {
    paddingHorizontal: 6,
    paddingVertical: 4,
  },
  addRow: {
    flexDirection: 'row',
    gap: 8,
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    fontSize: 14,
  },
  addButton: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
    justifyContent: 'center',
  },
  list: {
    gap: 8,
  },
  taskCard: {
    borderWidth: 1,
    borderRadius: 8,
  },
  taskRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
    paddingHorizontal: 10,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 4,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxMark: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
  // `flex:1` + bordure transparente par défaut (cohérent visuellement avec
  // le reste de la ligne) : le champ ne se distingue d'un simple <Text>
  // qu'au focus, où `DraftTextField`/react-native-web affiche le curseur —
  // pas besoin d'un style "mode édition" séparé.
  taskTextInput: {
    flex: 1,
    fontSize: 14,
    paddingVertical: 2,
  },
  taskTextDone: {
    textDecorationLine: 'line-through',
  },
  subtaskBadge: {
    fontSize: 11,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  chevronButton: {
    paddingHorizontal: 4,
  },
  removeButton: {
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  taskDetails: {
    borderTopWidth: 1,
    padding: 10,
    gap: 6,
  },
  detailLabel: {
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    marginTop: 4,
  },
  descriptionInput: {
    borderWidth: 1,
    borderRadius: 6,
    paddingVertical: 6,
    paddingHorizontal: 8,
    fontSize: 13,
    minHeight: 60,
  },
  subtaskRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  checkboxSmall: {
    width: 16,
    height: 16,
    borderRadius: 4,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxMarkSmall: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '700',
  },
  subtaskTextInput: {
    flex: 1,
    fontSize: 13,
  },
  attachmentChip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  attachmentName: {
    fontSize: 13,
    flex: 1,
  },
  addAttachmentButton: {
    paddingVertical: 4,
  },
  error: {
    color: '#dc2626',
    fontSize: 13,
  },
});
