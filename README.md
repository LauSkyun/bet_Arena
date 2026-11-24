# 竞猜竞技场 · V1.0.0

在本机用测试积分支持红队或蓝队，累计投入推动建营和升级。封盘后，兵营在六边形棋盘上自动出兵，按拆基地或终局占格决定胜负，再按封盘回报率结算。

**版本范围**　`v1.0.0` 保存兵种更新前的建筑血条版，运行源码对应 `61c5f1b`。本版每队累计投入 **10 点**触发一次强化。100 点可调门槛另见后续分支 `feat/35-bet-threshold`。本版支持竞技场基准和两档 SC 样例数值，三族 27 单位和 GM 面板属于 V2 计划。

## 本机启动

下载并解压本版本，或用下面的命令获取固定版本。

```sh
git clone --branch v1.0.0 --depth 1 https://github.com/LauSkyun/bet_Arena.git
cd bet_Arena
```

在包含本文件的目录执行以下命令。需要 Python 3；Windows 上也可以把 `python3` 换成 `py -3`。

```sh
python3 -m http.server 8766 --bind 127.0.0.1 --directory prototype-playtest
```

用新版 Edge 或 Chrome 打开 <http://127.0.0.1:8766/>。首次试玩有 10,000 点，选红队或蓝队并下注；棋盘显示兵营、等级和兵种。开战后点选格子可看射程和建筑血量。试玩记录保存在当前浏览器的该站点，同一浏览器打开两个标签页会共用同一局和余额。

## 核验与回退

- **运行自动回归。** 在仓库根目录运行 `node --test "prototype-playtest/*.test.mjs"`，使用 Node.js 24。V1 包含 63 项用例。
- **重演导出战局。** 从页面导出 JSON 后运行 `node testing/replay-battle-data.mjs round.json 5000`，查看封盘阵容推演的赛果及第 5 秒棋盘。
- **重新取得 V1。** 下载 `v1.0.0` 标签的源码或重新克隆到单独目录。原回退标签 `arena-before-sc-roster` 和本版本使用相同的运行源码。

## 需求与验收记录

[玩法总纲](requirements/overview.md) · [下注与封盘](requirements/02-betting/requirement.md) · [自动战斗](requirements/04-battle/requirement.md) · [棋盘界面](requirements/06-arena-ui/requirement.md)

[兵种职责与射程](testing/runs/2026-11-24-unit-roles-sc-board-independent.md) · [兵营出兵](testing/runs/2026-11-24-barracks-only-independent.md) · [基地防守](testing/runs/2026-11-24-base-defense-independent.md) · [建筑血条及窄屏复测](testing/runs/2026-11-24-building-health-independent.md)
