# 机制测试

每个文件起一个本地静态 server + Playwright，把 `window.__tetris` 当测试接口用。
直接跑：`python3 tools/tests/test_zone.py`

## 写这类测试踩过的坑

- **别把格子标记字面量写死在测试里**。`ZONE` 原本是 `'Z'`，和 Z 型方块撞字母，
  改成 `'@'` 之后所有写死 `'Z'` 的断言集体变成假阳性。一律 `T.ZONE` 读导出面。
- **`el.click()` 点不动状态框的按钮**。处理器有 `if (!e.detail) return`
  （防 touchstart 和 click 重复触发），JS 合成的 click 事件 `detail` 是 0。
  要测真实点击得用 Playwright 的 `page.click()`。
- **在出生点直接 `lockPiece()` 等于顶出**，对局会当场结束。要先手动降到底。
- **瞬发事件（`ms: 0`）不会覆盖 `evActive`**，所以 `evForce('compact')` 顶不掉
  正在进行的 `calm`。要干净状态就重开一局。
- **断言「没发生」时先确认前提成立**。「死行没被消掉」在死行数本来就是 0 的时候
  恒真 —— 本目录的测试因为上面第一条踩过这个。
