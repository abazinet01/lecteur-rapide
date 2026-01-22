class SpeedReader {
    constructor() {
        this.words = [];
        this.currentIndex = 0;
        this.wpm = 300;
        this.isPlaying = false;
        this.timer = null;

        this.initElements();
        this.initEventListeners();
        this.loadSavedState();
        this.registerServiceWorker();
    }

    initElements() {
        // Input view
        this.inputView = document.getElementById('input-view');
        this.readingView = document.getElementById('reading-view');
        this.textInput = document.getElementById('text-input');
        this.fileInput = document.getElementById('file-input');
        this.startBtn = document.getElementById('start-btn');
        this.wpmSlider = document.getElementById('wpm-slider');
        this.wpmDisplay = document.getElementById('wpm-display');

        // Reading view
        this.wordContainer = document.getElementById('word-container');
        this.wordDisplay = document.getElementById('word-display');
        this.currentWpmDisplay = document.getElementById('current-wpm');
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
        // Input view
        this.startBtn.addEventListener('click', () => this.startReading());
        this.wpmSlider.addEventListener('input', (e) => this.updateWpmFromSlider(e.target.value));
        this.fileInput.addEventListener('change', (e) => this.handleFileUpload(e));

        // Reading view controls
        this.playPauseBtn.addEventListener('click', () => this.togglePlayPause());
        this.backBtn.addEventListener('click', () => this.goBack());
        this.forwardBtn.addEventListener('click', () => this.goForward());
        this.slowerBtn.addEventListener('click', () => this.adjustSpeed(-25));
        this.fasterBtn.addEventListener('click', () => this.adjustSpeed(25));
        this.exitBtn.addEventListener('click', () => this.exitReading());

        // Progress slider
        this.progressSlider.addEventListener('input', (e) => this.seekTo(e.target.value));

        // Tap to pause/play on word container
        this.wordContainer.addEventListener('click', () => this.togglePlayPause());

        // Touch gestures
        this.initTouchGestures();

        // Keyboard controls
        document.addEventListener('keydown', (e) => this.handleKeyboard(e));
    }

    initTouchGestures() {
        let touchStartX = 0;
        let touchStartY = 0;

        this.wordContainer.addEventListener('touchstart', (e) => {
            touchStartX = e.touches[0].clientX;
            touchStartY = e.touches[0].clientY;
        }, { passive: true });

        this.wordContainer.addEventListener('touchend', (e) => {
            const touchEndX = e.changedTouches[0].clientX;
            const touchEndY = e.changedTouches[0].clientY;
            const deltaX = touchEndX - touchStartX;
            const deltaY = touchEndY - touchStartY;

            // Only handle horizontal swipes
            if (Math.abs(deltaX) > 50 && Math.abs(deltaX) > Math.abs(deltaY)) {
                if (deltaX > 0) {
                    this.goBack(5); // Swipe right = go back 5 words
                } else {
                    this.goForward(5); // Swipe left = go forward 5 words
                }
            }
        }, { passive: true });
    }

    handleKeyboard(e) {
        if (this.inputView.classList.contains('active')) return;

        switch(e.code) {
            case 'Space':
                e.preventDefault();
                this.togglePlayPause();
                break;
            case 'ArrowLeft':
                this.goBack();
                break;
            case 'ArrowRight':
                this.goForward();
                break;
            case 'ArrowUp':
                this.adjustSpeed(25);
                break;
            case 'ArrowDown':
                this.adjustSpeed(-25);
                break;
            case 'Escape':
                this.exitReading();
                break;
        }
    }

    handleFileUpload(e) {
        const file = e.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (e) => {
                this.textInput.value = e.target.result;
            };
            reader.readAsText(file);
        }
    }

    updateWpmFromSlider(value) {
        this.wpm = parseInt(value);
        this.wpmDisplay.textContent = this.wpm;
    }

    startReading() {
        const text = this.textInput.value.trim();
        if (!text) {
            alert('Veuillez entrer du texte a lire.');
            return;
        }

        // Parse text into words
        this.words = text.split(/\s+/).filter(word => word.length > 0);
        this.currentIndex = 0;

        // Check for saved position
        const savedText = localStorage.getItem('speedreader-text');
        const savedIndex = localStorage.getItem('speedreader-index');
        if (savedText === text && savedIndex) {
            const resume = confirm('Reprendre a la position ' + savedIndex + '/' + this.words.length + '?');
            if (resume) {
                this.currentIndex = parseInt(savedIndex);
            }
        }

        // Save text for later
        localStorage.setItem('speedreader-text', text);

        // Switch to reading view
        this.inputView.classList.remove('active');
        this.readingView.classList.add('active');

        // Update displays
        this.updateSpeedDisplay();
        this.progressSlider.max = this.words.length - 1;
        this.displayWord();

        // Auto-start
        this.play();
    }

    calculateORP(word) {
        // ORP (Optimal Recognition Point) calculation
        // Position of the red letter based on word length
        const length = word.length;

        if (length <= 1) return 0;
        if (length <= 3) return 0;      // 1st letter
        if (length <= 5) return 1;      // 2nd letter
        if (length <= 9) return 2;      // 3rd letter
        if (length <= 13) return 3;     // 4th letter
        return 4;                        // 5th letter
    }

    renderWordWithORP(word) {
        const orpIndex = this.calculateORP(word);

        // Split word into three parts: before ORP, ORP letter, after ORP
        const before = word.substring(0, orpIndex);
        const orp = word.charAt(orpIndex);
        const after = word.substring(orpIndex + 1);

        // Create HTML with the ORP letter highlighted
        return '<span class="before">' + before + '</span><span class="orp">' + orp + '</span><span class="after">' + after + '</span>';
    }

    displayWord() {
        if (this.currentIndex >= this.words.length) {
            this.pause();
            this.currentIndex = this.words.length - 1;
            return;
        }

        const word = this.words[this.currentIndex];
        const orpIndex = this.calculateORP(word);

        // Render word with ORP highlighted
        this.wordDisplay.innerHTML = this.renderWordWithORP(word);

        // Center the word so that ORP letter is at the center of the screen
        // Calculate offset based on character widths (approximate)
        const beforeWidth = orpIndex;
        const afterWidth = word.length - orpIndex - 1;
        const offset = (afterWidth - beforeWidth) * 0.5; // in "em" units
        this.wordDisplay.style.transform = 'translateX(' + (offset * 0.5) + 'em)';

        // Trigger animation
        this.wordDisplay.classList.remove('animate');
        void this.wordDisplay.offsetWidth; // Force reflow
        this.wordDisplay.classList.add('animate');

        // Update counter and progress
        this.wordCounter.textContent = (this.currentIndex + 1) + ' / ' + this.words.length;
        const progress = (this.currentIndex / (this.words.length - 1)) * 100;
        this.progressBar.style.width = progress + '%';
        this.progressSlider.value = this.currentIndex;

        // Save position
        localStorage.setItem('speedreader-index', this.currentIndex.toString());
    }

    play() {
        if (this.isPlaying) return;
        this.isPlaying = true;
        this.readingView.classList.remove('paused');
        this.playPauseBtn.textContent = '\u23F8';
        this.scheduleNextWord();
    }

    pause() {
        this.isPlaying = false;
        this.readingView.classList.add('paused');
        this.playPauseBtn.textContent = '\u25B6';
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }
    }

    togglePlayPause() {
        if (this.isPlaying) {
            this.pause();
        } else {
            this.play();
        }
    }

    scheduleNextWord() {
        if (!this.isPlaying) return;

        const interval = 60000 / this.wpm; // milliseconds per word

        // Adjust for punctuation - add pause after sentences
        const currentWord = this.words[this.currentIndex] || '';
        let delay = interval;
        if (currentWord.match(/[.!?]$/)) {
            delay += 1000; // Fixed 1 second pause after sentence end
        } else if (currentWord.match(/[,;:]$/)) {
            delay += 300; // Fixed 300ms pause after comma/semicolon
        }

        this.timer = setTimeout(() => {
            this.currentIndex++;
            if (this.currentIndex < this.words.length) {
                this.displayWord();
                this.scheduleNextWord();
            } else {
                this.pause();
                // Show completion message
                this.wordDisplay.innerHTML = '\u2713';
                this.wordDisplay.style.transform = 'none';
            }
        }, delay);
    }

    goBack(count = 1) {
        this.currentIndex = Math.max(0, this.currentIndex - count);
        this.displayWord();
        if (this.isPlaying) {
            clearTimeout(this.timer);
            this.scheduleNextWord();
        }
    }

    goForward(count = 1) {
        this.currentIndex = Math.min(this.words.length - 1, this.currentIndex + count);
        this.displayWord();
        if (this.isPlaying) {
            clearTimeout(this.timer);
            this.scheduleNextWord();
        }
    }

    seekTo(index) {
        this.currentIndex = parseInt(index);
        this.displayWord();
        if (this.isPlaying) {
            clearTimeout(this.timer);
            this.scheduleNextWord();
        }
    }

    adjustSpeed(delta) {
        this.wpm = Math.max(100, Math.min(800, this.wpm + delta));
        this.updateSpeedDisplay();

        // Restart timer with new speed if playing
        if (this.isPlaying) {
            clearTimeout(this.timer);
            this.scheduleNextWord();
        }
    }

    updateSpeedDisplay() {
        this.currentWpmDisplay.textContent = this.wpm + ' WPM';
        this.speedDisplay.textContent = this.wpm + ' WPM';
    }

    exitReading() {
        this.pause();
        this.readingView.classList.remove('active');
        this.inputView.classList.add('active');
    }

    loadSavedState() {
        // Load saved WPM
        const savedWpm = localStorage.getItem('speedreader-wpm');
        if (savedWpm) {
            this.wpm = parseInt(savedWpm);
            this.wpmSlider.value = this.wpm;
            this.wpmDisplay.textContent = this.wpm;
        }

        // Load saved text
        const savedText = localStorage.getItem('speedreader-text');
        if (savedText) {
            this.textInput.value = savedText;
        }
    }

    registerServiceWorker() {
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.register('sw.js')
                .then(reg => console.log('Service Worker registered'))
                .catch(err => console.log('Service Worker registration failed:', err));
        }
    }
}

// Initialize the app
document.addEventListener('DOMContentLoaded', () => {
    window.speedReader = new SpeedReader();
});
