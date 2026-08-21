import { useCallback, useEffect, useState } from 'react';

// Accès au schéma global de propriétés (`.123ecriture/properties.json`,
// voir apps/desktop/electron/properties.ts) — partagé par
// PropertiesPanel.tsx, PropertiesBlock.tsx (lecture seule, `list`) et
// settings/PropertiesManagementSection.tsx (CRUD complet), pour ne pas
// recharger/dupliquer la même logique de rafraîchissement à 3 endroits.
export function usePropertyDefinitions() {
  const bridge = typeof window !== 'undefined' ? window.properties : undefined;
  const [definitions, setDefinitions] = useState<PropertyDefinition[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!bridge) return;
    setDefinitions(await bridge.list());
  }, [bridge]);

  useEffect(() => {
    void (async () => {
      try {
        await refresh();
      } catch (err) {
        console.error('[properties] échec du chargement initial :', err);
      }
    })();
  }, [refresh]);

  const runAction = useCallback(async (action: () => Promise<PropertyDefinition[]>) => {
    setError(null);
    try {
      setDefinitions(await action());
    } catch (err) {
      console.error('[properties] échec :', err);
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const create = useCallback(
    (name: string, type: PropertyType, options?: string[]) => {
      if (!bridge) return Promise.resolve();
      return runAction(() => bridge.create(name, type, options));
    },
    [bridge, runAction],
  );

  // À part de `create`/`remove` (via runAction ci-dessus) : `update` peut
  // renommer une propriété, ce qui déclenche côté Electron une migration du
  // frontmatter de toutes les notes concernées (voir properties.ts,
  // `migrateRenamedPropertyInVault`) — le résumé de cette migration est
  // renvoyé à l'appelant (PropertiesManagementSection.tsx) pour affichage,
  // plutôt qu'un simple "OK" silencieux qui masquerait des notes non
  // migrées (CLAUDE.md, "sauvegarde et gestion des données"). `undefined`
  // = pas de renommage effectif dans cet appel (ex. changement de type/
  // options seul), ou bridge absent/erreur.
  const update = useCallback(
    async (id: string, patch: PropertyPatch): Promise<PropertyRenameMigrationSummary | undefined> => {
      if (!bridge) return undefined;
      setError(null);
      try {
        const result = await bridge.update(id, patch);
        setDefinitions(result.properties);
        return result.migration;
      } catch (err) {
        console.error('[properties] échec :', err);
        setError(err instanceof Error ? err.message : String(err));
        return undefined;
      }
    },
    [bridge],
  );

  const remove = useCallback(
    (id: string) => {
      if (!bridge) return Promise.resolve();
      return runAction(() => bridge.remove(id));
    },
    [bridge, runAction],
  );

  return { bridge, definitions, error, create, update, remove };
}
