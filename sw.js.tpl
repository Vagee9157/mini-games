/* Service Worker —— 让这些游戏在没网的时候也能玩（高铁、地铁、飞机）。
   这个文件由 bump.py 生成，别手改：资源清单和版本号都是算出来的。 */
const CACHE = 'mini-games-__VERSION__';
const ASSETS = __ASSETS__;

// 装好就把所有东西抓下来存着
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(ASSETS.map(u => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())          // 个别资源抓不到也别卡住安装
  );
});

// 换新版时清掉旧缓存
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // 页面本身走「网络优先」：有网时能第一时间拿到新版，没网就用存着的
  if (req.mode === 'navigate'){
    e.respondWith(
      fetch(req)
        .then(res => {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req, { ignoreSearch: true })
          .then(hit => hit || caches.match('./index.html', { ignoreSearch: true })))
    );
    return;
  }

  // 其余（CSS / JS / 图标 / 字体）走「缓存优先」，快且离线可用。
  // 文件名里带内容哈希，变了就是另一个 URL，不会读到旧的。
  e.respondWith(
    caches.match(req, { ignoreSearch: false }).then(hit => {
      if (hit) return hit;
      return fetch(req).then(res => {
        if (res && res.status === 200 && (url.origin === location.origin || res.type === 'opaque')){
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy));
        }
        return res;
      }).catch(() => caches.match(req, { ignoreSearch: true }));
    })
  );
});
