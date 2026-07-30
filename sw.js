/*
 * Les chemins sont relatifs à l'emplacement de ce fichier : l'application est
 * servie depuis un sous-dossier (/lecteur-rapide/) sur GitHub Pages, où des
 * chemins absolus comme « /index.html » pointeraient à côté.
 */
const CACHE_NAME = 'lecteur-rapide-v2';
const ASSETS = [
    './',
    './index.html',
    './style.css',
    './app.js',
    './epub.js',
    './manifest.json',
    './icons/icon-192.png',
    './icons/icon-512.png'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => cache.addAll(ASSETS))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then((names) => Promise.all(
                names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n))
            ))
            .then(() => self.clients.claim())
    );
});

/*
 * On sert le cache tout de suite et on rafraîchit en arrière-plan : hors ligne
 * l'application démarre, en ligne la version suivante est déjà prête.
 */
self.addEventListener('fetch', (event) => {
    const request = event.request;
    if (request.method !== 'GET') return;

    const url = new URL(request.url);
    if (url.origin !== self.location.origin) return;

    /*
     * Le partage arrive en « ?text=… » : chaque article partagé produirait
     * sinon une entrée de cache distincte pour la même page. On sert la page
     * sans tenir compte de la requête, et on ne la remet pas en cache.
     */
    const cacheable = url.search === '';

    event.respondWith(
        caches.open(CACHE_NAME).then(async (cache) => {
            const cached = await cache.match(request, { ignoreSearch: true });

            const network = fetch(request).then((response) => {
                if (cacheable && response && response.ok && response.type === 'basic') {
                    cache.put(request, response.clone());
                }
                return response;
            }).catch(() => null);

            if (cached) return cached;

            const fresh = await network;
            if (fresh) return fresh;

            // Hors ligne sur une adresse inconnue : on retombe sur la page d'accueil.
            if (request.mode === 'navigate') {
                const fallback = await cache.match('./index.html');
                if (fallback) return fallback;
            }
            return Response.error();
        })
    );
});
