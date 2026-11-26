# 竞技场界面

## 当前行为

一页展示双边本人投入、总投和实时回报率，封盘后固定显示。可保存下一轮时长，结算页显示真实胜负、净变化及余额。

「战局数据」提供当局及可用时的上一局复制和 JSON 下载。未封盘时标记为当前阵容，封盘后携带固定阵容，结果生成后附比分、赛果与结算。完整战局包另保留下注流水、封盘状态和逐拍事件。收到的复现文件可放 `battle_data/`，用版本中的重演脚本读取。

- [当前需求](../../requirements/06-arena-ui/requirement.md) · [实现记录](../../requirements/06-arena-ui/implementation.md)
- [统一试玩源码](https://github.com/LauSkyun/bet_Arena/blob/252c582c56e17057150d79321183e730c8272a7a/prototype-playtest/app.mjs) · [首轮用例](../../testing/cases/milestone-1.xmind) · [首轮实测](../../testing/runs/2026-11-22-milestone-1.md)
- 首轮 #game研讨会:#13，本次迭代 #game研讨会:#16。讨论串 #game研讨会:c69fd058。

## 迭代历史

- 2026-11-22 · 各模块用独立预览开发、自测。`e30f492c` 把 01–05 接入同一 H5 页和同一会话，玩法体验按照里程碑统一。

- 2026-11-23 · `aaed05fe` 整合可重置积分、双边投入、倍率、可调时长和均分地图。统一体验入口指向该版本。

- 2026-11-23 · `252c582c` 在同一体验入口增加战局导出、可复现的 JSON 下载和同格判定说明。#game研讨会:#23。 [独立复核](../../testing/runs/2026-11-23-round-data-independent.md)

- 2026-11-24 · #game研讨会:#33 独立候选 61c5f1b 的建筑血条按战斗帧读取，支持双边受伤、刷新、变废墟和换轮。320／360／390 CSS px 复验血条、简称和等级分行可读。 [独立复核](../../testing/runs/2026-11-24-building-health-independent.md)

- 2026-11-24 · #game研讨会:#37 GM 可在独立测试局摆兵营和测试兵、设血、逐拍看命中、原样重开和镜像。候选 370e01e 已独立复核存档隔离及导出重演。[独立复核](../../testing/runs/2026-11-24-gm-panel-independent.md)

## 复测关注

单看界面提示无法判定落账。结果页的钱、格数与状态要核持久记录。观战、失败、平局及作废是不同反馈分支，测试保留实际场景。 对应用例 M1-06-01 至 M1-06-03，M1-E2E-01。

本轮复测 IT2-04、IT2-07、IT2-09，见[体验反馈用例](../../testing/cases/milestone-1-iteration-2026-11-23.xmind)和[独立复核](../../testing/runs/2026-11-23-milestone-1-feedback.md)。

## V2.1 战局归档和 GM 重播

完整包以实录日志为先，封盘快照确定性重算。失败导入保留当前拍位，部分日志停在记录截止拍。窄屏日志在棋盘下方。终局把拆营和胜因分开，不计分地形按实标注。新旧资料按可取得的兵种、等级及当拍生命显示；旧独立日志等级缺失时留空。第 32 局 39.5 秒普通及重播均见 3-5 蟑螂营 3 级、60/120，40 秒营被拆。

[适用需求](../../requirements/06-arena-ui/requirement.md) · [独立复核](../../testing/runs/2026-11-25-replay-barracks-independent.md) · [相关用例](../../testing/README.md#v21-地面版)

### 兵营品质

#54 使用 `board-display.mjs` 的 `barracksName` 和共用样式着色。白、绿、蓝、紫、橙覆盖低到高，冻结数据中的「金」呈橙色。普通／账号清单、GM 布阵与自身回放、导入棋盘共用映射。导入从封盘优先取品质，旧档缺值回白，避免从当前兵种表套色。[需求](../../requirements/06-arena-ui/requirement.md#棋盘上的兵营兵种与射程) · [复测](../../testing/runs/2026-11-26-barracks-quality.md)
