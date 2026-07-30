'use strict';

const STORE_SETTINGS = 'lr.settings';
const STORE_LIBRARY = 'lr.library';
const MAX_LIBRARY = 8;
const MAX_TEXT_CHARS = 400000;
const MIN_WORD_PX = 20;

// Ponctuation qui s'accroche au mot suivant plutôt qu'au précédent.
const LEADING_PUNCT = /^[«"'“‘([{¿¡–—-]+$/;
const PUNCT_ONLY = /^[^\p{L}\p{N}]+$/u;
const SENTENCE_END = /[.!?…][»"'’”)\]]*$/;
const CLAUSE_END = /[,;:–—][»"'’”)\]]*$/;

const DEFAULTS = {
    wpm: 300,
    chunkSize: 1,
    fontScale: 1,
    theme: 'auto',
    orpColor: '#ff3b30',
    smartPacing: true,
    guides: true,
    keepAwake: true
};

class SpeedReader {
    constructor() {
        this.words = [];
        this.paragraphEnds = new Set();
        this.currentIndex = 0;
        this.chunkEnd = 0;
        this.isPlaying = false;
        this.timer = null;
        this.wakeLock = null;
        this.docId = null;

        this.settings = this.loadSettings();

        this.initElements();
        this.applySettings();
        this.initEventListeners();
        this.renderLibrary();
        this.consumeSharedText();
        this.registerServiceWorker();
    }

    initElements() {
        this.inputView = document.getElementById('input-view');
        this.readingView = document.getElementById('reading-view');
        this.textInput = document.getElementById('text-input');
        this.fileInput = document.getElementById('file-input');
        this.pasteBtn = document.getElementById('paste-btn');
        this.startBtn = document.getElementById('start-btn');
        this.importStatus = document.getElementById('import-status');
        this.librarySection = document.getElementById('library-section');
        this.libraryList = document.getElementById('library-list');

        this.wpmSlider = document.getElementById('wpm-slider');
        this.wpmDisplay = document.getElementById('wpm-display');
        this.chunkSelect = document.getElementById('chunk-select');
        this.sizeSlider = document.getElementById('size-slider');
        this.sizeDisplay = document.getElementById('size-display');
        this.themeSelect = document.getElementById('theme-select');
        this.orpColorInput = document.getElementById('orp-color');
        this.pacingCheck = document.getElementById('pacing-check');
        this.guidesCheck = document.getElementById('guides-check');
        this.wakeCheck = document.getElementById('wake-check');

        this.wordContainer = document.getElementById('word-container');
        this.wordDisplay = document.getElementById('word-display');
        this.currentWpmDisplay = document.getElementById('current-wpm');
        this.timeLeft = document.getElementById('time-left');
        this.wordCounter = document.getElementById('word-counter');
        this.progressBar = document.getElementById('progress-bar');
        this.progressSlider = document.getElementById('progress-slider');
        this.playPauseBtn = document.getElementById('play-pause-btn');
        this.backBtn = document.getElementById('back-btn');
        this.forwardBtn = document.getElementById('forward-btn');
        this.slowerBtn = document.getElementById('slower-btn');
        this.fasterBtn = document.getElementById('faster-btn');
        this.speedDisplay = document.getElementById('speed-display');
        this.exitBtn = document.getElementById('exit-btn');
    }

    initEventListeners() {
        this.startBtn.addEventListener('click', () => this.startReading());
        this.fileInput.addEventListener('change', (e) => this.handleFileUpload(e));
        this.pasteBtn.addEventListener('click', () => this.pasteFromClipboard());

        this.playPauseBtn.addEventListener('click', () => this.togglePlayPause());
        this.backBtn.addEventListener('click', () => this.goBack());
        this.forwardBtn.addEventListener('click', () => this.goForward());
        this.slowerBtn.addEventListener('click', () => this.adjustSpeed(-25));
        this.fasterBtn.addEventListener('click', () => this.adjustSpeed(25));
        this.exitBtn.addEventListener('click', () => this.exitReading());
        this.progressSlider.addEventListener('input', (e) => this.seekTo(e.target.value));
        this.wordContainer.addEventListener('click', () => this.togglePlayPause());

        // Réglages
        this.wpmSlider.addEventListener('input', (e) => {
            this.settings.wpm = parseInt(e.target.value, 10);
            this.wpmDisplay.textContent = this.settings.wpm;
            this.updateSpeedDisplay();
            this.saveSettings();
        });
        this.chunkSelect.addEventListener('change', (e) => {
            this.settings.chunkSize = parseInt(e.target.value, 10);
            this.saveSettings();
            if (this.words.length) this.displayWord();
        });
        this.sizeSlider.addEventListener('input', (e) => {
            this.settings.fontScale = parseInt(e.target.value, 10) / 100;
            this.sizeDisplay.textContent = e.target.value;
            document.documentElement.style.setProperty('--word-scale', this.settings.fontScale);
            this.saveSettings();
            if (this.words.length) this.displayWord();
        });
        this.themeSelect.addEventListener('change', (e) => {
            this.settings.theme = e.target.value;
            document.documentElement.dataset.theme = e.target.value;
            this.saveSettings();
        });
        this.orpColorInput.addEventListener('input', (e) => {
            this.settings.orpColor = e.target.value;
            document.documentElement.style.setProperty('--orp-color', e.target.value);
            this.saveSettings();
        });
        this.pacingCheck.addEventListener('change', (e) => {
            this.settings.smartPacing = e.target.checked;
            this.saveSettings();
        });
        this.guidesCheck.addEventListener('change', (e) => {
            this.settings.guides = e.target.checked;
            document.body.classList.toggle('guides', e.target.checked);
            this.saveSettings();
        });
        this.wakeCheck.addEventListener('change', (e) => {
            this.settings.keepAwake = e.target.checked;
            this.saveSettings();
            if (!e.target.checked) this.releaseWakeLock();
            else if (this.isPlaying) this.requestWakeLock();
        });

        this.initTouchGestures();
        document.addEventListener('keydown', (e) => this.handleKeyboard(e));

        // Le verrou d'écran est perdu quand l'onglet passe en arrière-plan.
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                if (this.isPlaying) this.pause();
            } else if (this.isPlaying) {
                this.requestWakeLock();
            }
        });

        // Une rotation change la largeur disponible : il faut refaire la mise en page.
        window.addEventListener('resize', () => {
            if (this.words.length && this.readingView.classList.contains('active')) this.layoutWord();
        });
    }

    initTouchGestures() {
        let startX = 0;
        let startY = 0;
        let moved = false;

        this.wordContainer.addEventListener('touchstart', (e) => {
            startX = e.touches[0].clientX;
            startY = e.touches[0].clientY;
            moved = false;
        }, { passive: true });

        this.wordContainer.addEventListener('touchend', (e) => {
            const deltaX = e.changedTouches[0].clientX - startX;
            const deltaY = e.changedTouches[0].clientY - startY;

            if (Math.abs(deltaX) > 50 && Math.abs(deltaX) > Math.abs(deltaY)) {
                moved = true;
                if (deltaX > 0) this.goBack(5);
                else this.goForward(5);
            } else if (Math.abs(deltaY) > 50 && Math.abs(deltaY) > Math.abs(deltaX)) {
                moved = true;
                this.adjustSpeed(deltaY < 0 ? 25 : -25);
            }
            // Un balayage ne doit pas aussi déclencher le clic de pause.
            if (moved) e.preventDefault();
        });
    }

    handleKeyboard(e) {
        if (!this.readingView.classList.contains('active')) return;
        if (e.target.matches('input, textarea, select')) return;

        switch (e.code) {
            case 'Space': e.preventDefault(); this.togglePlayPause(); break;
            case 'ArrowLeft': e.preventDefault(); this.goBack(); break;
            case 'ArrowRight': e.preventDefault(); this.goForward(); break;
            case 'ArrowUp': e.preventDefault(); this.adjustSpeed(25); break;
            case 'ArrowDown': e.preventDefault(); this.adjustSpeed(-25); break;
            case 'Escape': this.exitReading(); break;
        }
    }

    /* ---------- Entrée du texte ---------- */

    setStatus(message, isError) {
        this.importStatus.textContent = message || '';
        this.importStatus.classList.toggle('error', !!isError);
    }

    async pasteFromClipboard() {
        try {
            const text = await navigator.clipboard.readText();
            if (text && text.trim()) {
                this.textInput.value = text;
                this.setStatus(this.countWords(text) + ' mots collés.');
            } else {
                this.setStatus('Le presse-papier est vide.', true);
            }
        } catch (err) {
            this.setStatus('Le navigateur a refusé l’accès au presse-papier. Collez le texte à la main.', true);
        }
    }

    countWords(text) {
        return text.trim().split(/\s+/).filter(Boolean).length;
    }

    async handleFileUpload(e) {
        const file = e.target.files[0];
        if (!file) return;
        const name = file.name.toLowerCase();

        try {
            if (name.endsWith('.epub')) {
                this.setStatus('Lecture de l’EPUB en cours…');
                const result = await window.extraireTexteEpub(file);
                this.textInput.value = result.texte;
                this.pendingTitle = result.titre || file.name.replace(/\.epub$/i, '');
            } else {
                let text = await file.text();
                if (/\.(md|markdown)$/.test(name)) text = this.stripMarkdown(text);
                this.textInput.value = text;
                this.pendingTitle = file.name.replace(/\.[^.]+$/, '');
            }
            this.setStatus(this.countWords(this.textInput.value) + ' mots importés.');
        } catch (err) {
            this.setStatus(err.message || 'Impossible de lire ce fichier.', true);
        } finally {
            e.target.value = '';
        }
    }

    stripMarkdown(text) {
        return text
            .replace(/^---\n[\s\S]*?\n---\n/, '')          // frontmatter YAML
            .replace(/```[\s\S]*?```/g, '')                 // blocs de code
            .replace(/`([^`]+)`/g, '$1')
            .replace(/!\[[^\]]*\]\([^)]*\)/g, '')           // images
            .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')        // liens
            .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (m, a, b) => b || a)  // wikiliens
            .replace(/^\s{0,3}#{1,6}\s+/gm, '')             // titres
            .replace(/^\s{0,3}>\s?/gm, '')                  // citations
            .replace(/^\s*[-*+]\s+/gm, '')                  // listes
            .replace(/\*\*([^*]+)\*\*|__([^_]+)__/g, '$1$2')
            .replace(/\*([^*]+)\*|_([^_]+)_/g, '$1$2')
            .replace(/^\s{0,3}([-*_]\s*){3,}$/gm, '')       // règles horizontales
            .replace(/\n{3,}/g, '\n\n')
            .trim();
    }

    // Le partage iOS/Android arrive en paramètre d'URL (voir share_target du manifeste).
    consumeSharedText() {
        const params = new URLSearchParams(location.search);
        const shared = [params.get('title'), params.get('text'), params.get('url')]
            .filter(Boolean).join('\n\n');
        if (shared) {
            this.textInput.value = shared;
            this.setStatus(this.countWords(shared) + ' mots reçus par partage.');
            history.replaceState(null, '', location.pathname);
        }
    }

    /* ---------- Découpage du texte ---------- */

    tokenize(text) {
        const words = [];
        const paragraphEnds = new Set();

        text.split(/\n{2,}/).forEach((paragraph) => {
            const raw = paragraph.split(/\s+/).filter(Boolean);
            const clean = [];
            let pending = '';

            raw.forEach((token) => {
                const isPunct = PUNCT_ONLY.test(token);
                if (isPunct && LEADING_PUNCT.test(token)) {
                    pending += token + ' ';
                    return;
                }
                // Une espace insécable avant « ; » sépare le signe du mot : on le recolle.
                if (isPunct && clean.length && !pending) {
                    clean[clean.length - 1] += ' ' + token;
                    return;
                }
                clean.push(pending + token);
                pending = '';
            });

            if (pending) {
                if (clean.length) clean[clean.length - 1] += ' ' + pending.trim();
                else clean.push(pending.trim());
            }
            if (clean.length) {
                words.push.apply(words, clean);
                paragraphEnds.add(words.length - 1);
            }
        });

        return { words, paragraphEnds };
    }

    // Fin (exclue) du groupe qui commence à startIndex.
    computeChunkEnd(startIndex) {
        const end = Math.min(startIndex + this.settings.chunkSize, this.words.length);
        // Ne jamais enjamber une fin de phrase ou de paragraphe : ça casse la lisibilité.
        for (let i = startIndex; i < end - 1; i++) {
            if (SENTENCE_END.test(this.words[i]) || this.paragraphEnds.has(i)) return i + 1;
        }
        return end;
    }

    /* ---------- Point de fixation ---------- */

    calculateORP(chars) {
        const n = chars.length;
        if (n <= 3) return 0;
        if (n <= 5) return 1;
        if (n <= 9) return 2;
        if (n <= 13) return 3;
        // Au-delà (mots français longs, groupes de mots), on reste vers 30 % du début.
        return Math.min(Math.floor(n * 0.3), 8);
    }

    renderWordWithORP(text) {
        // Array.from évite de couper une lettre accentuée composée en deux.
        const chars = Array.from(text);
        const orpIndex = this.calculateORP(chars);
        const before = chars.slice(0, orpIndex).join('');
        const orp = chars[orpIndex] || '';
        const after = chars.slice(orpIndex + 1).join('');

        const span = (cls, value) => {
            const el = document.createElement('span');
            el.className = cls;
            el.textContent = value;
            return el;
        };

        this.wordDisplay.replaceChildren(
            span('before', before),
            span('orp', orp),
            span('after', after)
        );
    }

    /*
     * Place la lettre colorée pile au centre de l'écran, sans qu'aucune lettre
     * ne sorte du cadre. On mesure au lieu d'estimer : la police est
     * proportionnelle, un « m » et un « l » n'ont pas la même largeur.
     *
     * La contrainte n'est pas que le mot tienne à l'écran, mais que sa moitié
     * la plus large tienne dans la demi-largeur : c'est ce qui garde l'œil
     * immobile sur les mots français longs (« accompagnement »,
     * « développement »), plus longs que les mots anglais.
     */
    layoutWord() {
        const display = this.wordDisplay;
        const container = this.wordContainer;
        const orpEl = display.querySelector('.orp');

        display.style.transform = 'none';
        display.style.fontSize = '';

        const padding = 12;
        const available = container.clientWidth - padding * 2;
        if (available <= 0 || !orpEl) return;

        // Demi-largeur nécessaire de part et d'autre du centre de la lettre colorée.
        const halfWidth = () => {
            const d = display.getBoundingClientRect();
            const o = orpEl.getBoundingClientRect();
            const centre = o.left + o.width / 2;
            return Math.max(centre - d.left, d.right - centre);
        };

        const needed = halfWidth() * 2;
        if (needed > available) {
            const basePx = parseFloat(getComputedStyle(display).fontSize);
            display.style.fontSize =
                Math.max(MIN_WORD_PX, Math.floor(basePx * available / needed)) + 'px';
        }

        const finalPx = parseFloat(getComputedStyle(display).fontSize);
        this.readingView.style.setProperty('--word-px', finalPx + 'px');

        const cRect = container.getBoundingClientRect();
        const dRect = display.getBoundingClientRect();
        const oRect = orpEl.getBoundingClientRect();

        let dx = (cRect.left + cRect.width / 2) - (oRect.left + oRect.width / 2);

        // Filet de sécurité si la taille plancher n'a pas suffi : on préfère
        // décaler le point de fixation plutôt que couper des lettres.
        const minDx = cRect.left + padding - dRect.left;
        const maxDx = cRect.right - padding - dRect.right;
        if (minDx <= maxDx) dx = Math.min(Math.max(dx, minDx), maxDx);
        else dx = 0;

        display.style.transform = 'translateX(' + Math.round(dx) + 'px)';
    }

    /* ---------- Lecture ---------- */

    startReading() {
        const text = this.textInput.value.trim();
        if (!text) {
            this.setStatus('Ajoutez d’abord un texte à lire.', true);
            this.textInput.focus();
            return;
        }
        if (text.length > MAX_TEXT_CHARS) {
            this.setStatus('Texte trop long : seuls les ' + MAX_TEXT_CHARS.toLocaleString('fr-CA') +
                ' premiers caractères seront lus.', true);
        }

        const doc = this.upsertDocument(text.slice(0, MAX_TEXT_CHARS), this.pendingTitle);
        this.pendingTitle = null;
        this.openDocument(doc);
    }

    openDocument(doc) {
        const parsed = this.tokenize(doc.text);
        if (!parsed.words.length) {
            this.setStatus('Aucun mot lisible dans ce texte.', true);
            return;
        }

        this.words = parsed.words;
        this.paragraphEnds = parsed.paragraphEnds;
        this.docId = doc.id;
        this.currentIndex = Math.min(doc.index || 0, this.words.length - 1);

        this.inputView.classList.remove('active');
        this.readingView.classList.add('active');

        this.progressSlider.max = Math.max(0, this.words.length - 1);
        this.updateSpeedDisplay();
        this.displayWord();
        this.play();
    }

    displayWord() {
        if (this.currentIndex >= this.words.length) this.currentIndex = this.words.length - 1;
        if (this.currentIndex < 0) this.currentIndex = 0;

        this.chunkEnd = this.computeChunkEnd(this.currentIndex);
        const chunk = this.words.slice(this.currentIndex, this.chunkEnd).join(' ');

        this.renderWordWithORP(chunk);
        this.layoutWord();

        this.wordDisplay.classList.remove('animate');
        void this.wordDisplay.offsetWidth;
        this.wordDisplay.classList.add('animate');

        this.updateProgress();
        this.saveProgress();
    }

    updateProgress() {
        const total = this.words.length;
        this.wordCounter.textContent = (this.currentIndex + 1) + ' / ' + total;

        const ratio = total > 1 ? this.currentIndex / (total - 1) : 1;
        this.progressBar.style.width = (ratio * 100) + '%';
        this.progressSlider.value = this.currentIndex;

        const minutes = (total - this.currentIndex) / this.settings.wpm;
        this.timeLeft.textContent = minutes >= 1
            ? 'reste ' + Math.round(minutes) + ' min'
            : 'reste moins de 1 min';
    }

    /*
     * Durée d'affichage du groupe. Les pauses sont proportionnelles à la
     * cadence : une pause fixe de 1 s après un point est imperceptible à
     * 150 mots/min et interminable à 800.
     */
    chunkDelay() {
        const base = 60000 / this.settings.wpm;
        const chunk = this.words.slice(this.currentIndex, this.chunkEnd);
        let delay = base * chunk.length;

        if (!this.settings.smartPacing) return delay;

        const avgLength = chunk.join(' ').length / chunk.length;
        if (avgLength > 6) delay *= 1 + Math.min((avgLength - 6) * 0.05, 0.6);

        const last = chunk[chunk.length - 1] || '';
        const lastIndex = this.chunkEnd - 1;
        if (this.paragraphEnds.has(lastIndex)) delay += base * 3;
        else if (SENTENCE_END.test(last)) delay += base * 2.2;
        else if (CLAUSE_END.test(last)) delay += base;

        return delay;
    }

    play() {
        if (this.isPlaying || !this.words.length) return;
        if (this.currentIndex >= this.words.length - 1) this.currentIndex = 0;

        this.isPlaying = true;
        this.readingView.classList.remove('paused');
        this.playPauseBtn.classList.add('is-playing');
        this.playPauseBtn.setAttribute('aria-label', 'Pause');
        this.requestWakeLock();
        this.displayWord();
        this.scheduleNextWord();
    }

    pause() {
        this.isPlaying = false;
        this.saveProgress(true);
        this.readingView.classList.add('paused');
        this.playPauseBtn.classList.remove('is-playing');
        this.playPauseBtn.setAttribute('aria-label', 'Lecture');
        this.releaseWakeLock();
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }
    }

    togglePlayPause() {
        if (this.isPlaying) this.pause();
        else this.play();
    }

    scheduleNextWord() {
        if (!this.isPlaying) return;
        if (this.timer) clearTimeout(this.timer);

        this.timer = setTimeout(() => {
            this.currentIndex = this.chunkEnd;
            if (this.currentIndex < this.words.length) {
                this.displayWord();
                this.scheduleNextWord();
            } else {
                this.currentIndex = this.words.length - 1;
                this.pause();
                this.saveProgress(true, 0);
                this.wordDisplay.replaceChildren();
                this.wordDisplay.style.transform = 'none';
                this.wordDisplay.textContent = 'Terminé';
                this.updateProgress();
            }
        }, this.chunkDelay());
    }

    goBack(count) {
        this.step(-(count || this.settings.chunkSize));
    }

    goForward(count) {
        this.step(count || this.settings.chunkSize);
    }

    step(delta) {
        this.currentIndex = Math.max(0, Math.min(this.words.length - 1, this.currentIndex + delta));
        this.displayWord();
        if (this.isPlaying) this.scheduleNextWord();
    }

    seekTo(index) {
        this.currentIndex = parseInt(index, 10) || 0;
        this.displayWord();
        if (this.isPlaying) this.scheduleNextWord();
    }

    adjustSpeed(delta) {
        this.settings.wpm = Math.max(100, Math.min(1000, this.settings.wpm + delta));
        this.wpmSlider.value = this.settings.wpm;
        this.wpmDisplay.textContent = this.settings.wpm;
        this.updateSpeedDisplay();
        this.updateProgress();
        this.saveSettings();
        if (this.isPlaying) this.scheduleNextWord();
    }

    updateSpeedDisplay() {
        const label = this.settings.wpm + ' mots/min';
        this.currentWpmDisplay.textContent = label;
        this.speedDisplay.textContent = label;
    }

    exitReading() {
        this.pause();
        this.readingView.classList.remove('active');
        this.inputView.classList.add('active');
        this.renderLibrary();
    }

    /* ---------- Verrou d'écran ---------- */

    async requestWakeLock() {
        if (!this.settings.keepAwake || !('wakeLock' in navigator) || this.wakeLock) return;
        try {
            this.wakeLock = await navigator.wakeLock.request('screen');
            this.wakeLock.addEventListener('release', () => { this.wakeLock = null; });
        } catch (err) {
            this.wakeLock = null;
        }
    }

    releaseWakeLock() {
        if (this.wakeLock) {
            this.wakeLock.release().catch(() => {});
            this.wakeLock = null;
        }
    }

    /* ---------- Réglages et bibliothèque ---------- */

    loadSettings() {
        let stored = {};
        try {
            stored = JSON.parse(localStorage.getItem(STORE_SETTINGS)) || {};
        } catch (err) {
            stored = {};
        }
        // Reprise de l'ancienne clé de vitesse.
        const legacyWpm = parseInt(localStorage.getItem('speedreader-wpm'), 10);
        if (!stored.wpm && legacyWpm) stored.wpm = legacyWpm;
        return Object.assign({}, DEFAULTS, stored);
    }

    saveSettings() {
        try {
            localStorage.setItem(STORE_SETTINGS, JSON.stringify(this.settings));
        } catch (err) { /* stockage plein ou navigation privée */ }
    }

    applySettings() {
        const s = this.settings;
        document.documentElement.dataset.theme = s.theme;
        document.documentElement.style.setProperty('--orp-color', s.orpColor);
        document.documentElement.style.setProperty('--word-scale', s.fontScale);
        document.body.classList.toggle('guides', s.guides);

        this.wpmSlider.value = s.wpm;
        this.wpmDisplay.textContent = s.wpm;
        this.chunkSelect.value = String(s.chunkSize);
        this.sizeSlider.value = Math.round(s.fontScale * 100);
        this.sizeDisplay.textContent = Math.round(s.fontScale * 100);
        this.themeSelect.value = s.theme;
        this.orpColorInput.value = s.orpColor;
        this.pacingCheck.checked = s.smartPacing;
        this.guidesCheck.checked = s.guides;
        this.wakeCheck.checked = s.keepAwake;

        this.updateSpeedDisplay();
        if (!navigator.clipboard || !navigator.clipboard.readText) this.pasteBtn.remove();
        else this.pasteBtn.hidden = false;
    }

    loadLibrary() {
        try {
            const raw = JSON.parse(localStorage.getItem(STORE_LIBRARY));
            if (Array.isArray(raw)) return raw;
        } catch (err) { /* ignoré */ }

        // Migration du texte unique conservé par l'ancienne version.
        const legacyText = localStorage.getItem('speedreader-text');
        if (legacyText) {
            const entry = this.makeDocument(legacyText, null);
            entry.index = parseInt(localStorage.getItem('speedreader-index'), 10) || 0;
            localStorage.removeItem('speedreader-text');
            localStorage.removeItem('speedreader-index');
            return [entry];
        }
        return [];
    }

    saveLibrary(library) {
        const trimmed = library
            .sort((a, b) => b.updatedAt - a.updatedAt)
            .slice(0, MAX_LIBRARY);
        try {
            localStorage.setItem(STORE_LIBRARY, JSON.stringify(trimmed));
        } catch (err) {
            // Quota dépassé : on ne garde que les trois lectures les plus récentes.
            try {
                localStorage.setItem(STORE_LIBRARY, JSON.stringify(trimmed.slice(0, 3)));
            } catch (err2) { /* tant pis, la session reste utilisable */ }
        }
        return trimmed;
    }

    hash(text) {
        let h = 2166136261;
        for (let i = 0; i < text.length; i++) {
            h ^= text.charCodeAt(i);
            h = Math.imul(h, 16777619);
        }
        return (h >>> 0).toString(36) + '-' + text.length.toString(36);
    }

    makeDocument(text, title) {
        const firstLine = text.trim().split('\n')[0].slice(0, 70);
        return {
            id: this.hash(text),
            title: (title || firstLine || 'Sans titre').trim(),
            text: text,
            index: 0,
            words: this.countWords(text),
            updatedAt: Date.now()
        };
    }

    upsertDocument(text, title) {
        const library = this.loadLibrary();
        const doc = this.makeDocument(text, title);
        const existing = library.find((d) => d.id === doc.id);

        if (existing) {
            existing.updatedAt = Date.now();
            if (title) existing.title = title;
            this.saveLibrary(library);
            return existing;
        }

        library.push(doc);
        this.saveLibrary(library);
        return doc;
    }

    /*
     * Sauver à chaque mot relirait tout le JSON de la bibliothèque cinq fois
     * par seconde (un livre importé pèse plusieurs centaines de kilo-octets).
     * On espace les écritures ; pause() et exitReading() forcent la dernière.
     * atIndex sert à remettre le texte terminé à zéro pour une relecture.
     */
    saveProgress(force, atIndex) {
        if (!this.docId) return;
        const now = Date.now();
        if (!force && now - (this.lastSave || 0) < 2000) return;
        this.lastSave = now;

        const library = this.loadLibrary();
        const doc = library.find((d) => d.id === this.docId);
        if (!doc) return;
        doc.index = atIndex !== undefined ? atIndex : this.currentIndex;
        doc.updatedAt = Date.now();
        this.saveLibrary(library);
    }

    renderLibrary() {
        const library = this.loadLibrary();
        this.libraryList.replaceChildren();
        this.librarySection.hidden = library.length === 0;
        if (!library.length) return;

        library.forEach((doc) => {
            const percent = doc.words > 1 ? Math.round((doc.index / (doc.words - 1)) * 100) : 0;

            const open = document.createElement('button');
            open.type = 'button';
            open.className = 'library-open';
            open.innerHTML = '<span class="library-title"></span><span class="library-meta"></span>';
            open.querySelector('.library-title').textContent = doc.title;
            open.querySelector('.library-meta').textContent =
                doc.words.toLocaleString('fr-CA') + ' mots · ' + percent + ' % lu';
            open.addEventListener('click', () => {
                this.textInput.value = doc.text;
                this.openDocument(doc);
            });

            const remove = document.createElement('button');
            remove.type = 'button';
            remove.className = 'library-delete';
            remove.textContent = '✕';
            remove.setAttribute('aria-label', 'Retirer « ' + doc.title +' » de la liste');
            remove.addEventListener('click', () => {
                this.saveLibrary(this.loadLibrary().filter((d) => d.id !== doc.id));
                this.renderLibrary();
            });

            const item = document.createElement('li');
            item.className = 'library-item';
            item.append(open, remove);
            this.libraryList.append(item);
        });
    }

    registerServiceWorker() {
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.register('sw.js').catch(() => {});
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    window.speedReader = new SpeedReader();
});
