# 小游戏合集

浏览器里打开就能玩的小游戏，纯前端，没有后端和账号。

**在线地址** → https://vagee9157.github.io/mini-games/

## 已经有的

| 游戏 | 地址 | 说明 |
|---|---|---|
| 俄罗斯方块 | [`/tetris/`](tetris/) | 7-bag 发牌、SRS 旋转 + 踢墙、hold、落点虚影、T-spin、combo、back-to-back |

## 怎么玩

**电脑**

| 键 | 作用 |
|---|---|
| `←` `→` | 左右移动（按住连发） |
| `↓` | 软降 |
| `空格` | 硬降，直接落底 |
| `↑` / `X` | 顺时针旋转 |
| `Z` / `Ctrl` | 逆时针旋转 |
| `C` / `Shift` | 暂存当前块 |
| `P` / `Esc` | 暂停 |
| `R` | 重开 |
| `M` | 静音 |

**手机**

左右滑动移动，轻点旋转，快速下扫直接落底，慢慢往下拖是软降。棋盘下面也有一排按钮，点 HOLD 框可以暂存。

## 目录结构

```
index.html          合集首页
assets/shared.css   公共配色和排版，新游戏 link 它就能继承整套外观
tetris/
  index.html
  tetris.css
  tetris.js
```

## 加一款新游戏

1. 新建一个文件夹，比如 `snake/`
2. 里面的 HTML `<link>` 上 `../assets/shared.css`，配色和顶栏就有了
3. 在首页 `index.html` 的 `.grid` 里加一张 `.card live` 卡片，指向新文件夹
4. push，GitHub Pages 会自动更新

## 关于分数

最高分存在浏览器的 localStorage 里，只在这台设备这个浏览器上。清缓存、换设备、开无痕都会丢。
