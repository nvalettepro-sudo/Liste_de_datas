# Liste de datas — IFC Data Explorer

Explorateur de fichiers IFC orienté données. Charge un fichier `.ifc` et affiche une synthèse agrégée de tous les types d'entités, leurs attributs et leurs Psets — sans ligne individuelle, uniquement les statistiques utiles.

**Accès en ligne → [nvalettepro-sudo.github.io/Liste_de_datas/explorer/](https://nvalettepro-sudo.github.io/Liste_de_datas/explorer/)**

---

## Fonctionnalités

- **Chargement local** — le fichier reste sur votre machine, aucun upload serveur
- **Vue agrégée par type** — pour chaque type IFC (IfcWall, IfcDoor…) : nombre d'occurrences, valeurs distinctes, couverture des propriétés
- **Psets Standards et Personnalisés** — séparés, avec taux de remplissage par propriété
- **Recherche globale** — tape un terme pour trouver instantanément tous les types d'entités qui contiennent ce Pset, cette propriété ou cette valeur
- **Vue graphe de relations** — depuis un type sélectionné, explore le fichier comme le graphe orienté qu'il est réellement : matériaux, types, classifications et structure spatiale. Les définitions partagées n'apparaissent qu'une fois, avec le nombre d'occurrences qui pointent vers elles. Double-clic sur un nœud pour l'étendre.
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
