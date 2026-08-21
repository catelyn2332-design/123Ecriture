// ARCHITECTURE.md
//////////////////////////////////////////////////////////////////////////
//                     🏗️ ARCHITECTURE — 123Ecriture                     //
//////////////////////////////////////////////////////////////////////////

// SOMMAIRE
// 1. 🎯 Vue d'ensemble
// 2. 🧱 Stack technique
// 3. 🗂️ Structure du monorepo
// 4. 📄 Modèle de données & format des fichiers
// 5. 💾 Stockage local & abstraction multiplateforme
// 6. ☁️ Synchronisation par compte (Supabase)
// 7. 🎨 Personnalisation de l'interface
// 8. 🧩 Architecture en modules (outils de productivité)
// 9. ✅ Qualité, tests, CI
// 10. 🗺️ Feuille de route (phases)
// 11. ❓ Décisions ouvertes

Statut : premier brouillon (v0.1) — à valider et faire évoluer au fil du projet.
Ce document décrit les fondations techniques de 123Ecriture, la première brique
du 🧠 Projet Synapse. Il précède tout code : chaque phase de la feuille de
route (§10) doit s'appuyer dessus, et toute déviation doit être actée ici
(section 11) avant d'être codée.

//////////////////////////////////////////////////////////////////////////
// 1. 🎯 VUE D'ENSEMBLE
//////////////////////////////////////////////////////////////////////////

123Ecriture est une application d'écriture et de productivité "local-first" :
les notes vivent d'abord sous forme de fichiers MDX sur l'appareil de
l'utilisateur·rice, et un compte optionnel permet de les synchroniser entre
plateformes. L'application doit tourner sur PC, Mac, Linux, Android, iOS et
web, avec une interface entièrement personnalisable (couleurs, disposition
des panneaux, raccourcis...).

Principes directeurs :
- **Local-first** : le fichier MDX sur disque est la source de vérité. Le
  cloud (Supabase) est un mécanisme de sauvegarde/synchronisation, jamais un
  passage obligé pour lire ou écrire une note.
- **Un seul cœur logique, plusieurs coquilles** : la logique métier (modèle
  de vault, parsing MDX, moteur de sync, moteur de thèmes...) est écrite une
  fois, indépendante de la plateforme, et consommée par des "shells"
  spécifiques (mobile, desktop, web).
- **Extensible dès le départ** : todo lists, calendrier, graphes, canvas,
  Excalidraw, automatisations sont des *modules*, pas des fonctionnalités
  codées en dur dans le cœur de l'app (§8).

//////////////////////////////////////////////////////////////////////////
// 2. 🧱 STACK TECHNIQUE
//////////////////////////////////////////////////////////////////////////

| Besoin                          | Choix                                   |
|----------------------------------|------------------------------------------|
| Langage                          | TypeScript partout                       |
| UI mobile + web                  | Expo (React Native + React Native Web)   |
| UI desktop                       | Electron, qui embarque le build web Expo |
| Backend / auth / sync            | Supabase (Auth, Postgres, Storage, Edge Functions) |
| Format des notes                 | MDX (Markdown + composants JSX)          |
| Monorepo                         | pnpm workspaces + Turborepo              |
| Lint / format                    | ESLint (déjà amorcé) + Prettier          |
| Tests                            | Vitest (logique pure) + Playwright (bout en bout, au moins sur web/desktop) |

Pourquoi ce choix (déjà amorcé dans [eslint.config.js](../eslint.config.js)) :
- **Expo** couvre iOS/Android/web avec une seule base de code React, et son
  écosystème de modules natifs (fichiers, notifications...) évite de
  réinventer les intégrations plateforme.
- **Electron** reste le choix le plus fiable aujourd'hui pour un vrai accès
  au système de fichiers natif sur PC/Mac/Linux (nécessaire pour un vault
  façon Obsidian) — Expo seul ne le permet pas sur desktop.
- **Supabase** donne auth + base de données + stockage de fichiers "managés"
  sans avoir à opérer un backend soi-même, tout en restant du Postgres
  standard si on veut un jour migrer.

//////////////////////////////////////////////////////////////////////////
// 3. 🗂️ STRUCTURE DU MONOREPO
//////////////////////////////////////////////////////////////////////////

```
123Ecriture/
├── apps/
│   ├── mobile/         # Expo app — cible iOS/Android (+ build web réutilisable)
│   └── desktop/         # Electron — main process (fs natif, menu, fenêtres)
│                         # + charge le build web d'Expo comme renderer
├── packages/
│   ├── core/            # Modèle de vault/note, parsing MDX+frontmatter,
│   │                     # recherche, logique pure sans dépendance UI
│   ├── ui/               # Composants partagés (RN + RN Web), design tokens
│   ├── editor/            # Éditeur MDX (composant central de l'app)
│   ├── storage/            # Interface VaultAdapter + implémentations
│   │                        # (fs Node, Expo FileSystem, File System Access API)
│   ├── sync/                 # Client Supabase, moteur de synchro, résolution
│   │                          # de conflits
│   └── config/                 # tsconfig, eslint, prettier partagés
├── supabase/
│   ├── migrations/               # schéma Postgres versionné
│   └── functions/                  # Edge Functions (Deno)
└── docs/
    ├── ARCHITECTURE.md               # ce document
    └── adr/                             # Architecture Decision Records
```

Chaque `app` est une coquille fine : elle assemble les `packages` et gère le
cycle de vie propre à sa plateforme (permissions, fenêtres, notifications
natives). Toute la logique testable vit dans `packages/`.

//////////////////////////////////////////////////////////////////////////
// 4. 📄 MODÈLE DE DONNÉES & FORMAT DES FICHIERS
//////////////////////////////////////////////////////////////////////////

- Une **note** = un fichier `.mdx` + un bloc **frontmatter YAML** en tête
  pour les propriétés (titre, tags, dates, propriétés personnalisées —
  équivalent des "properties" Obsidian).
- **Le `.mdx` est la surface d'écriture elle-même**, pas qu'un format de
  sauvegarde en arrière-plan : ce que l'utilisateur·rice tape dans l'éditeur
  est directement le contenu du fichier. Ça écarte un éditeur par blocs
  propriétaire (façon Notion) qui sérialiserait vers MDX à l'export, et ça
  oriente vers un éditeur **MDX-natif** — édition du texte source avec rendu
  enrichi à la volée (façon "live preview" d'Obsidian). Impact direct sur le
  choix de lib d'éditeur en Phase 1 (§10).
- Un **vault** = un dossier racine local contenant les notes, éventuellement
  en sous-dossiers libres, plus un dossier caché `.123ecriture/` pour la
  config du vault (thème actif, disposition des panneaux, index de
  recherche, cache).
- Les **liens entre notes** (`[[note]]`) et le **graphe** (§8) sont dérivés
  du contenu, pas stockés séparément — recalculés/mis en cache à l'ouverture
  du vault.

> **Écart pragmatique (v0.1.8, révision "avec sérieux")** : Canvas et
> Graphiques ne sont plus des sections d'app séparées avec leur propre
> registre multi-documents — ce sont des **types de fichiers du vault**,
> côte à côte avec les `.mdx` dans la même arborescence, créés par clic
> droit ("Nouveau canvas"/"Nouveau graphique") comme une note ou un dossier
> (`apps/desktop/electron/vault.ts`, champ `kind` dérivé de l'extension —
> `walkTree`/`vault:create-note`). Chaque type garde sa propre barre
> d'outils, affichée à la place de celle des notes quand ce type de fichier
> est ouvert (`apps/mobile/components/NotesScreen.tsx`, aiguillage par
> `kind` vers `CanvasEditor.tsx`/`ChartEditor.tsx`).
> - `.canvas` : aligné sur **JSON Canvas** (spec ouverte publiée par
>   Obsidian, https://jsoncanvas.org) — `nodes: [{id, type: 'text'|'file',
>   x, y, width, height, text?|file?|title?}]`, `edges: [{id, fromNode,
>   fromSide?, toNode, toSide?}]`.
> - `.chart` : format JSON maison (pas Vega-Lite, jugé trop lourd pour le
>   gain) — `{columns, rows, chart: {type, labelColumnId, valueColumnIds}}`
>   (voir `apps/mobile/lib/sheets.ts`). Le tableur qui l'accompagne reste
>   nécessaire pour alimenter le graphique (pas encore de lecture depuis un
>   tableau MDX externe).
> - Les **tableaux** (GFM `| a | b |`), eux, sont insérables directement
>   dans un `.mdx` via la barre d'outils des notes — pas un type de fichier
>   séparé.
> - Rendu Markdown réel des notes (`markdown-it` + `react-native-markdown-display`,
>   `apps/mobile/lib/markdownPlugins.ts`) : `[[liens internes]]`, `#tags`,
>   `![[pièces jointes]]` (images/audio, syntaxe Obsidian), `{{occurrences}}`
>   (voir plus bas), 3 modes d'affichage (Source/Intermédiaire/Aperçu).
> - **Excalidraw** (v0.1.14, groundwork seulement) : 4e `VaultEntryKind`,
>   reconnu de bout en bout (extension `.excalidraw`, icône, création
>   depuis le menu contextuel, ouverture, recherche) — format existant
>   `.excalidraw`, JSON ouvert maintenu par l'équipe Excalidraw elle-même
>   (`{type: "excalidraw", elements: [...], appState: {...}}`), lu/écrit
>   par `ExcalidrawEditor.tsx` avec repli sur une scène vide en cas
>   d'erreur. Pas de vrai outil de dessin ni dépendance
>   `@excalidraw/excalidraw` cette session (scaffolding uniquement, décision
>   de scope explicite) — `ExcalidrawEditor.tsx` n'affiche qu'un
>   placeholder pour l'instant.

> **Écart pragmatique (v0.1.8, barre latérale + Live Preview)** :
> - "Intermédiaire" est maintenant un VRAI Live Preview inline à la
>   Obsidian, pas un côte-à-côte : le `TextInput` a été remplacé par
>   CodeMirror 6 (`@uiw/react-codemirror`, `apps/mobile/components/
>   MdxEditor.tsx`) pour les modes Source ET Intermédiaire — même éditeur,
>   seule la présence d'un `ViewPlugin` de décoration
>   (`apps/mobile/lib/mdxLivePreview.ts`) change : gras/italique/titres
>   stylés (marqueurs masqués sauf curseur dedans), liens/tags/occurrences/
>   embeds en pastilles cliquables. S'intègre directement dans l'arbre RN
>   sans échappatoire ref+useEffect : l'app tourne comme une vraie appli
>   `react-dom` (web export Expo → react-native-web compile `View`/`Text`
>   en `<div>`/`<span>` via `React.createElement` standard), donc un
>   composant React "DOM pur" comme ce wrapper CodeMirror s'y intègre
>   nativement — contrairement à `SvgOverlay.tsx`/`AudioEmbed.tsx`, qui
>   injectent du DOM brut pour des primitives que RN n'expose pas du tout.
> - **Propriétés** : schéma global typé (texte/liste/nombre/case à cocher/
>   date/date-heure) par coffre (`.123ecriture/properties.json`,
>   `apps/desktop/electron/properties.ts`) — ne porte que la DÉFINITION,
>   pas les valeurs, qui vivent dans le frontmatter de chaque note (parsé/
>   sérialisé par `apps/mobile/lib/frontmatter.ts`, dépendance `js-yaml`,
>   jamais parsé avant cette version). Gérées depuis la nouvelle barre
>   latérale droite de l'écran Notes (`RightSidebar.tsx`, repliable, rail de
>   boutons extensible — premier onglet `PropertiesPanel.tsx`). Renommer/
>   changer le type/supprimer une propriété ne touche QUE le schéma, jamais
>   les valeurs déjà écrites (pas de migration silencieuse de contenu).
> - **`{{Occurrences}}`** : mélange lien interne/mot-clé — un mot choisi à
>   l'avance dans un dictionnaire personnel par coffre
>   (`.123ecriture/occurrences.json`, `apps/desktop/electron/occurrences.ts`),
>   deuxième onglet de la barre latérale (`OccurrencesPanel.tsx`). Une
>   `{{...}}` n'est stylée/cliquable que si son mot existe dans le
>   dictionnaire (sinon texte brut) — contrairement à `[[lien]]`, pas de
>   création à la volée par simple frappe : autocomplétion dès `{{`
>   (`@codemirror/autocomplete`, `apps/mobile/lib/occurrenceAutocomplete.ts`)
>   ne propose que les mots connus + une option "Créer" qui ajoute le mot
>   au dictionnaire avant de fermer le token. Renommer un mot réécrit
>   `{{ancien}}`→`{{nouveau}}` dans TOUS les `.mdx` du coffre côté main
>   process (contrairement aux propriétés — ici le mot est le texte lui-même
>   dans le contenu, pas juste une clé de frontmatter).

> **Écart pragmatique (v0.1.14, interface — Tâches/Live Preview/sidebars)** :
> - **Bug du mode "Intermédiaire" corrigé** : il se comportait exactement
>   comme "Source" (aucune décoration visible), un `RangeSetBuilder`
>   CodeMirror plantait silencieusement — les décorations `mark`/`heading`
>   étaient ajoutées dans le mauvais ordre (le contenu stylé avant son
>   marqueur, alors que `RangeSetBuilder` exige un ordre `from` strictement
>   croissant), ce qui faisait planter `buildDecorations` et CodeMirror
>   désactivait le `ViewPlugin` entier sans bruit visible. Diagnostiqué en
>   lançant réellement l'app sous xvfb+Playwright (`_electron`) — jamais
>   fait pour cette zone jusqu'ici — plutôt qu'en relisant le code une 3e
>   fois ; corrigé dans `apps/mobile/lib/mdxLivePreview.ts`.
> - **Tâches** refaites façon Microsoft To Do : `Task` porte maintenant
>   `description`/`subtasks`/`attachments` (`apps/desktop/electron/
>   tasks.ts`, normalisés à la lecture pour les tâches plus anciennes, pas
>   de migration écrite sur disque), texte de tâche éditable après création.
>   Les pièces jointes réutilisent le bridge générique
>   `vault.importAttachment()` (pas de 2e mécanisme de copie de fichier).
>   `DraftTextField` (le champ "brouillon, commit au blur" né dans
>   `PropertiesPanel.tsx`) extrait dans son propre fichier pour être
>   réutilisé par `TasksScreen.tsx`.
> - **3 barres latérales redimensionnables/repliables au curseur** (nav
>   générale, explorateur de fichiers, panneau Propriétés/Occurrences) :
>   nouveau hook `apps/mobile/lib/useResizablePanel.ts` (mousedown/
>   mousemove/mouseup sur `document`, premier précédent de ce genre dans le
>   repo — tout le reste du drag existant est du HTML5 natif `draggable`),
>   poignée partagée `ResizeHandle.tsx`, état persisté par coffre... par
>   PRÉFÉRENCE (`preferences.sidebarLayout`, pas vault-scopé). Glisser sous
>   la moitié de la largeur minimale replie automatiquement le panneau ; un
>   chevron sur la poignée permet aussi de replier/déplier au clic.
> - **Suppression** (v0.1.15) : `vault:delete` (apps/desktop/electron/
>   vault.ts) — jusqu'ici volontairement absente de l'app (voir
>   l'historique de ce fichier), ajoutée à la demande explicite de
>   l'utilisatrice, mais avec une confirmation NATIVE
>   (`dialog.showMessageBox`, jamais silencieuse) distinguant fichier de
>   dossier (+tout son contenu). Item "Supprimer" dans le menu contextuel
>   de l'explorateur (`NotesScreen.tsx`).
> - **Glisser-déposer de l'explorateur** (v0.1.15) : ne dépendait plus que
>   d'un réglage Paramètres → "Ordre des fichiers" = Manuel choisi AU
>   PRÉALABLE pour que `draggable` soit posé sur les lignes — sinon glisser
>   ne faisait rigoureusement rien de visible, ce qui ressemblait à une
>   fonctionnalité cassée. `draggable` est maintenant TOUJOURS actif ; le
>   dépôt qui aboutit bascule lui-même ce réglage sur "Manuel".
> - **Graphiques** (v0.1.15) : un graphique configuré (colonnes
>   étiquette+valeurs choisies) mais dont le tableau n'a encore AUCUNE
>   ligne se rendait en silence sans rien afficher (axe vide) —
>   `buildChartSeries` renvoie une série par colonne de valeurs même à 0
>   ligne, `chartSeries.length > 0` ne suffisait donc pas à détecter ce
>   cas. `ChartEditor.tsx` affiche maintenant un message explicite invitant
>   à remplir des lignes tant qu'il n'y en a aucune.
> - **Scroll de l'explorateur de fichiers indépendant du contenu** :
>   `AppShell.tsx` enveloppait tout l'écran actif (donc les `ScrollView`
>   internes de `NotesScreen.tsx`) dans un `ScrollView` supplémentaire —
>   deux `ScrollView` imbriqués cassent la chaîne `flex:1` sur le web,
>   c'était le scroll EXTÉRIEUR qui captait la molette. Remplacé par une
>   simple `View` ; chaque écran gère déjà son propre scroll interne.

> **Écart pragmatique (v0.1.16, interface — round 3)** :
> - **Éditeur de note figé (aucun scroll) corrigé** : cause racine dans
>   `@uiw/react-codemirror` (`esm/index.js`/`theme/dimensionTheme.js`,
>   lus directement) — le prop `height="100%"` de `<CodeMirror>` ne
>   s'applique qu'à `.cm-editor`/`.cm-scroller` (via une extension
>   `EditorView.theme()`), jamais au `<div className="cm-theme-none">`
>   que le composant rend lui-même pour l'englober. Ce div, sans hauteur
>   explicite, grandissait pour englober tout le contenu (confirmé :
>   3152px pour ~120 lignes, alors que son propre parent RN restait
>   correctement borné à 681px) — le classique "flexbug" des hauteurs en
>   % sans `min-height:0` explicite à chaque niveau, ici sur un `<div>`
>   hors de portée des styles React Native habituels. `style` n'est PAS
>   dans la liste des props filtrées par la lib et atterrit donc tel quel
>   sur ce div : `<CodeMirror style={{display:'flex', flex:1,
>   minHeight:0}} .../>` (`apps/mobile/components/MdxEditor.tsx`) lui
>   donne enfin une hauteur définie, ce qui laisse `.cm-scroller`
>   redevenir réellement scrollable.
> - **Glisser un fichier DANS un dossier** : le glisser-déposer ne faisait
>   jusqu'ici QUE réordonner entre frères (même dossier parent) — étendu
>   à une 3e zone `'inside'` (tiers central d'une ligne DOSSIER, tous
>   dossiers confondus, pas seulement les frères) qui appelle `vault:move`
>   (déjà existant, réutilisé tel quel — garde-fous "dossier dans
>   lui-même" déjà en place côté main process) au lieu de
>   `vault:reorder`. `apps/mobile/components/NotesScreen.tsx`
>   (`resolveInsertion`/`handleDrop`), `VaultTreeView.tsx` (indice visuel :
>   fond teinté de la ligne entière plutôt qu'un trait entre deux lignes).
> - **Bouton "ordre de tri" dans l'explorateur** (`Sources.md` §2) : accès
>   direct au réglage `fileSortMode` (déjà existant côté Paramètres)
>   depuis l'explorateur lui-même, + un 4e mode `'oldest'` ("moins récent
>   d'abord", symétrique de `'recent'` qui n'existait qu'en "plus récent
>   d'abord"). Même mécanisme de choix contextuel que le sélecteur de
>   liste de `TasksScreen.tsx` (entrée active préfixée ✅).
> - **Graphiques** : re-testé de bout en bout (tableur → lignes de vraies
>   données → graphique en barres réel, valeurs et proportions correctes,
>   persistant après rechargement) sans trouver de nouveau bug — le moteur
>   SVG (`ChartView.tsx`) fonctionne. Le blocage rapporté correspondait au
>   cas déjà corrigé en v0.1.15 (tableau sans lignes remplies). Mermaid
>   envisagé par l'utilisatrice puis écarté : DSL texte déclaratif pensé
>   pour des diagrammes, pas piloté par une UI de tableur — mauvais fit
>   pour un usage façon Airtable (données éditées interactivement →
>   graphique automatique).

> **Écart pragmatique (v0.1.17, fichiers/explorateur — organisation +
> correctifs)** :
> - **Régression de largeur de l'éditeur corrigée** : le correctif v0.1.16
>   du scroll figé (`style={{display:'flex', flex:1, minHeight:0}}` sur
>   `<CodeMirror>`, voir `MdxEditor.tsx`) manquait `flexDirection:'column'`
>   — un `display:'flex'` brut sur un `<div>` qui n'est PAS un `View` React
>   Native vaut `flex-direction:row` par défaut, donc l'unique enfant
>   (`.cm-editor`) se dimensionnait à la largeur de son contenu au lieu de
>   s'étirer, d'où "le fichier ne s'affiche qu'à la moitié de la page".
> - **Glisser-déposer qui "revenait à sa place" corrigé** : course entre
>   `vault:reorder` (relit `fileSortMode` depuis le DISQUE à chaque appel)
>   et le passage en mode "Manuel" déclenché par le même glisser
>   (`preferences:set`, écriture disque asynchrone) — `vault:reorder`
>   s'exécutait souvent encore en mode 'alphabetical', ignorait l'ordre
>   fraîchement donné. `PreferencesContext.tsx` : tous les setters
>   renvoient maintenant une vraie `Promise<void>` (résolue après
>   l'écriture disque, pas juste l'état React local) ; `NotesScreen.tsx`
>   attend cette promesse avant d'appeler `vault:reorder`.
> - **"Fichier ouvert par défaut"** (Paramètres → Gestion des fichiers et
>   des liens) : Dernier ouvert / Nouvelle note / Fichier spécifique.
>   "Dernier ouvert" par COFFRE (`.123ecriture/state.json`, voir
>   `vault:get-last-opened`/`set-last-opened`), pas une préférence
>   app-level. L'explorateur déplie toujours les dossiers ancêtres et
>   défile jusqu'à la note active, quelle que soit la façon dont elle est
>   devenue active (`NotesScreen.tsx`, effet dédié +
>   `lib/vaultTree.ts#getAncestorRelPaths`). **Gotcha trouvé en testant** :
>   l'effet d'ouverture par défaut lisait `preferences.defaultOpenMode`
>   avant que le premier `bridge.get()` ait résolu, s'exécutait donc avec
>   `DEFAULT_PREFERENCES` ('lastOpened') quel que soit le VRAI mode
>   configuré, et son verrou "une fois par coffre" empêchait tout second
>   essai une fois les vraies préférences chargées — d'où un nouveau
>   `preferencesLoaded` (`PreferencesContext.tsx`) que cet effet attend.
> - **Lignes de profondeur** dans l'explorateur (`VaultTreeView.tsx`) —
>   une ligne verticale par ancêtre, empilées entre lignes consécutives
>   pour donner l'illusion d'un trait continu (pas de vrai suivi de
>   branche, volontairement simple).
> - **Organisation du code** (fichiers/explorateur/paramètres des
>   fichiers) : sommaires + chapitres numérotés (`//1.`, `//2.`...) ajoutés
>   en tête et aux points d'articulation de `vault.ts`, `VaultTreeView.tsx`,
>   `lib/vaultTree.ts`, `FilesLinksSection.tsx`, et (partiellement, vu sa
>   taille et son périmètre mixte fichiers+édition) `NotesScreen.tsx`.

//////////////////////////////////////////////////////////////////////////
// 5. 💾 STOCKAGE LOCAL & ABSTRACTION MULTIPLATEFORME
//////////////////////////////////////////////////////////////////////////

`packages/storage` expose une interface unique, par ex. :

```ts
interface VaultAdapter {
  list(path: string): Promise<VaultEntry[]>;
  read(path: string): Promise<string>;
  write(path: string, content: string): Promise<void>;
  watch(path: string, onChange: (event) => void): Unsubscribe;
  // ...
}
```

Implémentations prévues :
- **Electron (desktop)** : `fs`/`fs.watch` Node natif — accès disque complet.
- **Expo (mobile)** : `expo-file-system` + `expo-document-picker` pour choisir
  le dossier vault (sandboxing iOS/Android oblige, contrairement au desktop).
- **Web (navigateur seul, hors coquille Expo/Electron)** : File System Access
  API si disponible, sinon repli sur OPFS/IndexedDB avec export/import manuel.

C'est cette abstraction qui permet au `core` et à l'`editor` d'ignorer
totalement la plateforme sur laquelle ils tournent.

> **Écart pragmatique (Phase 1, v0.1.3)** : l'implémentation Electron du
> VaultAdapter vit pour l'instant directement dans
> `apps/desktop/electron/vault.ts` (exposé au renderer via IPC/preload), pas
> encore dans un `packages/storage` séparé — on a évité de créer un paquet
> partagé tant qu'il n'a qu'un seul consommateur réel (les adaptateurs
> Expo/web de la Phase 2 n'existent pas encore), pour ne pas complexifier
> prématurément la résolution de dépendances du monorepo pnpm (source de
> plusieurs galères déjà rencontrées côté packaging desktop). À extraire
> en `packages/storage` quand un deuxième consommateur apparaîtra.

> **Écart pragmatique (v0.1.8)** : un vault n'est plus un `vaultPath` unique
> mais une vraie liste (`apps/desktop/electron/vaults.ts`, config.json →
> `{ vaults: [...], activeVaultId }`, migration automatique de l'ancien
> format). Chaque dossier de vault reçoit une identité stable
> (`.123ecriture/vault.json`, `{ id, name, createdAt }`), indépendante de son
> chemin — c'est cette identité qui sert de clé de correspondance avec la
> ligne cloud du vault (§6), pas le chemin local (qui change d'une machine à
> l'autre). `vault.ts`/`tasks.ts` continuent d'opérer sur UN SEUL vault "actif"
> à la fois (`getActiveVaultPath()`), inchangés au-delà de ce point de
> couture.

> **Écart corrigé (v0.1.9)** : le process principal Electron était resté en
> JavaScript brut (`.js`) depuis la Phase 1, seul point non-TypeScript de
> tout le monorepo (le renderer, `apps/mobile`, l'était déjà entièrement).
> Converti en `.ts` (14 fichiers) — nouveau `apps/desktop/tsconfig.json`
> (`noEmit: true`, esbuild reste le seul à transpiler/bundler vers CJS, même
> répartition des rôles que Metro côté mobile), nouveau script `typecheck`,
> types partagés entre les fichiers du process principal centralisés dans
> `apps/desktop/electron/types.ts` — délibérément PAS partagés avec
> `apps/mobile/types/global.d.ts` (pas de `packages/shared-types`
> aujourd'hui, même raisonnement "pas d'abstraction avant un vrai deuxième
> consommateur" que pour `packages/storage` ci-dessus). `main.js`/
> `preload.js` restent le point d'ENTRÉE réel de l'app (Electron ne peut
> exécuter que du JS compilé) — désormais produits par esbuild à partir de
> `electron/main.ts`/`preload.ts`, exactement comme le web export Expo
> compile déjà `App.tsx` pour le renderer.

> **Écart pragmatique (v0.1.21, import direct `apps/desktop` →
> `apps/mobile`)** : `apps/desktop/electron/properties.ts` importe
> directement `migrateFrontmatterKey` depuis
> `apps/mobile/lib/frontmatterMigration.ts` (chemin relatif
> `../../mobile/lib/...`), au lieu de dupliquer sa propre copie comme le
> font `search.ts`/`occurrences.ts` pour leur mini-parseur de frontmatter en
> LECTURE seule (voir leurs commentaires sur cette duplication assumée).
> Différence de nature qui justifie l'exception : cette fonction RÉÉCRIT des
> notes existantes sur disque (migration de clé au renommage d'une
> propriété, §8) — une zone "sauvegarde et gestion des données" où une
> deuxième implémentation divergente serait plus dangereuse qu'un import
> cross-package. `migrateFrontmatterKey` reste pure et testée par Vitest
> côté `apps/mobile` (aucun équivalent Electron-only). Vérifié compatible
> avec la résolution de modules pnpm et le bundling esbuild
> (`build:electron` bundle bien le code + ses propres dépendances, résolues
> depuis `apps/mobile/node_modules` relativement au fichier importé) — mais
> reste un cas isolé, pas un changement de politique : ne pas généraliser
> les imports cross-package tant qu'un vrai `packages/` partagé (§3) n'a pas
> de raison d'exister pour autre chose.

//////////////////////////////////////////////////////////////////////////
// 6. ☁️ SYNCHRONISATION PAR COMPTE (SUPABASE)
//////////////////////////////////////////////////////////////////////////

Statut : implémenté (v0.1.8, desktop uniquement — voir écart pragmatique plus
bas) sur le projet Supabase partagé "Projet Synapse".

- **Auth** : Supabase Auth, Google OAuth uniquement pour l'instant (le
  provider était déjà activé côté Supabase). Flux "navigateur système +
  protocole personnalisé" côté Electron (`apps/desktop/electron/auth.ts` +
  `apps/mobile/lib/sync/AuthContext.tsx`) — PKCE, la session vit entièrement
  côté renderer (client Supabase, `localStorage`), le main process ne fait
  que relayer l'URL de callback (`app123ecriture://auth-callback`) reçue via le
  protocole personnalisé (nécessite le verrou mono-instance, voir `main.ts`).
- **Schéma dédié** : `app_123ecriture` (jamais `public`, réservé aux autres
  apps du projet partagé) — voir
  `supabase/migrations/20260816120000_app_123ecriture_schema.sql`. Deux
  tables : `vaults` (identité cloud d'un coffre local, clé sur
  `local_vault_id` = l'id de `.123ecriture/vault.json`, pas le chemin) et
  `vault_files` (une ligne par note). RLS strictement `owner_id = auth.uid()`
  des deux côtés + sur `storage.objects` (via lookup dans `vaults`, pas par
  segment de chemin "de confiance").
- **Stockage des fichiers** : Supabase Storage, **un objet par note**
  (tranché — voir §11), bucket privé dédié `123ecriture-vaults`, chemin
  `<vaults.id>/<relPath>`.
- **Métadonnées** : table `vault_files` (chemin, hash de contenu SHA-256,
  taille, horodatage) pour détecter ce qui a changé sans retélécharger tout
  le vault — hash local calculé en un seul passage par
  `apps/desktop/electron/sync.ts` (`sync:hash-vault`).
- **Stratégie de conflit v0** : "dernier écrit gagne" par horodatage +
  conservation d'une copie de sauvegarde du côté perdant, écrite comme une
  note `.mdx` normale et visible (`Nom (conflit <horodatage ISO>).mdx`),
  **avant** tout écrasement — jamais de perte silencieuse de données (cf.
  CLAUDE.md). Implémenté dans `apps/mobile/lib/sync/{diff,syncEngine}.ts` —
  `diff.ts` est pure (décisions push/pull/conflit, testée en isolation,
  voir `diff.test.ts`), `syncEngine.ts` orchestre les effets de bord
  (Storage, table, pont vault local). Une résolution plus fine (fusion,
  CRDT) reste une évolution possible, pas un prérequis v0.
- **v0 ne propage pas les suppressions locales** (pas de tombstone) —
  supprimer une note localement ne supprime pas sa copie cloud ; la
  prochaine synchro la retélécharge. Assumé et documenté dans l'UI plutôt
  que silencieux ; suivi naturel une fois le push/pull de base éprouvé.
- La sync est **opt-in, manuelle (bouton "Synchroniser maintenant", pas de
  timer en v0) et best-effort** : l'app reste 100 % fonctionnelle hors
  ligne / sans compte, un coffre non lié au cloud n'appelle jamais Supabase.

> **Écart pragmatique (v0.1.8)** : pas de nouveau `packages/sync` — la
> logique vit dans `apps/mobile/lib/sync/` (renderer) et
> `apps/desktop/electron/{auth,sync}.ts` (main process), même principe que
> l'écart §5 sur `packages/storage` : aujourd'hui il n'y a qu'un seul vrai
> consommateur (`@123ecriture/mobile`, chargé tel quel par le shell
> Electron), et le mobile natif n'a encore aucun adaptateur de stockage
> local (Phase 2 mobile non faite) donc rien à synchroniser — lui câbler
> l'auth/la synchro maintenant serait du code non utilisé. Extraire
> `packages/sync` (au moins `diff.ts`, déjà pur) le jour où le mobile natif
> a un vrai accès fichier et devient un second consommateur réel.

> **Limite connue (v0.1.8)** : le flux Google OAuth Electron (protocole
> personnalisé + verrou mono-instance) et un aller-retour de synchro réel
> n'ont été vérifiés que statiquement (lint/typecheck/bundle) — un vrai
> aller-retour navigateur système + callback, et un vrai conflit à deux
> écritures, restent à valider manuellement dans l'app avant release (zones
> CLAUDE.md "connexion au compte" et "sauvegarde et gestion des données").

> **Cause racine trouvée et corrigée (v0.1.9)** : la carte "Compte" de
> `SettingsScreen.tsx` n'apparaissait dans AUCUNE release construite par
> `.github/workflows/release.yml`, quoi qu'on fasse côté app — l'étape
> `pnpm --filter @123ecriture/mobile build:web` du workflow ne définissait
> jamais `EXPO_PUBLIC_SUPABASE_URL`/`EXPO_PUBLIC_SUPABASE_ANON_KEY` (inlinées
> par Expo AU MOMENT du build web, pas à l'exécution — voir
> `apps/mobile/lib/sync/supabaseClient.ts`), donc `auth.available` restait
> `false` dans tout build CI même une fois le `.env` local correctement
> renseigné. Corrigé en passant ces deux variables comme `env:` sur cette
> étape, sourcées depuis `${{ secrets.* }}` — nécessite que ces 2 secrets
> soient créés une fois dans Settings → Secrets and variables → Actions du
> dépôt GitHub (valeurs dans la mémoire du projet
> `123ecriture-vault-sync.md`), étape que je ne peux pas faire moi-même
> (jeton `gh` de session sans droit de gestion des secrets, confirmé par un
> 403 sur `gh secret list`).

//////////////////////////////////////////////////////////////////////////
// 7. 🎨 PERSONNALISATION DE L'INTERFACE
//////////////////////////////////////////////////////////////////////////

- **Design tokens** centralisés dans `packages/ui` (couleurs, espacements,
  typographies) exposés comme un objet de thème modifiable à l'exécution
  (pas de couleurs codées en dur dans les composants).
- **Thème utilisateur** stocké comme JSON dans `.123ecriture/theme.json` du
  vault (donc versionné/synchronisé comme le reste), avec un éditeur visuel
  à construire une fois le socle stable.
- **Disposition des panneaux/boutons** : modèle de layout déclaratif
  (grille de panneaux réorganisables), stocké de la même façon.
- Cette couche est volontairement conçue pour être réutilisée par les
  futures applications du Projet Synapse (même moteur de thèmes/layout).

> **Écart pragmatique (v0.1.5)** : la première version (mode clair/sombre/
> système, couleur d'accent, ordre/visibilité de la barre d'outils Notes)
> est stockée dans le config.json app-level d'Electron (userData), pas
> encore dans `.123ecriture/theme.json` du vault — ça fonctionne même sans
> vault sélectionné, et évite de coupler la personnalisation à la présence
> d'un vault tant que la sync compte (Phase 3) n'existe pas. Voir
> `apps/desktop/electron/preferences.ts` et
> `apps/mobile/preferences/PreferencesContext.tsx`. À migrer vers le vault
> quand la personnalisation devra suivre l'utilisateur·rice plutôt que la
> machine.

//////////////////////////////////////////////////////////////////////////
// 8. 🧩 ARCHITECTURE EN MODULES (OUTILS DE PRODUCTIVITÉ)
//////////////////////////////////////////////////////////////////////////

Todo lists, calendrier, graphe de notes, canvas, Excalidraw, automatisations
sont chacun un **module** enregistré auprès d'un registre central plutôt que
codés en dur dans l'éditeur :

```ts
interface Module {
  id: string;
  registerPanel?(): PanelDefinition;      // ajoute un panneau dans l'UI
  registerCommand?(): CommandDefinition[]; // ajoute des actions/raccourcis
  onVaultEvent?(event): void;               // réagit aux changements de notes
}
```

Ce découplage permet d'ajouter/désactiver des outils sans toucher au cœur,
et prépare le terrain pour qu'un jour ces modules soient développés/partagés
indépendamment (esprit Projet Synapse). **Cette architecture est prévue dès
le départ mais implémentée progressivement** : l'éditeur MDX de base n'a pas
besoin du registre complet pour exister (voir feuille de route §10).

> **Écart pragmatique (v0.1.6)** : le premier module (Tâches) est câblé
> directement (apps/desktop/electron/tasks.ts + apps/mobile/components/
> TasksScreen.tsx), pas encore via l'interface `Module` ci-dessus — construire
> le registre pour un seul module serait prématuré (l'abstraction se dessine
> vraiment à partir du deuxième). Les tâches sont stockées dans le vault
> (`.123ecriture/tasks.json`), comme le seront les futurs modules, pour
> rester cohérent avec le principe local-first plutôt que dans le
> config.json app-level (réservé aux préférences d'interface, pas au
> contenu utilisateur).

//////////////////////////////////////////////////////////////////////////
// 9. ✅ QUALITÉ, TESTS, CI
//////////////////////////////////////////////////////////////////////////

Conformément à CLAUDE.md :
- **ESLint bloquant** : aucune erreur de lint ne doit passer en CI ni en
  pré-commit.
- **Tests obligatoires sur les fonctionnalités critiques** :
  1. Stabilité des interfaces sur chaque plateforme (au minimum : l'app
     démarre et affiche le vault sans crash).
  2. Connexion au compte (auth Supabase).
  3. Sauvegarde et gestion des données (écriture/lecture de fichiers,
     sync, résolution de conflit) — zone à plus haute exigence de tests
     puisqu'une régression y est silencieuse par nature.
- `packages/core`, `packages/storage`, `packages/sync` visent une couverture
  de tests unitaires élevée (logique pure, facile à tester). Les `apps/`
  sont couvertes par des tests bout-en-bout plus légers.

//////////////////////////////////////////////////////////////////////////
// 10. 🗺️ FEUILLE DE ROUTE (PHASES)
//////////////////////////////////////////////////////////////////////////

**Phase 0 — Scaffold** : monorepo pnpm/Turborepo, `apps/mobile` (Expo) et
`apps/desktop` (Electron) qui démarrent tous les deux et affichent un écran
minimal. Corrige au passage l'erreur de syntaxe dans
[eslint.config.js](../eslint.config.js).

**Phase 1 — Vault local & éditeur MDX** : `packages/storage` (adaptateur
Electron d'abord, le plus simple), `packages/core` (modèle de note/vault),
`packages/editor` (ouvrir/éditer/sauvegarder un `.mdx` avec frontmatter).
Cible : ouvrir un dossier, éditer une note, la retrouver après redémarrage.

**Phase 2 — Multiplateforme réel** : adaptateurs storage Expo (mobile) et
web, parité de l'éditeur sur les trois cibles.

**Phase 3 — Compte & synchronisation** : intégration Supabase (auth,
sync des fichiers, résolution de conflit v0). ✅ Fait (v0.1.8) côté desktop —
voir §6. Mobile natif reste hors périmètre tant que la Phase 2 mobile (accès
fichier local) n'existe pas.

**Phase 4 — Personnalisation** : moteur de thèmes/layout (§7) + UI de
réglages.

**Phase 5 — Modules productivité** : registre de modules (§8), puis premiers
modules (todo list, calendrier...), un par un. ✅ Fait (v0.1.8) côté desktop :
Tâches (listes multiples), Calendrier (notes journalières + évènements),
Graphiques (barres/lignes/camembert) et Canvas (cartes texte/note reliées
par des flèches sur un plan pannable) — révisés depuis en types de fichiers
du vault (`.chart`/`.canvas`, voir §4) plutôt que sections séparées. Rendu
Markdown réel des notes (liens internes, tags, pièces jointes, 3 modes
d'affichage — voir §4) et réordonnancement manuel du vault par glisser
(`.123ecriture/order.json`, `vault:reorder`) également faits. Toujours pas
de vrai registre de modules générique (§8) — chaque module reste câblé
directement, comme Tâches l'était déjà ; à construire quand le besoin d'un
pattern commun se fera vraiment sentir. Mobile natif reste hors périmètre
(pas d'accès fichier local — Phase 2 mobile non faite).

Chaque phase doit rester livrable et testée avant de passer à la suivante —
pas de big-bang.

//////////////////////////////////////////////////////////////////////////
// 11. ❓ DÉCISIONS OUVERTES
//////////////////////////////////////////////////////////////////////////

À trancher avant/pendant les phases concernées :
- ~~Stockage Supabase : un objet Storage par note vs. vault packagé~~ —
  **tranché (v0.1.8) : un objet par note**, voir §6. Permet une synchro
  incrémentale fine (seuls les fichiers modifiés sont ré-uploadés) et un
  conflit qui ne touche qu'une note à la fois plutôt que tout le coffre.
- Bibliothèque de parsing/rendu MDX précise (`@mdx-js/mdx` + `remark`/`rehype`
  plugins) — à choisir en Phase 1. ~~Tranché partiellement (v0.1.8)~~ : rendu
  Markdown (pas encore compilation JSX/MDX complète avec composants
  embarqués) via `markdown-it`/`react-native-markdown-display`, voir §4 —
  suffisant pour liens/tags/pièces jointes/tableaux, mais pas des composants
  React arbitraires dans une note. À revoir si ce besoin se confirme.
- Excalidraw : lib dédiée (`@excalidraw/excalidraw`, à valider sous RN Web)
  vs. rendu maison minimal (lecture seule d'abord) — format de fichier déjà
  identifié (`.excalidraw`, voir §4), implémentation pas encore commencée.
- Chiffrement des notes synchronisées (au repos côté Supabase) — non prévu
  v0, à évaluer si des notes sensibles sont attendues.
