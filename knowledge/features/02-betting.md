# 下注与封盘

## 当前行为

新建或确认重置为 10,000 测试积分。红蓝可分别投入，余额约束有效投入。系统和本人投入分开，封盘保存各队实扣、阵容及回执。

- [当前需求](../../requirements/02-betting/requirement.md) · [实现记录](../../requirements/02-betting/implementation.md)
- [整合代码入口](../../prototype-playtest/betting.mjs) · [首轮用例](../../testing/cases/milestone-1.xmind) · [首轮实测](../../testing/runs/2026-11-22-milestone-1.md)
- 首轮 #game研讨会:#8，本次迭代 #game研讨会:#14。讨论串 #game研讨会:308b7ce1。

## 迭代历史

- 2026-11-22 · `cab3d236` 把模块 01 的固定单次投入改成多档同队加注、系统参照、门槛与封盘快照。03 接入真实阵营强化，04 从快照起战斗，05 从快照实扣落账。

- 2026-11-23 · `d5a06eb1` 从首笔锁队、单轮上限 40 改为双边投入和余额校验，保留请求幂等。

- 2026-11-24 · #game研讨会:#35 独立候选 82d3ec8，默认每队累计 100 点触发强化，系统参照计入队伍总投。门槛可改，下一轮生效。v12 快照按 10 点打完当前轮，隔离入口各有存档。 [独立复核](../../testing/runs/2026-11-24-bet-threshold-independent.md)

## 复测关注

迟到的界面回执和迟到的新请求需要不同处理。测试必须同时看请求编号、轮次、实际余额和封盘阵容，刷新只回读原确认。 对应用例 M1-02-01 至 M1-02-04。

本轮复测 IT2-01 至 IT2-04，见[体验反馈用例](../../testing/cases/milestone-1-iteration-2026-11-23.xmind)和[独立复核](../../testing/runs/2026-11-23-milestone-1-feedback.md)。

## V2.1 系统参照与门槛

默认 100 点，红第 4 秒、蓝第 8 秒，各按本轮锁定门槛。改设置从下一轮起生效，恰到截止的系统投入不发生；旧轮可继续以原 10 点计划结清。

[适用需求](../../requirements/02-betting/requirement.md) · [独立复核](../../testing/runs/2026-11-25-reference-threshold-independent.md) · [相关用例](../../testing/README.md#v21-地面版)
