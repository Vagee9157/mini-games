/* Service Worker —— 让这些游戏在没网的时候也能玩（高铁、地铁、飞机）。
   这个文件由 bump.py 生成，别手改：资源清单和版本号都是算出来的。 */
const CACHE = 'mini-games-d2d90feb60';
const ASSETS = [
  "./",
  "./index.html",
  "./manifest.json",
  "./assets/shared.css?v=5c706aa6",
  "./tetris/",
  "./tetris/index.html",
  "./tetris/manifest.json",
  "./tetris/tetris.css?v=90f110b4",
  "./tetris/tetris.js?v=edd07f4f",
  "./minesweeper/",
  "./minesweeper/index.html",
  "./minesweeper/manifest.json",
  "./assets/ui.css?v=03017f7e",
  "./minesweeper/mine.css?v=2df98c8e",
  "./minesweeper/mine.js?v=0921474b",
  "./bubble/",
  "./bubble/index.html",
  "./bubble/manifest.json",
  "./bubble/bubble.css?v=beb1ad39",
  "./bubble/bubble.js?v=2c3dc084",
  "./pool/",
  "./pool/index.html",
  "./pool/manifest.json",
  "./pool/pool.css?v=f3439b39",
  "./pool/pool.js?v=ec2cc007",
  "./crazy/",
  "./crazy/index.html",
  "./crazy/manifest.json",
  "./assets/icons/crazy-180.png",
  "./assets/icons/crazy-192.png",
  "./assets/icons/crazy-512-maskable.png",
  "./assets/icons/crazy-512.png",
  "./assets/icons/favicon-32.png",
  "./assets/icons/icon-180.png",
  "./assets/icons/icon-192.png",
  "./assets/icons/icon-512-maskable.png",
  "./assets/icons/icon-512.png"
];

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
