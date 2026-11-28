# 竞猜竞技场

## V2.1 地面试玩

匿名地面整局已通过 #game研讨会:#48 体验，固定版本为 [`v2.1.0`](https://github.com/LauSkyun/bet_Arena/tree/v2.1.0)。包含 19 种地面兵、完整战局包和 GM 导入重播。工作脑的匿名试玩入口为 <http://localhost:8766/arena-v21/>。

[项目指引](AGENTS.md) · [当前玩法](requirements/overview.md#5-v21-地面版与验收入口) · [测试档案](testing/README.md) · [功能知识](knowledge/README.md)

## 同局多人内测

[`v2.1.1`](https://github.com/LauSkyun/bet_Arena/tree/v2.1.1) 在地面版基础上发布同局多人、账号历史、奖池和白名单账号 GM 设置。在该版本根目录用 Node.js 24 运行 `node server/http.mjs`，默认入口 <http://localhost:8780/>。输入同一试玩用户名可续接余额与历史。[启动说明](requirements/08-shared-arena/implementation.md) · [整合版测试档案](testing/README.md#v211-多人奖池整合版)

## 已发布的 V1.1.0

在本机用测试积分支持红队或蓝队，累计投入推动建营和升级。封盘后，兵营在六边形棋盘上自动出兵，按拆基地或终局占格决定胜负，再按封盘回报率结算。

**版本范围**　`v1.1.0` 是三族兵种更新前、强化门槛可调的试玩版本，运行源码对应 `82d3ec8`。默认每队累计 **100 点**强化一次，系统参照投入计入本队累计；在「下一轮设置」可修改门槛，保存后从下一轮开局生效。本版支持竞技场基准和两档 SC 样例数值；三族 27 单位和 GM 面板属于 V2 计划。

| 固定版本 | 试玩口径 | 获取源码 |
|---|---|---|
| V1.1.0 | 可设门槛，默认 100 点，含建筑血条、基地反击和战局导出 | [代码](https://github.com/LauSkyun/bet_Arena/tree/v1.1.0) · [下载 ZIP](https://github.com/LauSkyun/bet_Arena/archive/refs/tags/v1.1.0.zip) |
| V1.0.0 | 固定 10 点门槛，对应原 `arena-before-sc-roster` 血条版 | [代码](https://github.com/LauSkyun/bet_Arena/tree/v1.0.0) · [下载 ZIP](https://github.com/LauSkyun/bet_Arena/archive/refs/tags/v1.0.0.zip) |

## 本机启动

以下静态启动命令以历史标签 `v1.1.0` 为例。按已发布地面版复现时，将克隆标签换成 `v2.1.0`。

```sh
git clone --branch v1.1.0 --depth 1 https://github.com/LauSkyun/bet_Arena.git
cd bet_Arena
```

在包含本文件的目录执行以下命令。需要 Python 3；Windows 上也可以把 `python3` 换成 `py -3`。

```sh
python3 -m http.server 8766 --bind 127.0.0.1 --directory prototype-playtest
```

用新版 Edge 或 Chrome 打开 <http://127.0.0.1:8766/>。首次试玩有 10,000 点，选红队或蓝队并下注；棋盘显示兵营、等级和兵种。开战后点选格子可看射程和建筑血量。试玩记录保存在当前浏览器的该站点，同一浏览器打开两个标签页会共用同一局和余额。

## 核验与回退

- **运行自动回归。** 在 `v2.1.1` 根目录用 Node.js 24 运行 `node --test "prototype-playtest/*.test.mjs" "server/*.test.mjs"`。历史静态版只需要运行 `prototype-playtest` 下的测试。
- **重演导出战局。** 从页面导出 JSON 后运行 `node testing/replay-battle-data.mjs round.json 5000`，查看封盘阵容推演的赛果及第 5 秒棋盘。
- **重新取得 V1。** 下载 `v1.1.0` 标签的源码或重新克隆到单独目录。需要还原固定 10 点的版本时，将克隆命令的标签换成 `v1.0.0`。

## 需求与验收记录

[玩法总纲](requirements/overview.md) · [下注与封盘](requirements/02-betting/requirement.md) · [自动战斗](requirements/04-battle/requirement.md) · [棋盘界面](requirements/06-arena-ui/requirement.md)

[兵种职责与射程](testing/runs/2026-11-24-unit-roles-sc-board-independent.md) · [兵营出兵](testing/runs/2026-11-24-barracks-only-independent.md) · [基地防守](testing/runs/2026-11-24-base-defense-independent.md) · [建筑血条及窄屏复测](testing/runs/2026-11-24-building-health-independent.md) · [百点门槛与跨轮设置](testing/runs/2026-11-24-bet-threshold-independent.md)
