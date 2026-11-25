# 2026-11-25 完整战局包开发自测

#game研讨会:#45，分支 `feat/45-round-archive`，基线 `c3d8aeb2bede0fa95c79b660ee8e63f94c1ff748`。[普通竞猜候选](http://localhost:8768/arena-round-archive/) · [GM 候选](http://localhost:8768/arena-round-archive/gm.html)

## 文件约定

`format` 为 `bet-arena/bet_data`，`version` 为 `1`，`sessionId` 和 `roundNumber` 共同定位一局。完整包按实际进度填写三项。

| 字段 | 含义 |
| --- | --- |
| `bet_log` | `version: 1`，`complete` 标明流水是否覆盖整个轮次，`entries` 按处理顺序记录系统投入和个人请求。各条含请求编号、轮内毫秒、阵营、点数、是否接受及建营升级效果。接受的个人请求带回执，拒绝的请求带原因。迁移前已发生但没有保存的拒绝和强化细节无法补回，旧轮标记 `complete: false`。 |
| `battle_data` | 封盘前为 `null`，封盘一次写入 `bet-arena/battle-data` v1 的兼容快照，补充会话种子和相应时间戳。这份快照不随后续赛果变化。 |
| `battle_log` | 开战前为 `null`。开始后是可独立读取的 `bet-arena/battle_log` v1，带会话、轮次、棋盘、规则、开火版本、`initialFrame`、后续 `frames`。进行中提供 `recordedThroughMs` 且 `complete: false`，结算后提供 `result` 与 `settlement`。 |

逐拍以开战 0 毫秒为起点，每 500 毫秒一拍。`battle-log.mjs` 的 `recordedBattleFrames(log)` 从初始帧叠加每拍增量，还原原序的单位、建筑、领地、地形、比分和命中。

- `owners`、`terrain` 用 `[格键, 值]` 写入或替换，单项 `[格键]` 表示移除。
- `units`、`buildings` 用 `[编号, 对象]` 写入或替换，单项 `[编号]` 表示离场。`events` 记录当拍移动和出兵，连移动后同拍离场也可回查。
- `shots` 保留实际目标、伤害、治疗和前后生命。主自爆事件与爆虫离场可一同核对。占地、建筑变化及最终赛果可从帧增量和日志头核对。

## 开发验证

| 场景 | 实测 |
| --- | --- |
| 旧档与旧标签 | Edge 真实迁移 v17 的在途第 2 局和上一局，保留余额、原回执和原规则。旧版页面尝试新建试玩时被存储版本拒绝；迁移提交后旧键仅保留存储标记。 |
| 下注与重试 | 双标签各提交同一笔红方 700，只有一条接受和一次扣款。25,000 点请求被拒，重试返回原拒绝并仅保留一条。实际界面补投蓝方 700。历经两轮后仍可按旧请求编号查原回执。 |
| 阶段与下载 | Edge 实际下载下注、封盘、7.5 秒战斗中、已结算四份。封盘首次冻结，部分日志刷新后仍明确截至 7.5 秒。结算时第 38 秒蓝拆红基地，比分 18∶38，余额 9,641。历史轮从轮次选择中重新下载。 |
| 持久化与清除 | 同一窗口续到第 4 局。取消新建以及在 GM 清棋盘都保留历史。模拟事务中断后三类数据仍一致。普通页确认新建后，旧轮次和逐拍增量同批清除，旧会话请求不能恢复废弃记录。 |

Node 自动回归 89 项。测试按相同封盘阵容核旧引擎与带事件重演的战场状态和赛果，逐拍日志能还原 0 秒至终局，封盘快照在阶段变化时一致。

四份浏览器下载样本见 [`testing/fixtures/round-archive`](../fixtures/round-archive)。命令行沿用旧 `battle_data` 和 GM JSON 入口，也支持完整包和单独的新版 `battle_log`。

```bash
node testing/replay-battle-data.mjs testing/fixtures/round-archive/partial.json 7500
node testing/replay-battle-data.mjs testing/fixtures/round-archive/complete.json 38000
```
