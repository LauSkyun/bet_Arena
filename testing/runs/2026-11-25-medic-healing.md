# 2026-11-25 医疗兵地面治疗开发自测

#game研讨会:#40，分支 `feat/40-medic-healing`，基线 `204f0ed7a724e9d3bc02f494048419f83f9ba903`。工作电脑用 `localhost` 打开候选，与日常试玩的 `127.0.0.1` 浏览器存档隔离。通过 HTTP 逐一核过 19 个运行文件，均与 `cbd7dec` 一致。[GM 候选](http://localhost:8765/arena-medic/gm.html) · [普通竞猜候选](http://localhost:8765/arena-medic/)

| 场景 | 实测 |
| --- | --- |
| 剩余生命比例优先 | 红医疗兵 (7,4)，红陆战队员 (7,2) 为 45/100，红猛犸 (7,6) 为 84/280，红小狗营 (2,4) 为 10/120。首拍猛犸 84→96，陆战队员和兵营血量保持原值。红蓝镜像同样是 84→96。 |
| 射程、排序与上限 | 3 格可治，4 格在施疗前不可治。生命比例相同先看距离，再看出场顺序。99/100 实治 1。己方建筑、敌兵、自己及满血友兵均排除。两名医疗兵的叠加治疗受同一上限约束。 |
| 同拍伤害、治疗与冷却 | 医疗兵 (7,4)、己方陆战队员 (7,5)、敌方刺蛇 (7,7)。首拍扣 10、治 12，70→72。0.5 秒无第二次治疗，1 秒可再次施疗。陆战队员若从 5 开始，首拍伤害和治疗结算后仍存活，生命为 7。 |
| 普通竞猜 | Edge 隔离配置，390 CSS px，固定种子 24，借助受控时钟两队各通过界面投 500。第 10 秒选 (6,5)，显示红队医疗兵给小狗实际回复 12 点，生命 39→39。29.5 秒红方拆基地获胜，38∶18，余额 9,725，次轮续接。 |
| GM 与旧局 | Edge 从普通页进 GM，恢复规则 9 的猛犸 84/280。新建后经页面摆阵和设血，验证优先级、同拍、逐拍、原样重开、刷新和镜像。普通竞猜的余额与下注回执、旧 GM 存档均经回读一致。v13 普通局迁移与下一轮切换由自动测试验证。 |

`node --test prototype-playtest/*.test.mjs` 通过 75 项。另与基线对照 72 个普通旧局的 4,752 帧及赛果，以及一份规则 9 的旧 GM 导出，结果逐帧相同。

浏览器导出的三份样本随分支提供。回放时间是开战后的毫秒数。运行下列命令可查看帧内 `shots` 及赛果。

```bash
node testing/replay-battle-data.mjs testing/fixtures/medic-healing/priority.json 0
node testing/replay-battle-data.mjs testing/fixtures/medic-healing/simultaneous.json 0
node testing/replay-battle-data.mjs testing/fixtures/medic-healing/normal.json 10000
```
