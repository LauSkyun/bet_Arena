# V2.1 地面版需求分析与执行口径

[里程碑范围](../../requirements/overview.md#5-v21-地面版与验收入口) · [功能用例和实测索引](../README.md#v21-地面版) · [整局 XMind](../cases/milestone-v21.xmind)

| 可观察结果 | 验收重点 | 证据 |
| --- | --- | --- |
| 两队正常下注后封盘 | 从正常入口走到续轮。核截止、门槛下一轮生效、旧轮，以及双标签下同一请求只扣分和落账一次。 | [完整链路](../runs/2026-11-25-milestone-v21-independent.md) · [门槛](../runs/2026-11-25-reference-threshold-independent.md) |
| 地面单位和技能按当轮规则推进 | 固定场景覆盖 19 种地面兵、触发边界、镜像与旧规则重演。 | [战斗要求](../../requirements/04-battle/requirement.md#v21-地面技能) |
| 同一局数据在续轮和重进后可查 | 分阶段核流水、冻结阵容、逐拍记录。续轮保留，确认新建时同步清理。 | [战局包复核](../runs/2026-11-25-round-archive-independent.md) |
| GM 布阵及导入和原试玩隔离 | 清盘、调分、失败导入各自校验存档边界。 | [调分](../runs/2026-11-25-gm-wallet-independent.md) · [导入](../runs/2026-11-25-gm-replay-import-independent.md) |
| 普通和导入回放可读出胜因和兵营 | 同拍比较计分、地形、简称、等级、建筑生命和拆除。 | [胜因](../runs/2026-11-25-victory-reason-independent.md) · [兵营](../runs/2026-11-25-replay-barracks-independent.md) |

每次报告记录受测版本、种子或战局文件、测试时钟或实时回放的适用范围。出现比分保持时，核对实际帧、计时、移动和落账，区分比分静止与页面停滞。平衡样本按营数差和投入条件分组，改玩法由相应功能卡确认。[试玩样本](https://app.raft.build/artifacts/UdsLxfBRjXCeRRafzwYujR)
