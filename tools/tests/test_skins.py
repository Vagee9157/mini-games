"""配色和画法：五组配色每套七色齐全、合法；十二种画法都画得出来；选了存下来，刷新还在"""
import os, http.server, socketserver, threading, functools, sys
ROOT=os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.chdir(ROOT)
H=functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT); H.log_message=lambda *a,**k:None
socketserver.ThreadingTCPServer.daemon_threads=True; srv=socketserver.ThreadingTCPServer(("127.0.0.1",0),H)
port=srv.server_address[1]; threading.Thread(target=srv.serve_forever,daemon=True).start()
from playwright.sync_api import sync_playwright

JS = r"""async () => {
  const T = __tetris, L = [], $ = id => document.getElementById(id);
  const ok = (c, m) => L.push((c ? 'PASS ' : 'FAIL ') + m);
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const keys = Object.keys(T.PALETTES), grouped = T.PAL_GROUPS.flatMap(g => g[1]);
  ok(keys.length >= 40 && grouped.length === keys.length && new Set(grouped).size === keys.length,
     `${keys.length} 套配色，分 ${T.PAL_GROUPS.length} 组（${T.PAL_GROUPS.map(g => g[0].split(' ')[0] + ' ' + g[1].length).join(' / ')}），每套都在某一组里`);
  const bad = keys.filter(k => 'IOTSZJL'.split('').some(t => !/^(#[0-9a-f]{6}|rgb\(\d+,\d+,\d+\))$/i.test(T.PALETTES[k][t])));
  ok(!bad.length, `每套七种块都有合法颜色${bad.length ? '；坏的：' + bad.join(',') : ''}`);
  const diff = keys.filter(k => !T.PALETTES[k].mono && new Set(Object.values(T.PALETTES[k]).filter(v => typeof v === 'string')).size < 3);
  ok(!diff.length, `非单色的配色至少有 3 种颜色（NES 每级 3 种）${diff.length ? '；不够的：' + diff.join(',') : ''}`);
  ok(Object.keys(T.STYLES).length === 12, `十二种画法：${Object.values(T.STYLES).map(s => s.name).join(' ')}`);

  $('startBtn').click();
  $('menuBtn').click(); $('skinBtn').click(); await wait(200);
  ok(document.querySelectorAll('#palOpts [data-pal]').length === keys.length && document.querySelectorAll('#palOpts .pal-grp').length === T.PAL_GROUPS.length,
     '设置里每套配色一个按钮，带分组小标题');
  // 每种画法 × 几套代表配色都画一遍：不报错、真画出东西
  const cv = document.createElement('canvas'); cv.width = cv.height = 40; const c = cv.getContext('2d');
  let empty = [];
  for (const st of Object.keys(T.STYLES)) for (const pal of ['guide', 'nes0', 'gb', 'white', 'tBlue']){
    document.querySelector(`[data-style="${st}"]`).click(); document.querySelector(`[data-pal="${pal}"]`).click();
    const btn = document.querySelector(`[data-style="${st}"] canvas`);
    const d = btn.getContext('2d').getImageData(0, 0, btn.width, btn.height).data;
    let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++;
    if (n < 50) empty.push(st + '/' + pal);
  }
  ok(!empty.length, `12 种画法 × 5 套配色的预览都画出来了${empty.length ? '；空的：' + empty.join(' ') : ''}`);
  document.querySelector('[data-style="bevel"]').click(); document.querySelector('[data-pal="nes4"]').click();
  ok(T.skin.style === 'bevel' && T.skin.pal === 'nes4' && document.querySelector('[data-pal="nes4"]').classList.contains('on'), '点了就换，按钮亮着');
  $('skinDone').click();
  return L;
}"""

fails = 0
with sync_playwright() as p:
    for eng in ('chromium', 'webkit'):
        b = getattr(p, eng).launch()
        ctx = b.new_context(**p.devices['iPhone 13']); pg = ctx.new_page(); errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.route("**fonts.googleapis.com/**", lambda r: r.abort())
        pg.goto(f"http://127.0.0.1:{port}/tetris/index.html"); pg.wait_for_function("() => !!window.__tetris")
        r = pg.evaluate(JS)
        pg.reload(); pg.wait_for_function("() => !!window.__tetris")
        k = pg.evaluate("() => [__tetris.skin.pal, __tetris.skin.style]")
        r.append(('PASS ' if k == ['nes4', 'bevel'] else 'FAIL ') + f'刷新后还是选的那套（{k}）')
        if errs: r.append('FAIL 页面报错：' + '; '.join(errs))
        print(f'配色和画法（{eng}）')
        for l in r:
            print('  ', l)
            if l.startswith('FAIL'): fails += 1
        b.close()
srv.shutdown(); srv.server_close()
sys.exit(1 if fails else 0)
