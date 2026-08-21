import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { useAuth } from './AuthContext';
import { runSync as runSyncEngine, type SyncSummary } from './syncEngine';
import { useVaults } from './VaultsContext';
import { usePreferences } from '../../preferences/PreferencesContext';

// Statut de synchro PARTAGÉ entre l'indicateur global (AppShell.tsx, en-tête
// visible sur toutes les plateformes) et l'écran Paramètres → Compte et
// synchronisation (AccountSyncSection.tsx). Avant ce contexte, ce statut
// était un state local à AccountSyncSection : invisible ailleurs et
// réinitialisé à chaque montage de l'écran. Centraliser ici permet aussi de
// porter la synchro AUTOMATIQUE en option (voir effet plus bas), qui doit
// pouvoir se déclencher même quand Paramètres n'est pas affiché.
//
// Ne touche à AUCUNE logique de diff/conflit (lib/sync/diff.ts, intouché) —
// ce fichier ne fait qu'orchestrer QUAND `runSync` (syncEngine.ts) est
// appelé et où son résultat est affiché, exactement comme le faisait déjà
// AccountSyncSection avant ce changement.

export type SyncStatus = 'idle' | 'syncing' | 'success' | 'error';

type SyncStatusContextValue = {
  status: SyncStatus;
  // epoch ms du dernier succès (avec ou sans conflit) — `null` tant qu'aucun
  // cycle n'a réussi depuis le lancement de l'app.
  lastSyncedAt: number | null;
  // Résumé humain du dernier résultat, succès OU erreur — ce que
  // l'indicateur global et Paramètres affichent tous les deux tel quel.
  lastResultSummary: string | null;
  // Nombre de conflits du dernier cycle réussi — distingue "synchronisé
  // proprement" de "synchronisé, mais des conflits ont été résolus" pour
  // l'indicateur global (voir AppShell.tsx).
  lastConflicts: number;
  // Détail structuré du dernier résultat, réutilisé tel quel par
  // AccountSyncSection.tsx pour son affichage par coffre (même format que
  // l'ancien state local `syncResults[vaultId]`) sans reformater
  // `lastResultSummary`.
  lastSummary: SyncSummary | null;
  lastError: string | null;
  // Vrai seulement si une session est active ET que le coffre ACTUELLEMENT
  // ACTIF est lié au cloud — condition déjà utilisée par
  // AccountSyncSection.tsx (auth.user + v.remoteVaultId) pour décider quand
  // proposer "Synchroniser maintenant" ; réutilisée ici pour que
  // l'indicateur global (AppShell.tsx) n'affiche RIEN tant que rien n'est
  // configuré, plutôt qu'un "Non synchronisé" permanent qui n'aurait pas de
  // sens.
  cloudSyncConfigured: boolean;
  // Synchronise le coffre ACTIF (celui de `cloudSyncConfigured`). Ne fait
  // rien si aucun coffre actif n'est lié au cloud, ou si une synchro est
  // déjà en cours (protège aussi bien un double-clic que le chevauchement
  // manuel/auto).
  runSync: () => Promise<void>;
};

const SyncStatusReactContext = createContext<SyncStatusContextValue | null>(null);

// Intervalle de synchro automatique. 15 minutes : assez fréquent pour que
// les autres appareils/l'utilisatrice sur le web ne restent jamais très en
// retard, assez espacé pour ne pas multiplier les allers-retours Storage/
// table `vault_files` à chaque frappe. Ajustable plus tard si besoin, mais
// aucune raison objective de descendre plus bas pour une sync qui reste
// manuelle par défaut.
const AUTO_SYNC_INTERVAL_MS = 15 * 60 * 1000;

// Délai avant le PREMIER cycle auto au lancement de l'app — laisse le temps
// au reste de l'app (vault actif, session Supabase) de finir de se charger
// sans faire concurrence au démarrage perçu par l'utilisatrice.
const AUTO_SYNC_STARTUP_DELAY_MS = 5000;

function summarizeSuccess(summary: SyncSummary): string {
  const base = `${summary.pushed} envoyée(s), ${summary.pulled} reçue(s), ${summary.conflicts} conflit(s)`;
  return summary.errors.length > 0 ? `${base} — ${summary.errors.length} erreur(s)` : base;
}

export function SyncStatusProvider({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const { activeVault } = useVaults();
  const { preferences } = usePreferences();

  const [status, setStatus] = useState<SyncStatus>('idle');
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
  const [lastResultSummary, setLastResultSummary] = useState<string | null>(null);
  const [lastConflicts, setLastConflicts] = useState(0);
  const [lastSummary, setLastSummary] = useState<SyncSummary | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);

  const userId = auth.user?.id ?? null;
  const remoteVaultId = activeVault?.cloudLinked ? activeVault.remoteVaultId : null;
  const cloudSyncConfigured = Boolean(userId && remoteVaultId);

  // Empêche un cycle auto de démarrer par-dessus un cycle déjà en cours
  // (manuel ou auto) — un ref plutôt qu'un dérivé de `status` : `runSync`
  // doit voir l'état le plus frais possible au moment de l'appel, pas celui
  // capturé à la dernière fermeture de useCallback.
  const syncingRef = useRef(false);

  const runSync = useCallback(async () => {
    if (!userId || !remoteVaultId || syncingRef.current) return;
    syncingRef.current = true;
    setStatus('syncing');
    try {
      const summary = await runSyncEngine(remoteVaultId, userId);
      setLastSummary(summary);
      if (summary.errors.length > 0) {
        setStatus('error');
        setLastError(summary.errors[0]);
        setLastResultSummary(summarizeSuccess(summary));
      } else {
        setStatus('success');
        setLastError(null);
        setLastSyncedAt(Date.now());
        setLastConflicts(summary.conflicts);
        setLastResultSummary(summarizeSuccess(summary));
      }
    } catch (error) {
      console.error('[sync] échec de la synchronisation :', error);
      const message = error instanceof Error ? error.message : String(error);
      setStatus('error');
      setLastSummary(null);
      setLastError(message);
      setLastResultSummary(message);
    } finally {
      syncingRef.current = false;
    }
  }, [userId, remoteVaultId]);

  // Synchro automatique (Paramètres → Compte et synchronisation → "Synchro-
  // niser automatiquement") : STRICTEMENT rien si la préférence est fausse
  // (défaut) — un cycle après un court délai au montage/à la reconnexion du
  // coffre cloud, puis un cycle toutes les AUTO_SYNC_INTERVAL_MS. Les deux
  // timers sont nettoyés à chaque changement de dépendance pour ne jamais
  // en cumuler plusieurs (ex. changement de coffre actif pendant qu'un
  // délai de démarrage était encore en attente).
  useEffect(() => {
    if (!preferences.autoSyncEnabled || !cloudSyncConfigured) return;
    const startupTimeout = setTimeout(() => void runSync(), AUTO_SYNC_STARTUP_DELAY_MS);
    const interval = setInterval(() => void runSync(), AUTO_SYNC_INTERVAL_MS);
    return () => {
      clearTimeout(startupTimeout);
      clearInterval(interval);
    };
  }, [preferences.autoSyncEnabled, cloudSyncConfigured, runSync]);

  const value = useMemo<SyncStatusContextValue>(
    () => ({
      status,
      lastSyncedAt,
      lastResultSummary,
      lastConflicts,
      lastSummary,
      lastError,
      cloudSyncConfigured,
      runSync,
    }),
    [status, lastSyncedAt, lastResultSummary, lastConflicts, lastSummary, lastError, cloudSyncConfigured, runSync],
  );

  return <SyncStatusReactContext.Provider value={value}>{children}</SyncStatusReactContext.Provider>;
}

export function useSyncStatus(): SyncStatusContextValue {
  const ctx = useContext(SyncStatusReactContext);
  if (!ctx) {
    throw new Error('useSyncStatus() doit être appelé sous <SyncStatusProvider>');
  }
  return ctx;
}
