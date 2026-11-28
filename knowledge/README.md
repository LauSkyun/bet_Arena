# 竞猜竞技场功能知识库

按功能记录当前行为、代码与证据位置、历次变化和交接时容易忽略的边界。正式规则以[模块需求](../requirements/README.md)为准，版本验证回到[测试档案](../testing/README.md)。修复或口径变更后更新现状，并在对应功能追加迭代依据和需要复测的场景。

| 模块 | 功能档案 |
| --- | --- |
| 01 | [轮次与阶段](features/01-core-loop.md) |
| 02 | [下注与封盘](features/02-betting.md) |
| 03 | [阵营、建造与兵种](features/03-build-and-roster.md) |
| 04 | [自动战斗与占格](features/04-battle.md) |
| 05 | [积分结算](features/05-settlement.md) |
| 06 | [竞技场界面](features/06-arena-ui.md) |
| 08 | [同局多人、试玩账号与历史](features/08-shared-arena.md) |

早期历史体验整合版为 `aaed05fe`。首轮试玩基线 `e30f492c` 的验证仍可从测试档案回查。首次接手时先定位功能档案，再顺着需求、代码和测试证据确认当前范围。

模块 07、09、10、11 目前不单独建档：兵种与射程记在 03/04，奖池结算（规则 2）记在 [积分结算](features/05-settlement.md#同局多人奖池结算规则-2)，GM 多人模拟与账号 GM 面板记在 [同局多人](features/08-shared-arena.md)。

地面重播复验的历史快照 `8550317` 对应 `81a279d`。匿名地面版 `v2.1.0` 和多人奖池整合版 `v2.1.1` 的正式提交及实测范围见[版本记录](../testing/README.md#v211-多人奖池整合版)。各功能需求、用例和实测从[测试索引](../testing/README.md#v21-地面版)互查。
