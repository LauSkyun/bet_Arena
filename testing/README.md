# 竞猜竞技场测试档案

[用例编写规范](case-writing-standard.md) · [需求索引](../requirements/README.md) · [功能知识](../knowledge/README.md)

## V2.1 地面版

[整局需求分析](analysis/milestone-v21.md) · [整局 XMind](cases/milestone-v21.xmind) · [整局联调](runs/2026-11-25-milestone-v21-independent.md)

| 功能卡 | 需求 | 用例 | 独立证据 |
| --- | --- | --- | --- |
| #39 地面基础出兵 | [适用规则](../requirements/03-build-and-roster/requirement.md#v21-地面兵种基础出兵--39) | [XMind](cases/ground-production-2026-11-24.xmind) | [实测](runs/2026-11-24-ground-production-independent.md) |
| #37 GM 布阵 | [适用规则](../requirements/06-arena-ui/requirement.md#测试布阵) | [XMind](cases/gm-panel-2026-11-24.xmind) | [实测](runs/2026-11-24-gm-panel-independent.md) |
| #40 医疗兵 | [适用规则](../requirements/04-battle/requirement.md#v21-地面技能) | [XMind](cases/medic-heal-2026-11-25.xmind) | [实测](runs/2026-11-25-medic-heal-independent.md) |
| #41 范围伤害 | [适用规则](../requirements/04-battle/requirement.md#v21-地面技能) | [XMind](cases/ground-area-2026-11-25.xmind) | [实测](runs/2026-11-25-ground-area-independent.md) |
| #43 爆虫 | [适用规则](../requirements/04-battle/requirement.md#v21-地面技能) | [XMind](cases/ground-self-destruct-2026-11-25.xmind) | [实测](runs/2026-11-25-ground-self-destruct-independent.md) |
| #42 清棋盘与调分 | [适用规则](../requirements/06-arena-ui/requirement.md#清空棋盘与测试积分) | [XMind](cases/gm-wallet-2026-11-25.xmind) | [实测](runs/2026-11-25-gm-wallet-independent.md) |
| #45 完整战局包 | [适用规则](../requirements/06-arena-ui/requirement.md#按轮留存与清理) | [XMind](cases/complete-bet-data-2026-11-25.xmind) | [实测](runs/2026-11-25-round-archive-independent.md) |
| #47 累计日志 | [适用规则](../requirements/06-arena-ui/requirement.md#累计日志与胜因) | [XMind](cases/gm-battle-log-2026-11-25.xmind) | [实测](runs/2026-11-25-gm-battle-log-independent.md) |
| #46 GM 导入 | [适用规则](../requirements/06-arena-ui/requirement.md#导入指定战局) | [XMind](cases/gm-replay-import-2026-11-25.xmind) | [实测](runs/2026-11-25-gm-replay-import-independent.md) |
| #49 系统下注 | [适用规则](../requirements/02-betting/requirement.md#1-参与和资源) | [XMind](cases/reference-threshold-2026-11-25.xmind) | [实测](runs/2026-11-25-reference-threshold-independent.md) |
| #51 胜因与不计分 | [适用规则](../requirements/06-arena-ui/requirement.md#累计日志与胜因) | [XMind](cases/gm-battle-log-2026-11-25.xmind)，另补第 32 局 | [实测](runs/2026-11-25-victory-reason-independent.md) |
| #53 重播兵营 | [适用规则](../requirements/06-arena-ui/requirement.md#导入指定战局) | [XMind](cases/gm-replay-import-2026-11-25.xmind)，另补第 32 局 | [实测](runs/2026-11-25-replay-barracks-independent.md) |
| #52 试玩与平衡 | [验收范围](analysis/milestone-v21.md) | 30 局原批、12 局同投入、30 局自由下注 | [报告、逐局表与重播包](https://app.raft.build/artifacts/UdsLxfBRjXCeRRafzwYujR) |
| #48 整局体验 | [当前范围](../requirements/overview.md#5-v21-地面版与验收入口) | [整局 XMind](cases/milestone-v21.xmind) | [整局联调](runs/2026-11-25-milestone-v21-independent.md) |

第 52 卡以快照 56e6e61 运行，独立核对了 72 局的 4,822 帧与入账。第 53 卡更换快照至 8550317 后复验普通战场和导入重播的同拍显示。整局体验结论由第 48 卡记录。

## 同局多人内测

[#44 需求与验收拆分](../requirements/08-shared-arena/requirement.md#4-交付顺序与验收) · [开发实测](runs/2026-11-25-shared-arena.md) · [IT22 XMind](cases/shared-arena-2026-11-25.xmind) · [独立验收](runs/2026-11-25-shared-arena-independent.md)

## 早期里程碑与回归

- [里程碑 1 分析](analysis/milestone-1.md) · [第一次反馈](analysis/milestone-1-iteration-2026-11-23.md) · [第二次反馈](analysis/milestone-1-second-feedback-2026-11-23.md)
- [战局复现数据](analysis/milestone-1-round-data-2026-11-23.md) · [基地判胜](analysis/milestone-1-base-victory-2026-11-23.md) · [兵种与棋盘](analysis/unit-roles-sc-board-2026-11-24.md)
- [仅兵营出兵](runs/2026-11-24-barracks-only-independent.md) · [基地防守](runs/2026-11-24-base-defense-independent.md) · [建筑血条](runs/2026-11-24-building-health-independent.md) · [强化门槛](runs/2026-11-24-bet-threshold-independent.md)
