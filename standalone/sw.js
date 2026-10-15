const CACHE='pianolens-standalone-v1';
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(['./','./index.html','./app.js','./catalog.json']))));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('pianolens-standalone-')&&key!==CACHE).map(key=>caches.delete(key))))));
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);if(event.request.method!=='GET'||url.origin!==self.location.origin)return;
  if(event.request.mode==='navigate')event.respondWith(fetch(event.request).catch(()=>caches.match('./index.html')));
  else event.respondWith(caches.match(event.request).then(cached=>cached||fetch(event.request)));
});
