# Lecteur rapide

Application web de lecture rapide (RSVP) pensée pour le français. Les mots
défilent un à un à une position fixe, avec une lettre colorée au **point de
fixation optimal** : l'œil n'a plus à balayer la ligne, ce qui coupe la
vocalisation intérieure — le fait de « prononcer » mentalement chaque mot, qui
plafonne la vitesse de lecture autour de 250 mots à la minute.

**→ [abazinet01.github.io/lecteur-rapide](https://abazinet01.github.io/lecteur-rapide/)**

Aucune dépendance, aucun build, aucun serveur : cinq fichiers statiques.
Installable comme application (PWA) et pleinement fonctionnelle hors ligne.

## Utilisation

- **Coller** un texte, ou **importer** un fichier `.txt`, `.md` ou `.epub`
- Depuis un téléphone, **partager** un article vers l'application
- Les lectures en cours sont conservées avec leur position

### Commandes

| Geste | Clavier | Effet |
|---|---|---|
| Toucher le mot | `Espace` | Pause / reprise |
| Balayer ← → | `←` `→` | Reculer / avancer |
| Balayer ↑ ↓ | `↑` `↓` | Accélérer / ralentir |
| — | `Échap` | Quitter la lecture |

## Réglages

- **Vitesse** de 100 à 1000 mots/minute
- **Mots par groupe** (1 à 3) — afficher deux ou trois mots d'un coup casse
  davantage la vocalisation et devient plus confortable au-delà de 500 mots/min
- **Rythme naturel** — pauses aux virgules, aux points et aux fins de
  paragraphe, mots longs affichés plus longtemps ; les pauses sont
  proportionnelles à la cadence choisie
- **Repères de fixation**, taille du texte, couleur du point de fixation, thème

## Choix techniques

**Point de fixation mesuré, pas estimé.** La lettre colorée est positionnée par
mesure du DOM plutôt que par une largeur de caractère supposée. Avec une police
proportionnelle, un `m` et un `l` n'ont pas la même largeur : une estimation
faisait dériver le point de fixation de plusieurs dizaines de pixels d'un mot à
l'autre, ce qui annule l'intérêt du procédé.

**Dimensionné pour le français.** La taille du texte s'ajuste pour que la moitié
la plus large du mot tienne dans la demi-largeur de l'écran. Les mots français
sont plus longs que les mots anglais : sans cet ajustement, « accompagnement »
ou « développement » débordent sur un téléphone.

**Lecture d'EPUB sans dépendance.** `epub.js` lit le catalogue central du ZIP
octet par octet et décompresse avec `DecompressionStream('deflate-raw')`, une
API native (Safari 16.4+, Chrome 80+). Les chapitres sont extraits dans l'ordre
de lecture déclaré par le fichier OPF.

**Chemins relatifs.** Le service worker et le manifeste utilisent des chemins
relatifs, l'application étant servie depuis un sous-dossier sur GitHub Pages.

## Fichiers

| Fichier | Rôle |
|---|---|
| `index.html` | Structure des deux vues (saisie, lecture) |
| `app.js` | Lecteur, découpage du texte, rythme, bibliothèque, réglages |
| `epub.js` | Extraction du texte des EPUB (ZIP + OPF) |
| `style.css` | Mise en page, thèmes clair et sombre |
| `sw.js` | Cache hors ligne |

Les textes et réglages restent dans le `localStorage` du navigateur : rien n'est
envoyé nulle part.

## Licence

GPL-3.0 — voir [LICENSE](LICENSE).
