// 인터넷이 없어도 앱이 열리게 하는 서비스 워커.
// 온라인이면 늘 새 파일을 받아 저장해 두고, 끊기면 저장해 둔 것으로 답한다. 그래서 업데이트는 다음 접속에 바로 반영된다.
// ponytail: 전부 '네트워크 먼저'라 느린 망에서는 응답을 끝까지 기다리고, 받을 때마다 다시 저장한다.
//           답답해지면 사전(data/words.txt)과 뜻 풀이만 '저장본 먼저'로 바꾸고 판 번호를 붙인다.
const CACHE = 'kkeutmal';
const mine = (url) => new URL(url, location.href).origin === location.origin;
const store = (work) => caches.open(CACHE).then(work);

self.addEventListener('install', (event) => {
  event.waitUntil(store((cache) => cache.add('./')).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || !mine(request.url)) return; // 글꼴 같은 다른 사이트 요청은 브라우저에 맡긴다
  if (new URL(request.url).pathname.endsWith('/version.json')) return; // 배포 상태는 늘 새로 읽어야 해서 저장하지 않는다
  // HTTP 캐시(GitHub Pages 는 10분)를 다시 확인해, 새 버전이 나왔을 때 새로 고치면 바로 새 파일이 온다.
  // 페이지 이동 요청에는 옵션을 붙일 수 없어 그대로 보낸다 (새로 고침이 알아서 다시 확인한다).
  event.respondWith(fetch(request, request.mode === 'navigate' ? undefined : { cache: 'no-cache' }).then((response) => {
    if (response.ok) {
      const copy = response.clone();
      event.waitUntil(store((cache) => cache.put(request, copy)));
    }
    return response;
  }, async () => (await caches.match(request))
    // 저장한 적 없는 주소(index.html 등)로 앱을 열어도 첫 화면은 보여 준다
    ?? (request.mode === 'navigate' ? await caches.match('./') : undefined)
    ?? Response.error()));
});

// 첫 방문에서는 서비스 워커가 페이지보다 늦게 켜져, 그 전에 받은 파일을 놓친다.
// 페이지가 받은 파일 목록을 알려 주면 빠진 것만 채운다.
self.addEventListener('message', (event) => {
  const urls = Array.isArray(event.data) ? event.data.filter((url) => typeof url === 'string' && mine(url)) : [];
  event.waitUntil(store((cache) => Promise.all(urls.map(async (url) => (await cache.match(url)) ?? cache.add(url).catch(() => {})))));
});
