import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { usePropertyDefinitions } from '../../lib/usePropertyDefinitions';
import { TYPE_ICONS, TYPE_LABELS, TYPE_ORDER } from '../../lib/propertyTypes';
import { usePreferences } from '../../preferences/PreferencesContext';
import type { Theme } from '../../theme';
import { DraftTextField } from '../DraftTextField';
import { settingsStyles as s } from './settingsStyles';

// Paramètres → "Gestion des propriétés" — configuration du SCHÉMA global de
// propriétés typées (créer/renommer/changer de type/supprimer, et pour le
// type "Options" la liste des valeurs proposées). Anciennement la moitié
// basse de PropertiesPanel.tsx (barre latérale) ; déplacé ici pour que ce
// soit LE endroit où configurer les propriétés (voir demande utilisateur :
// dépasser Obsidian sur ce point précis), le panneau latéral et le bloc en
// haut de note (PropertiesBlock.tsx) ne font plus qu'éditer des valeurs.
// Renommer une définition migre la CLÉ de frontmatter dans les notes qui la
// portent déjà (voir migrateRenamedPropertyInVault, apps/desktop/electron/
// properties.ts) ; changer le type ou supprimer une définition, en
// revanche, ne touche jamais les valeurs déjà écrites — juste ce registre
// (voir le commentaire d'en-tête d'apps/desktop/electron/properties.ts).
function TypePicker({
  value,
  onSelect,
  theme,
  open,
  onToggle,
}: {
  value: PropertyType;
  onSelect: (type: PropertyType) => void;
  theme: Theme;
  open: boolean;
  // Levé au composant parent (voir PropertiesManagementSection ci-dessous)
  // plutôt qu'un state local à chaque instance : plusieurs propriétés dans
  // la liste, donc plusieurs TypePicker en même temps — sans exclusivité,
  // ouvrir le sélecteur d'une ligne puis celui d'une autre laissait les DEUX
  // popovers ouverts en même temps, chacun en `position: 'absolute'`, et ils
  // se chevauchaient visuellement avec les lignes voisines (bug rapporté :
  // "les boutons se rentrent dedans").
  onToggle: () => void;
}) {
  return (
    <View style={styles.typePickerWrap}>
      <Pressable onPress={onToggle} style={[styles.typeChip, { borderColor: theme.border }]}>
        <Text style={{ color: theme.textMuted, fontSize: 11 }}>
          {TYPE_ICONS[value]} {TYPE_LABELS[value]}
        </Text>
      </Pressable>
      {open && (
        <View style={[styles.typePopover, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          {TYPE_ORDER.map((type) => (
            <Pressable
              key={type}
              onPress={() => {
                onSelect(type);
                onToggle();
              }}
              style={styles.typeOption}
            >
              <Text style={{ fontSize: 12 }}>{TYPE_ICONS[type]}</Text>
              <Text style={{ color: theme.text, fontSize: 12 }}>{TYPE_LABELS[type]}</Text>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

// Résumé de migration → message lisible, jamais un simple "OK" (voir
// usePropertyDefinitions.update et le commentaire d'en-tête de
// electron/properties.ts). `migratedCount === 0 && skippedCount === 0`
// (propriété pas encore utilisée dans aucune note) reste affiché tel quel —
// "0 note(s) mise(s) à jour" est une information honnête, pas un bruit à
// masquer.
function formatMigrationMessage(migration: PropertyRenameMigrationSummary): string {
  const parts = [`${migration.migratedCount} note(s) mise(s) à jour`];
  if (migration.skippedCount > 0) {
    parts.push(`${migration.skippedCount} ignorée(s) — la nouvelle clé existait déjà`);
  }
  if (migration.errorCount > 0) {
    parts.push(`${migration.errorCount} erreur(s)`);
  }
  return parts.join(' · ');
}

export function PropertiesManagementSection() {
  const { theme } = usePreferences();
  const { bridge, definitions, error, create, update, remove } = usePropertyDefinitions();
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState<PropertyType>('text');
  // Un seul sélecteur de type ouvert à la fois — voir le commentaire de
  // TypePicker plus haut. `'new'` désigne celui de la ligne de création tout
  // en bas, les autres valeurs sont des `PropertyDefinition.id`.
  const [openTypePickerId, setOpenTypePickerId] = useState<string | null>(null);
  // Résumé de la dernière migration de frontmatter suite à un renommage —
  // partagé entre toutes les lignes (comme `error` ci-dessus) plutôt qu'un
  // état par propriété : un seul renommage à la fois a du sens ici.
  const [migrationMessage, setMigrationMessage] = useState<string | null>(null);

  const renameProperty = (id: string, trimmedName: string) => {
    setMigrationMessage(null);
    void (async () => {
      const migration = await update(id, { name: trimmedName });
      if (migration) setMigrationMessage(formatMigrationMessage(migration));
    })();
  };

  const submitCreate = () => {
    const name = newName.trim();
    if (!name) return;
    setNewName('');
    void create(name, newType, newType === 'options' ? [] : undefined);
  };

  if (!bridge) {
    return (
      <View style={[s.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
        <Text style={[s.cardTitle, { color: theme.text }]}>🏷️ Gestion des propriétés</Text>
        <Text style={[s.label, { color: theme.textMuted }]}>Disponible sur la version desktop pour l’instant.</Text>
      </View>
    );
  }

  return (
    <View style={styles.stack}>
      <View style={[s.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
        <Text style={[s.cardTitle, { color: theme.text }]}>🏷️ Gestion des propriétés</Text>
        <Text style={[s.label, { color: theme.textMuted }]}>
          Le schéma défini ici est proposé partout où une note peut avoir des propriétés (barre latérale, bloc en
          haut de note). Renommer une propriété migre automatiquement les notes qui l’utilisaient déjà ; changer
          son type ne modifie jamais les notes déjà écrites.
        </Text>
        {error && <Text style={styles.error}>⚠️ {error}</Text>}
        {migrationMessage && (
          <Text style={[styles.migrationMessage, { color: theme.textMuted }]}>✅ {migrationMessage}</Text>
        )}

        {definitions.length === 0 && (
          <Text style={[styles.muted, { color: theme.textMuted }]}>Aucune propriété définie pour l’instant.</Text>
        )}

        {definitions.map((def) => (
          <View key={def.id} style={styles.defBlock}>
            <View style={styles.defRow}>
              <DraftTextField
                initialValue={def.name}
                onCommit={(value) => {
                  const trimmed = value.trim();
                  if (trimmed && trimmed !== def.name) renameProperty(def.id, trimmed);
                }}
                theme={theme}
                style={[styles.defNameInput, { color: theme.text, borderColor: theme.border }]}
              />
              <TypePicker
                value={def.type}
                onSelect={(type) => void update(def.id, { type })}
                theme={theme}
                open={openTypePickerId === def.id}
                onToggle={() => setOpenTypePickerId((current) => (current === def.id ? null : def.id))}
              />
              <Pressable onPress={() => void remove(def.id)} style={styles.rowRemove}>
                <Text style={{ color: theme.textMuted }}>🗑️</Text>
              </Pressable>
            </View>
            {def.type === 'options' && (
              <View style={styles.optionsEditRow}>
                <Text style={[styles.optionsHint, { color: theme.textMuted }]}>
                  Options (séparées par des virgules) :
                </Text>
                <DraftTextField
                  initialValue={(def.options ?? []).join(', ')}
                  onCommit={(text) =>
                    void update(def.id, {
                      options: text
                        .split(',')
                        .map((item) => item.trim())
                        .filter((item) => item.length > 0),
                    })
                  }
                  placeholder="🟠 En cours, 🔴 Bloqué, 🟡 En attente"
                  theme={theme}
                  style={[styles.optionsInput, { color: theme.text, borderColor: theme.border }]}
                />
              </View>
            )}
          </View>
        ))}

        <View style={styles.createRow}>
          <TextInput
            value={newName}
            onChangeText={setNewName}
            onSubmitEditing={submitCreate}
            placeholder="Nouvelle propriété…"
            placeholderTextColor={theme.textMuted}
            style={[styles.createInput, { color: theme.text, borderColor: theme.border }]}
          />
          <TypePicker
            value={newType}
            onSelect={setNewType}
            theme={theme}
            open={openTypePickerId === 'new'}
            onToggle={() => setOpenTypePickerId((current) => (current === 'new' ? null : 'new'))}
          />
          <Pressable onPress={submitCreate} style={[styles.createButton, { backgroundColor: theme.accent }]}>
            <Text style={styles.createButtonText}>Créer</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  stack: {
    gap: 16,
  },
  muted: {
    fontSize: 12,
    lineHeight: 18,
  },
  error: {
    color: '#dc2626',
    fontSize: 12,
  },
  migrationMessage: {
    fontSize: 12,
  },
  defBlock: {
    gap: 6,
    // Sépare visuellement chaque propriété de la suivante — sans ça, des
    // lignes consécutives très compactes (juste 6px de gap) + un popover de
    // sélecteur de type ouvert (voir TypePicker) donnaient l'impression que
    // les rangées "se rentraient dedans" (bug rapporté).
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(128,128,128,0.25)',
  },
  defRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    // Filet de sécurité : sur un panneau étroit, empile plutôt que de
    // laisser le nom/le chip de type/la poubelle se chevaucher.
    flexWrap: 'wrap',
  },
  defNameInput: {
    flex: 1,
    minWidth: 100,
    borderWidth: 1,
    borderRadius: 6,
    paddingVertical: 6,
    paddingHorizontal: 8,
    fontSize: 13,
  },
  rowRemove: {
    paddingHorizontal: 4,
  },
  optionsEditRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingLeft: 4,
  },
  optionsHint: {
    fontSize: 11,
  },
  optionsInput: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 6,
    paddingVertical: 4,
    paddingHorizontal: 6,
    fontSize: 12,
  },
  typePickerWrap: {
    position: 'relative',
  },
  typeChip: {
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 6,
    paddingHorizontal: 8,
  },
  typePopover: {
    position: 'absolute',
    top: '100%',
    right: 0,
    marginTop: 4,
    width: 170,
    borderWidth: 1,
    borderRadius: 8,
    padding: 4,
    zIndex: 100,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  typeOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 6,
    borderRadius: 4,
  },
  createRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
    flexWrap: 'wrap',
  },
  createInput: {
    flex: 1,
    minWidth: 140,
    borderWidth: 1,
    borderRadius: 6,
    paddingVertical: 6,
    paddingHorizontal: 8,
    fontSize: 13,
  },
  createButton: {
    borderRadius: 6,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  createButtonText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
});
