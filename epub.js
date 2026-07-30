/*
 * Lecture d'EPUB sans aucune dépendance externe.
 * On lit le catalogue central du ZIP à la main et on décompresse avec
 * DecompressionStream('deflate-raw'), disponible sur Safari 16.4+ et Chrome 80+.
 */
(function () {
    'use strict';

    const SIG_EOCD = 0x06054b50;
    const SIG_CENTRAL = 0x02014b50;
    const decodeur = new TextDecoder('utf-8');

    // Construit l'index des fichiers du ZIP sans rien décompresser.
    function lireCatalogue(buffer) {
        const dv = new DataView(buffer);
        const u8 = new Uint8Array(buffer);
        const debutRecherche = Math.max(0, buffer.byteLength - 22 - 65535);

        let eocd = -1;
        for (let i = buffer.byteLength - 22; i >= debutRecherche; i--) {
            if (dv.getUint32(i, true) === SIG_EOCD) { eocd = i; break; }
        }
        if (eocd < 0) throw new Error('Ce fichier n’est pas une archive EPUB valide.');

        const nbEntrees = dv.getUint16(eocd + 10, true);
        let pos = dv.getUint32(eocd + 16, true);
        const entrees = new Map();

        for (let i = 0; i < nbEntrees; i++) {
            if (pos + 46 > buffer.byteLength || dv.getUint32(pos, true) !== SIG_CENTRAL) break;

            const methode = dv.getUint16(pos + 10, true);
            const tailleCompressee = dv.getUint32(pos + 20, true);
            const longNom = dv.getUint16(pos + 28, true);
            const longExtra = dv.getUint16(pos + 30, true);
            const longCommentaire = dv.getUint16(pos + 32, true);
            const decalageLocal = dv.getUint32(pos + 42, true);
            const nom = decodeur.decode(u8.subarray(pos + 46, pos + 46 + longNom));

            // L'en-tête local a ses propres longueurs de nom et d'extra : il faut les relire.
            if (decalageLocal + 30 <= buffer.byteLength) {
                const longNomLocal = dv.getUint16(decalageLocal + 26, true);
                const longExtraLocal = dv.getUint16(decalageLocal + 28, true);
                const debutDonnees = decalageLocal + 30 + longNomLocal + longExtraLocal;
                entrees.set(nom, {
                    methode: methode,
                    donnees: u8.subarray(debutDonnees, debutDonnees + tailleCompressee)
                });
            }

            pos += 46 + longNom + longExtra + longCommentaire;
        }

        if (!entrees.size) throw new Error('Archive EPUB vide ou illisible.');
        return entrees;
    }

    async function decompresser(entree) {
        if (!entree) return null;
        if (entree.methode === 0) return entree.donnees;          // stocké tel quel
        if (entree.methode !== 8) return null;                     // méthode non gérée
        const flux = new Blob([entree.donnees]).stream()
            .pipeThrough(new DecompressionStream('deflate-raw'));
        return new Uint8Array(await new Response(flux).arrayBuffer());
    }

    async function lireTexte(entrees, chemin) {
        const octets = await decompresser(entrees.get(chemin));
        return octets ? decodeur.decode(octets) : null;
    }

    // Résout « OEBPS/../images/x.png » en « images/x.png ».
    function normaliserChemin(chemin) {
        const parties = [];
        chemin.split('/').forEach(function (p) {
            if (p === '.' || p === '') return;
            if (p === '..') parties.pop();
            else parties.push(p);
        });
        return parties.join('/');
    }

    function texteDepuisDocument(doc) {
        const corps = doc.body || doc.documentElement;
        if (!corps) return '';

        corps.querySelectorAll('script, style, svg, sup.calibre_, nav').forEach(function (n) { n.remove(); });
        corps.querySelectorAll('br').forEach(function (br) {
            br.replaceWith(doc.createTextNode('\n'));
        });
        corps.querySelectorAll('p, div, h1, h2, h3, h4, h5, h6, li, blockquote, section, article, tr, pre, figcaption')
            .forEach(function (el) { el.appendChild(doc.createTextNode('\n\n')); });

        return corps.textContent || '';
    }

    function nettoyer(texte) {
        return texte
            .replace(/\r\n?/g, '\n')
            .replace(/[ \t]+/g, ' ')
            .replace(/[ \t]*\n[ \t]*/g, '\n')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
    }

    /**
     * Extrait le texte d'un EPUB, chapitres dans l'ordre de lecture.
     * @param {File|Blob} fichier
     * @returns {Promise<{titre: string|null, texte: string}>}
     */
    async function extraireTexteEpub(fichier) {
        if (typeof DecompressionStream === 'undefined') {
            throw new Error('Ce navigateur ne sait pas décompresser les EPUB. Utilisez un fichier .txt.');
        }

        const entrees = lireCatalogue(await fichier.arrayBuffer());

        const container = await lireTexte(entrees, 'META-INF/container.xml');
        if (!container) throw new Error('EPUB incomplet : META-INF/container.xml est absent.');

        const cheminOpf = (container.match(/full-path\s*=\s*"([^"]+)"/) || [])[1];
        if (!cheminOpf) throw new Error('EPUB incomplet : impossible de trouver le fichier OPF.');

        const opf = await lireTexte(entrees, normaliserChemin(cheminOpf));
        if (!opf) throw new Error('EPUB incomplet : le fichier OPF est illisible.');

        const docOpf = new DOMParser().parseFromString(opf, 'application/xml');
        const base = cheminOpf.includes('/') ? cheminOpf.slice(0, cheminOpf.lastIndexOf('/') + 1) : '';

        const titre = (docOpf.getElementsByTagName('dc:title')[0] ||
                       docOpf.getElementsByTagName('title')[0] || {}).textContent || null;

        const parId = {};
        Array.prototype.forEach.call(docOpf.getElementsByTagName('item'), function (item) {
            parId[item.getAttribute('id')] = item.getAttribute('href');
        });

        const ordre = Array.prototype.map.call(
            docOpf.getElementsByTagName('itemref'),
            function (ref) { return parId[ref.getAttribute('idref')]; }
        ).filter(Boolean);

        if (!ordre.length) throw new Error('EPUB sans ordre de lecture exploitable.');

        const morceaux = [];
        for (const href of ordre) {
            const chemin = normaliserChemin(base + decodeURIComponent(href.split('#')[0]));
            const source = await lireTexte(entrees, chemin);
            if (!source) continue;

            // Beaucoup d'EPUB ont du XHTML légèrement invalide : on retombe sur text/html.
            let doc = new DOMParser().parseFromString(source, 'application/xhtml+xml');
            if (doc.getElementsByTagName('parsererror').length) {
                doc = new DOMParser().parseFromString(source, 'text/html');
            }

            const morceau = nettoyer(texteDepuisDocument(doc));
            if (morceau) morceaux.push(morceau);
        }

        const texte = nettoyer(morceaux.join('\n\n'));
        if (!texte) throw new Error('Aucun texte lisible trouvé dans cet EPUB.');

        return { titre: titre ? titre.trim() : null, texte: texte };
    }

    window.extraireTexteEpub = extraireTexteEpub;
})();
