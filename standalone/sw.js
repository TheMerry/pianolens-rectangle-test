const CACHE='pianolens-standalone-d408d087bb3e';
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(['./','./index.html','./app.js?v=d408d087bb3e','./upload.html','./upload.js?v=d408d087bb3e','./catalog.json','./library-config.json'].map(url=>new Request(url,{cache:'reload'})))).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('pianolens-standalone-')&&key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);if(event.request.method!=='GET'||url.origin!==self.location.origin)return;
  // User MIDI stays in the player's private IndexedDB cache, never in this shell cache.
  if(url.pathname.startsWith('/api/'))return;
  if(url.pathname.endsWith('/library-config.json')){event.respondWith(fetch(event.request).catch(()=>caches.match(event.request)));return;}
  if(event.request.mode==='navigate')event.respondWith(fetch(event.request).catch(()=>caches.match(url.pathname.endsWith('/upload.html')?'./upload.html':'./index.html')));
  else event.respondWith(caches.match(event.request).then(cached=>cached||fetch(event.request)));
});
