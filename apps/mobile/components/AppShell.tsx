import { useEffect, useState, type ReactNode, type RefObject } from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import type { Section } from '../navigation';
import { useResizablePanel } from '../lib/useResizablePanel';
import { useSyncStatus } from '../lib/sync/SyncStatusContext';
import { usePreferences } from '../preferences/PreferencesContext';
import { CommandPalette } from './CommandPalette';
import { ResizeHandle } from './ResizeHandle';
import { VaultSwitcher } from './VaultSwitcher';

// Coquille de navigation générale de l'app : panneau de sections (Notes,
// Tâches, Calendrier...) + zone de contenu. Bascule automatiquement entre
// barre latérale (écrans larges : desktop/web/tablette) et barre d'onglets
// en bas (écrans étroits : téléphone) — un même composant pour toutes les
// plateformes, cohérent avec la vision « app multiplateforme » de
// docs/ARCHITECTURE.md. Présente sur TOUS les écrans (elle englobe
// `children`), c'est donc ici que vit le raccourci global Ctrl/Cmd+K de la
// palette de commandes (voir CommandPalette.tsx) — un seul écouteur clavier
// pour toute l'app plutôt qu'un par écran.
const WIDE_BREAKPOINT = 720;

// "Nouvelle note"/"Nouveau dossier" ne concernent que l'écran Notes (voir
// NotesScreen.tsx) — enregistrées par lui auprès de App.tsx dès qu'il est
// monté, pour que CommandPalette (montée ICI, HORS de NotesScreen) puisse
// les proposer/déclencher sans que ce composant-coquille n'ait besoin de
// connaître l'écran Notes en détail.
export type NotesActions = {
  createNote: () => void;
  createFolder: () => void;
};

type Props = {
  sections: Section[];
  activeId: string;
  onSelect: (id: string) => void;
  children: ReactNode;
  notesActionsRef: RefObject<NotesActions | null>;
  onRequestOpenNote: (relPath: string) => void;
  onRequestOpenTask: (taskListId: string, taskId: string) => void;
  onRequestOpenCalendarDate: (date: string) => void;
};

export function AppShell({
  sections,
  activeId,
  onSelect,
  children,
  notesActionsRef,
  onRequestOpenNote,
  onRequestOpenTask,
  onRequestOpenCalendarDate,
}: Props) {
  const { theme } = usePreferences();
  const { width } = useWindowDimensions();
  const isWide = width >= WIDE_BREAKPOINT;
  // Redimensionnable/repliable au curseur (voir lib/useResizablePanel.ts) —
  // seulement pertinent en mode barre latérale large ; en mode barre
  // d'onglets (étroit), la nav n'a pas de largeur à faire varier.
  const navPanel = useResizablePanel('nav', { min: 72, max: 360, edge: 1 });

  // Ctrl/Cmd+K global (n'importe quel écran) — dégradé gracieusement si
  // `window` n'existe pas (mobile natif, pas de clavier physique standard).
  // Cmd sur macOS, Ctrl ailleurs — même détection que le reste de l'app pour
  // les raccourcis (voir MdxEditor.tsx, `shortcuts`).
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const isMac = /Mac|iPhone|iPad/.test(navigator.platform ?? '');
    const handleKeyDown = (event: KeyboardEvent) => {
      const modifierPressed = isMac ? event.metaKey : event.ctrlKey;
      if (!modifierPressed || event.key.toLowerCase() !== 'k') return;
      event.preventDefault();
      setCommandPaletteOpen((open) => !open);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const nav = (
    <View
      style={[
        isWide ? [styles.sidebar, { width: navPanel.width }] : styles.tabBar,
        { backgroundColor: theme.surface, borderColor: theme.border },
      ]}
    >
      {isWide && <VaultSwitcher />}
      {isWide && <SyncStatusChip />}
      {sections.map((section) => {
        const isActive = section.id === activeId;
        return (
          <Pressable
            key={section.id}
            onPress={() => onSelect(section.id)}
            style={[
              isWide ? styles.navItemWide : styles.navItemNarrow,
              isActive && { backgroundColor: `${theme.accent}22` },
            ]}
          >
            <Text style={styles.navIcon}>{section.icon}</Text>
            <Text
              style={[
                styles.navLabel,
                { color: isActive ? theme.accent : theme.textMuted },
                !isWide && styles.navLabelNarrow,
              ]}
            >
              {section.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );

  return (
    <View
      style={[styles.root, { backgroundColor: theme.background }, isWide ? styles.rowLayout : styles.columnLayout]}
    >
      {isWide && (
        <>
          <View style={styles.sidebarClip}>{nav}</View>
          <ResizeHandle
            theme={theme}
            side="left"
            collapsed={navPanel.collapsed}
            isDragging={navPanel.isDragging}
            onMouseDown={navPanel.onHandleMouseDown}
            onToggleCollapsed={navPanel.toggleCollapsed}
          />
        </>
      )}
      {/* Vue simple (pas de ScrollView) : chaque écran gère son propre
          scroll interne (NotesScreen.tsx a déjà le sien pour l'explorateur
          ET pour l'éditeur, SettingsScreen.tsx/CalendarScreen.tsx idem) —
          un ScrollView imbriquant un autre ScrollView casse la chaîne
          flex:1 dont dépend un scroll indépendant sur le web : c'était le
          scroll EXTÉRIEUR ici qui captait la molette au lieu du scroll
          propre à l'explorateur de fichiers. Vérifié : seul
          PlaceholderScreen.tsx n'a aucun ScrollView à lui (texte centré,
          n'en a jamais eu besoin) — rien ne dépendait de celui-ci. */}
      <View style={styles.content}>{children}</View>
      {!isWide && (
        <View style={[styles.narrowSyncRow, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <SyncStatusChip compact />
        </View>
      )}
      {!isWide && nav}

      {commandPaletteOpen && (
        <CommandPalette
          theme={theme}
          sections={sections}
          activeId={activeId}
          onSelect={onSelect}
          notesActionsRef={notesActionsRef}
          onRequestOpenNote={onRequestOpenNote}
          onRequestOpenTask={onRequestOpenTask}
          onRequestOpenCalendarDate={onRequestOpenCalendarDate}
          onClose={() => setCommandPaletteOpen(false)}
        />
      )}
    </View>
  );
}

// Puce de statut de synchro globale — voir SyncStatusContext.tsx. N'affiche
// RIEN tant qu'aucun coffre cloud n'est effectivement lié (cloudSyncConfigured
// à `false`) : avant ça, un "Non synchronisé" permanent n'aurait aucun sens
// puisque rien n'est configuré (même garde-fou que AccountSyncSection.tsx).
// `compact` (barre du bas, écrans étroits) masque le libellé texte et ne
// garde que l'icône, pour ne pas déborder d'une barre déjà dense.
function SyncStatusChip({ compact }: { compact?: boolean }) {
  const { theme } = usePreferences();
  const syncStatus = useSyncStatus();

  if (!syncStatus.cloudSyncConfigured) return null;

  let icon = '○';
  let label = 'Non synchronisé';
  let color = theme.textMuted;

  if (syncStatus.status === 'syncing') {
    icon = '⟳';
    label = 'Synchronisation…';
    color = theme.accent;
  } else if (syncStatus.status === 'error') {
    icon = '⚠';
    label = 'Erreur de sync';
    color = SYNC_WARNING_COLOR;
  } else if (syncStatus.status === 'success' && syncStatus.lastSyncedAt) {
    if (syncStatus.lastConflicts > 0) {
      icon = '⚠';
      label = `${syncStatus.lastConflicts} conflit(s)`;
      color = SYNC_WARNING_COLOR;
    } else {
      const synced = new Date(syncStatus.lastSyncedAt);
      const hh = String(synced.getHours()).padStart(2, '0');
      const mm = String(synced.getMinutes()).padStart(2, '0');
      icon = '✓';
      label = `Synchronisé à ${hh}:${mm}`;
      color = theme.textMuted;
    }
  }

  return (
    <Pressable
      onPress={() => void syncStatus.runSync()}
      style={[styles.syncChip, compact && styles.syncChipCompact]}
      accessibilityLabel={label}
    >
      <Text style={[styles.syncChipIcon, { color }]}>{icon}</Text>
      {!compact && (
        <Text style={[styles.syncChipLabel, { color }]} numberOfLines={1}>
          {label}
        </Text>
      )}
    </Pressable>
  );
}

// Même rouge que settingsStyles.error (#dc2626) — pas de token dédié
// "erreur"/"danger" dans theme.ts pour l'instant (voir theme.ts, encore
// minimal), donc réutilisation littérale plutôt qu'invention d'une nouvelle
// couleur ad hoc.
const SYNC_WARNING_COLOR = '#dc2626';

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  rowLayout: {
    flexDirection: 'row',
  },
  columnLayout: {
    flexDirection: 'column',
  },
  // `overflow: hidden` : masque proprement le contenu de la nav pendant
  // qu'elle se réduit vers 0 au glisser/repli, plutôt que de le laisser
  // déborder par-dessus le contenu principal.
  sidebarClip: {
    overflow: 'hidden',
  },
  sidebar: {
    width: 220,
    borderRightWidth: 1,
    paddingVertical: 16,
  },
  tabBar: {
    flexDirection: 'row',
    borderTopWidth: 1,
    paddingVertical: 8,
    justifyContent: 'space-around',
  },
  navItemWide: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    marginHorizontal: 8,
  },
  navItemNarrow: {
    alignItems: 'center',
    gap: 2,
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 8,
  },
  navIcon: {
    fontSize: 18,
  },
  navLabel: {
    fontSize: 14,
    fontWeight: '500',
  },
  navLabelNarrow: {
    fontSize: 11,
  },
  content: {
    flex: 1,
  },
  // Puce de statut de synchro — voir SyncStatusChip ci-dessus. Placée sous
  // VaultSwitcher en mode large (même colonne, même largeur).
  syncChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginHorizontal: 8,
    marginBottom: 8,
    paddingVertical: 4,
    paddingHorizontal: 10,
  },
  syncChipCompact: {
    marginHorizontal: 0,
    marginBottom: 0,
    paddingVertical: 2,
    paddingHorizontal: 0,
  },
  syncChipIcon: {
    fontSize: 13,
  },
  syncChipLabel: {
    flex: 1,
    fontSize: 11,
  },
  // Barre du bas, écrans étroits : rangée fine juste au-dessus des onglets
  // pour l'indicateur compact (icône seule) — évite de surcharger la
  // barre d'onglets elle-même, déjà dense (voir tabBar ci-dessus).
  narrowSyncRow: {
    alignItems: 'center',
    paddingVertical: 2,
    borderTopWidth: 1,
  },
});
