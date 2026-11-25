# 阵营、建造与兵种

## 当前行为

正式试玩新局使用 14×7 交错六边形，双方旋转 180° 对称，各有一座基地、20 个备用可建位和 28 个可计分普通格。新局开战首帧为零兵，随后仅由兵营产兵。旧局保持原地图至结算。

首座从基地的合法相邻空格抽取，之后从己方所有现有建筑的相邻候选去重并等概率抽取。每方上限 15 座；可建后须保留连通道路与每营出兵口。兵营带来源主题、档位、等级与存活上限，阵营归属始终按红蓝。

- [当前需求](../../requirements/03-build-and-roster/requirement.md) · [实现记录](../../requirements/03-build-and-roster/implementation.md)
- [统一试玩源码](https://github.com/LauSkyun/bet_Arena/blob/9a03f3f9ab7e5fcd2ecaaef14f498094c36dfffd/prototype-playtest/roster.mjs) · [独立复核](../../testing/runs/2026-11-23-milestone-1-second-feedback.md) · [历史证据](../../testing/runs/2026-11-22-milestone-1.md)
- 首轮 #game研讨会:#9，本次迭代 #game研讨会:#16。讨论串 #game研讨会:f13ef943。

## 迭代历史

- 2026-11-22 · 讨论期确认双主基地、相邻扩建和跨族抽取。`4846ec47` 从固定演示强化切为镜像棋盘与真实建造、升级、抽取。当前整合版本把开局阵容交给战斗。

- 2026-11-23 · `aaed05fe` 合入 10×7 棋盘。每轮记录开局地图版本，支持已开始的旧轮按原图回放。

- 2026-11-23 · aeabe8db 验证 15 座与相邻随机扩建。统一版 9a03f3f9 将六边形用于新局。见 #game研讨会:#21 与 #game研讨会:#22。

- 2026-11-24 · #game研讨会:#39 接入 19 个地面兵，正常下注建营和升级，封盘保留单位编号、等级与出兵参数。候选 dc781d4 已独立复核；GM 验证沿 #37 继续。 [独立复核](../../testing/runs/2026-11-24-ground-production-independent.md)

## 复测关注

同一格可能与多个建筑相邻，候选只计一次。出兵口须通行，等级变化要保持原兵种和存活上限。强化已满时保证有效下注仍进结算。 对应用例 M1-03-01 至 M1-03-04。

## V2.1 地面配置

19 种地面单位的编号、等级、批量与出兵上限以封盘阵容为准。兵营名称来自封盘兵种，血条来自当拍建筑记录。规则 9 是历史基础出兵阶段。

[适用需求](../../requirements/03-build-and-roster/requirement.md) · [独立复核](../../testing/runs/2026-11-24-ground-production-independent.md) · [相关用例](../../testing/README.md#v21-地面版)
