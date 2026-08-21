import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { useAuth } from '../../lib/sync/AuthContext';
import { useSyncStatus } from '../../lib/sync/SyncStatusContext';
import { linkVaultToCloud, runSync as runSyncEngine, type SyncSummary } from '../../lib/sync/syncEngine';
import { useVaults } from '../../lib/sync/VaultsContext';
import { usePreferences } from '../../preferences/PreferencesContext';
import { SettingsToggle } from './SettingsToggle';
import { settingsStyles as s } from './settingsStyles';

// Section "Compte et synchronisation" — Compte (Google/Supabase) et Coffres
// multiples + sync cloud, déplacés tels quels depuis l'ancien SettingsScreen
// plat. Dépendent de ponts exposés uniquement par Electron desktop
// (window.auth/window.vaults — voir apps/desktop/electron/preload.ts) ; sur
// web/mobile, la section explique pourquoi elle est vide plutôt que de
// disparaître silencieusement.
export function AccountSyncSection() {
  const { theme, preferences, setAutoSyncEnabled } = usePreferences();
  const auth = useAuth();
  const {
    vaults: vaultList,
    activeVaultId,
    switchVault,
    addExistingVault,
    createVault,
    renameVault,
    removeVault,
    setCloudLink,
  } = useVaults();
  const vault = typeof window !== 'undefined' ? window.vault : undefined;
  // Statut partagé (voir SyncStatusContext.tsx) — source de vérité pour le
  // coffre ACTIF, la même que l'indicateur global de AppShell.tsx. Les
  // autres coffres liés (non actifs) gardent leur propre state local
  // ci-dessous : le contexte ne suit que "le" coffre courant, comme
  // l'indicateur global qui n'a de sens que pour un seul coffre à la fois.
  const syncStatus = useSyncStatus();

  const [vaultActionError, setVaultActionError] = useState<string | null>(null);
  const [renamingVaultId, setRenamingVaultId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [createDraft, setCreateDraft] = useState('');
  const [syncingVaultId, setSyncingVaultId] = useState<string | null>(null);
  const [syncResults, setSyncResults] = useState<Record<string, { summary?: SyncSummary; error?: string }>>({});

  const runVaultAction = useCallback(async (action: () => Promise<void>) => {
    setVaultActionError(null);
    try {
      await action();
    } catch (error) {
      console.error('[vaults] échec :', error);
      setVaultActionError(error instanceof Error ? error.message : String(error));
    }
  }, []);

  const startRenameVault = (v: VaultRegistryEntry) => {
    setRenamingVaultId(v.id);
    setRenameDraft(v.name);
  };

  const submitRenameVault = useCallback(async () => {
    if (!renamingVaultId) return;
    const id = renamingVaultId;
    const name = renameDraft;
    setRenamingVaultId(null);
    await runVaultAction(() => renameVault(id, name));
  }, [renamingVaultId, renameDraft, renameVault, runVaultAction]);

  const submitCreateVault = useCallback(async () => {
    const name = createDraft.trim();
    if (!name) return;
    setShowCreateForm(false);
    setCreateDraft('');
    await runVaultAction(() => createVault(name));
  }, [createDraft, createVault, runVaultAction]);

  const handleLinkVault = useCallback(
    async (v: VaultRegistryEntry) => {
      if (!auth.user) return;
      setSyncResults((prev) => ({ ...prev, [v.id]: {} }));
      try {
        const remoteVaultId = await linkVaultToCloud(v.id, v.name, auth.user.id);
        await setCloudLink(v.id, { linked: true, remoteVaultId });
      } catch (error) {
        console.error('[sync] échec de la liaison au cloud :', error);
        setSyncResults((prev) => ({
          ...prev,
          [v.id]: { error: error instanceof Error ? error.message : String(error) },
        }));
      }
    },
    [auth.user, setCloudLink],
  );

  const handleSyncVault = useCallback(
    async (v: VaultRegistryEntry) => {
      if (!auth.user || !v.remoteVaultId) return;
      // Le coffre ACTIF partage son état avec l'indicateur global (voir
      // SyncStatusContext.tsx / AppShell.tsx) — on délègue à son runSync()
      // plutôt que de dupliquer l'appel à syncEngine ici, pour que les deux
      // affichages restent cohérents. Les coffres non actifs (rares :
      // syncable depuis Paramètres sans y être "dans"), eux, gardent
      // l'appel direct au moteur avec leur propre state local, comme avant.
      if (v.id === activeVaultId) {
        await syncStatus.runSync();
        return;
      }
      setSyncingVaultId(v.id);
      setSyncResults((prev) => ({ ...prev, [v.id]: {} }));
      try {
        const summary = await runSyncEngine(v.remoteVaultId, auth.user.id);
        setSyncResults((prev) => ({ ...prev, [v.id]: { summary } }));
      } catch (error) {
        console.error('[sync] échec de la synchronisation :', error);
        setSyncResults((prev) => ({
          ...prev,
          [v.id]: { error: error instanceof Error ? error.message : String(error) },
        }));
      } finally {
        setSyncingVaultId(null);
      }
    },
    [auth.user, activeVaultId, syncStatus],
  );

  if (!auth.available && !vault) {
    return (
      <Text style={[s.muted, { color: theme.textMuted }]}>
        Compte et coffres sont disponibles sur la version desktop pour l’instant.
      </Text>
    );
  }

  return (
    <View style={styles.stack}>
      {auth.available && (
        <View style={[s.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <Text style={[s.cardTitle, { color: theme.text }]}>Compte</Text>
          {auth.loading ? (
            <View style={s.statusRow}>
              <ActivityIndicator size="small" color={theme.accent} />
              <Text style={{ color: theme.textMuted }}>Vérification de la session…</Text>
            </View>
          ) : auth.user ? (
            <>
              <Text style={[s.cardValue, { color: theme.textMuted }]}>
                Connecté·e : {auth.user.email ?? auth.user.id}
              </Text>
              <Pressable onPress={() => void auth.signOut()} style={[s.button, { backgroundColor: theme.accent }]}>
                <Text style={s.buttonText}>Se déconnecter</Text>
              </Pressable>
            </>
          ) : (
            <Pressable
              onPress={() => void auth.signInWithGoogle()}
              style={[s.button, { backgroundColor: theme.accent }]}
            >
              <Text style={s.buttonText}>Se connecter avec Google</Text>
            </Pressable>
          )}
          {auth.error && <Text style={s.error}>⚠️ {auth.error}</Text>}
        </View>
      )}

      {vault && (
        <View style={[s.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <Text style={[s.cardTitle, { color: theme.text }]}>Coffres</Text>

          {vaultList.length === 0 && (
            <Text style={[s.cardValue, { color: theme.textMuted }]}>Aucun coffre pour l’instant.</Text>
          )}

          {vaultList.map((v) => {
            const isActive = v.id === activeVaultId;
            const isRenaming = renamingVaultId === v.id;
            return (
              <View key={v.id} style={[styles.vaultRow, { borderColor: theme.border }]}>
                <Pressable
                  onPress={() => !isActive && void runVaultAction(() => switchVault(v.id))}
                  style={styles.vaultRowMain}
                >
                  <Text style={styles.vaultCheck}>{isActive ? '✅' : '🗄️'}</Text>
                  {isRenaming ? (
                    <TextInput
                      autoFocus
                      value={renameDraft}
                      onChangeText={setRenameDraft}
                      onSubmitEditing={() => void submitRenameVault()}
                      onBlur={() => void submitRenameVault()}
                      style={[styles.vaultRenameInput, { color: theme.text, borderColor: theme.accent }]}
                    />
                  ) : (
                    <View>
                      <Text style={{ color: theme.text, fontWeight: isActive ? '600' : '400' }}>{v.name}</Text>
                      <Text style={[styles.vaultPathText, { color: theme.textMuted }]} numberOfLines={1}>
                        {v.path}
                      </Text>
                    </View>
                  )}
                </Pressable>
                {!isRenaming && (
                  <Pressable onPress={() => startRenameVault(v)} style={styles.vaultRowAction}>
                    <Text style={{ color: theme.textMuted }}>✏️</Text>
                  </Pressable>
                )}
                <Pressable onPress={() => void runVaultAction(() => removeVault(v.id))} style={styles.vaultRowAction}>
                  <Text style={{ color: theme.textMuted }}>✕</Text>
                </Pressable>
              </View>
            );
          })}

          {auth.user &&
            vaultList.map((v) => {
              const isActiveVault = v.id === activeVaultId;
              const isSyncing = isActiveVault ? syncStatus.status === 'syncing' : syncingVaultId === v.id;
              // Coffre actif : lit le résultat depuis le contexte partagé
              // (même source que l'indicateur global) plutôt que du state
              // local `syncResults`, qui ne sert plus qu'aux autres coffres.
              const result: { summary?: SyncSummary; error?: string } = isActiveVault
                ? { summary: syncStatus.lastSummary ?? undefined, error: syncStatus.lastError ?? undefined }
                : (syncResults[v.id] ?? {});
              return (
                <View key={`sync-${v.id}`} style={styles.syncRow}>
                  <Text style={[styles.vaultPathText, { color: theme.textMuted }]} numberOfLines={1}>
                    ☁️ {v.name}
                  </Text>
                  {!v.cloudLinked ? (
                    <Pressable
                      onPress={() => void handleLinkVault(v)}
                      style={[styles.syncButton, { backgroundColor: theme.accent }]}
                    >
                      <Text style={s.buttonText}>Lier ce coffre au cloud</Text>
                    </Pressable>
                  ) : (
                    <Pressable
                      onPress={() => !isSyncing && void handleSyncVault(v)}
                      style={[styles.syncButton, { backgroundColor: theme.accent, opacity: isSyncing ? 0.6 : 1 }]}
                    >
                      {isSyncing ? (
                        <ActivityIndicator size="small" color="#fff" />
                      ) : (
                        <Text style={s.buttonText}>Synchroniser maintenant</Text>
                      )}
                    </Pressable>
                  )}
                  {result?.summary && (
                    <Text style={[styles.vaultPathText, { color: theme.textMuted }]}>
                      {result.summary.pushed} envoyée(s), {result.summary.pulled} reçue(s),{' '}
                      {result.summary.conflicts} conflit(s)
                      {result.summary.errors.length > 0 ? ` — ${result.summary.errors.length} erreur(s)` : ''}
                    </Text>
                  )}
                  {result?.error && <Text style={s.error}>⚠️ {result.error}</Text>}
                </View>
              );
            })}

          {/* Synchro automatique — voir SyncStatusContext.tsx pour le
              déclenchement réel (démarrage + intervalle). Visible dès qu'un
              compte est connecté, même sans coffre lié pour l'instant :
              c'est une préférence globale, pas propre à un coffre — elle
              s'appliquera dès qu'un coffre sera lié. */}
          {auth.user && (
            <View style={styles.autoSyncBlock}>
              <SettingsToggle
                label="Synchroniser automatiquement"
                value={preferences.autoSyncEnabled}
                onChange={(value) => void setAutoSyncEnabled(value)}
                theme={theme}
              />
              <Text style={[styles.autoSyncHint, { color: theme.textMuted }]}>
                Synchronise le coffre actif automatiquement au lancement de l’app et toutes les 15 minutes, en plus
                de « Synchroniser maintenant ».
              </Text>
            </View>
          )}

          {vaultActionError && <Text style={s.error}>⚠️ {vaultActionError}</Text>}

          <View style={styles.vaultButtonsRow}>
            <Pressable
              onPress={() => void runVaultAction(addExistingVault)}
              style={[s.button, { backgroundColor: theme.accent }]}
            >
              <Text style={s.buttonText}>Ajouter un dossier existant</Text>
            </Pressable>
            <Pressable
              onPress={() => setShowCreateForm((prev) => !prev)}
              style={[s.button, { backgroundColor: theme.accent }]}
            >
              <Text style={s.buttonText}>Nouveau coffre</Text>
            </Pressable>
          </View>

          {showCreateForm && (
            <View style={styles.vaultButtonsRow}>
              <TextInput
                autoFocus
                value={createDraft}
                onChangeText={setCreateDraft}
                onSubmitEditing={() => void submitCreateVault()}
                placeholder="Nom du nouveau coffre…"
                placeholderTextColor={theme.textMuted}
                style={[s.input, { color: theme.text, borderColor: theme.border }]}
              />
              <Pressable onPress={() => void submitCreateVault()} style={[s.button, { backgroundColor: theme.accent }]}>
                <Text style={s.buttonText}>Créer</Text>
              </Pressable>
            </View>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: {
    gap: 16,
  },
  vaultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 6,
    borderBottomWidth: 1,
  },
  vaultRowMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  vaultCheck: {
    fontSize: 14,
  },
  vaultPathText: {
    fontSize: 11,
  },
  vaultRenameInput: {
    flex: 1,
    borderBottomWidth: 1,
    paddingVertical: 2,
    fontSize: 14,
  },
  vaultRowAction: {
    paddingHorizontal: 6,
    paddingVertical: 4,
  },
  vaultButtonsRow: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
    alignItems: 'center',
  },
  syncRow: {
    gap: 6,
    paddingVertical: 6,
    paddingLeft: 8,
  },
  syncButton: {
    alignSelf: 'flex-start',
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 8,
    minWidth: 100,
    alignItems: 'center',
  },
  autoSyncBlock: {
    gap: 2,
    paddingTop: 4,
  },
  autoSyncHint: {
    fontSize: 11,
    marginLeft: 30,
  },
});
