# Liste de datas — IFC Data Explorer

Explorateur de fichiers IFC orienté données. Charge un fichier `.ifc` et affiche une synthèse agrégée de tous les types d'entités, leurs attributs et leurs Psets — sans ligne individuelle, uniquement les statistiques utiles.

**Accès en ligne → [nvalettepro-sudo.github.io/Liste_de_datas/explorer/](https://nvalettepro-sudo.github.io/Liste_de_datas/explorer/)**

---

## Fonctionnalités

- **Chargement local** — le fichier reste sur votre machine, aucun upload serveur
- **Vue agrégée par type** — pour chaque type IFC (IfcWall, IfcDoor…) : nombre d'occurrences, valeurs distinctes, couverture des propriétés
- **Psets Standards et Personnalisés** — séparés, avec taux de remplissage par propriété
- **Recherche globale** — tape un terme pour trouver instantanément tous les types d'entités qui contiennent ce Pset, cette propriété ou cette valeur
- **Vue graphe de relations** — explore le fichier comme le graphe orienté qu'il est réellement, organisé en hubs nommés selon la norme IFC (Contenu dans, Agrégation, Type, Matériau, Classification, PropertySets) :
  - **Vue d'ensemble** — tous les types du fichier, regroupés sous le hub de relation IFC prioritaire dont ils dépendent (structure spatiale et agrégation avant matériau/classification/psets, pour éviter qu'un élément structurel comme un poteau se retrouve classé sous "Matériau" simplement parce que cette relation compte plus d'occurrences). Un hub sert de poignée : le déplacer entraîne avec lui tout son groupe.
  - **Vue détail** — depuis un type sélectionné, explore ses instances avec le même regroupement par hubs, pour ne jamais se retrouver avec une explosion de nœuds sans repère au fil des `double-clic pour étendre`. Les définitions partagées n'apparaissent qu'une fois, avec le nombre d'occurrences qui pointent vers elles.
  - **Liens dynamiques** — chaque arête choisit son point d'ancrage (haut/bas/gauche/droite) selon la position relative des deux nœuds qu'elle relie, pour rester lisible même après un déplacement manuel.
- **Infos projet** — onglet de la barre latérale : projet, site, géoréférencement, étages, logiciel et historique (`IfcOwnerHistory`), unités, MVD.
- **Géoréférencement** — lecture conforme à la spécification interne « Géoréférencement IFC — lecture et affichage » : statut (Géoréférencé, conversion identité, carte inconnue, coordonnées sans carte, GPS seul, non géoréférencé), valeur principale choisie par arbre de décision (`IfcMapConversion` + `IfcProjectedCRS` en IFC4/4.3, position de l'`IfcSite` comme Solibri en IFC2x3), toutes les autres sources en secondaire avec leur instance STEP (`#31`), explications simples et détaillées, niveau de certitude (« non comparé à Solibri », « hypothèse ») et contrôles de cohérence (nord / rotation, unités, conversions ou sites multiples…).
- **Inspecteur IFC** — chaque information affichée est reliée au code du fichier : un clic sur une valeur (info projet, attribut ou propriété agrégée, instance, nœud ou lien du graphe) ouvre les lignes STEP d'où elle provient, l'argument concerné surligné. Les références `#N` sont navigables (pile avec retour), les valeurs agrégées donnent la liste de leurs occurrences avec la chaîne complète élément → `IfcRelDefinesByProperties` → Pset → propriété. Le fichier n'est pas rechargé : un index des lignes est construit au chargement et seule la ligne demandée est décodée.
- **Export CSV** — exporte les données agrégées du type sélectionné
- **Traductions françaises** des types IFC courants
- Compatible **IFC2X3**, **IFC4**, **IFC4X3**

## Stack technique

| Outil | Rôle |
|---|---|
| React 18 + TypeScript | Interface |
| Vite | Build |
| Tailwind CSS | Style |
| web-ifc (WASM) | Lecture des fichiers IFC |
| Zustand | État global |
| React Flow | Rendu de la vue graphe |
| Web Worker | Parsing et extraction des relations hors du thread UI |

## Tests

```bash
npm test
```

Les jeux de test du géoréférencement (`src/lib/georef.test.ts`) utilisent les petits fichiers de `tests/fixtures/georef`. Les maquettes lourdes sont lues dans le dossier indiqué par `GEOREF_FIXTURES_DIR` (tests ignorés si absent).

## Développement local

```bash
npm install
npm run dev
```

Le build de production est dans `explorer/` et servi par GitHub Pages.

```bash
npm run build
cp -r dist explorer
```

---

Nico Valette — BIM Manager
