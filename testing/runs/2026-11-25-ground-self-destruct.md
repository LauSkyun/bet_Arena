# 2026-11-25 爆虫自爆开发自测

#game研讨会:#43，分支 `feat/43-ground-self-destruct`，基线 `2d9322fbdb59c2a8cb3521329d57e5bdc7902fff`。工作电脑候选使用独立浏览器来源，可与地面范围伤害候选并存。[GM 入口](http://localhost:8772/arena-ground-self-destruct/gm.html) · [普通竞猜](http://localhost:8772/arena-ground-self-destruct/)

| 场景 | 实测 |
| --- | --- |
| 首拍范围与离场 | 爆虫 (7,3)，主目标和另一名敌兵在 (7,4)，邻兵 (7,5)，范围外 (7,6)。前三个有效伤害 68／34／34，范围外保持 280/280。原格当拍为空。引擎用例另核同格友军、空中对象及重复命中排除。 |
| 触发距离 | 爆虫 (7,3)、敌医疗兵 (7,5)。首拍相距 2 格，爆虫仍为 30/30。0.5 秒踏入 (7,4) 后自爆，医疗兵从 75 降到 7。若先在 2 格外被幽灵击倒，后续无自爆。 |
| 同拍互致命与治疗 | (7,3) 的 10 血爆虫、(7,2) 的己方医疗兵、(7,4) 的敌幽灵。爆虫仍出手，配置伤害 68，有效伤害 60，敌幽灵归零。己方同拍治疗 12，爆虫仍归零并离场。另用非致命来伤对照，结果仍自耗。 |
| 建筑 | 主目标 65/120 的兵营受 68 配置伤害，有效扣 65 并变废墟，邻营仍为 120/120，基地仍为 240/240。 |
| Edge GM | 390 CSS px，界面摆阵设血，核原向、镜像、原样重开、0.5 秒单步、刷新和实际下载。旧规则 11 的布阵仍可恢复，爆虫不触发。GM 前后正常竞猜的会话 ID、余额和下注回执一致。 |
| Edge 正常竞猜 | 种子 8，红蓝在真实表单各投 700，受控时钟到 7.5 秒。二级蓝爆虫命中陆战队员 81、三名邻兵各 40，主目标 100→19，棋盘详情显示爆虫当拍自耗。27.5 秒红方拆基地获胜，比分 38∶18，余额 9,608，续轮采用规则 12。 |

`node --test prototype-playtest/*.test.mjs` 通过 84 项。规则 9、10、11 各 24 个普通局共 4,314 帧和结局均与基线逐帧一致，另有 7 份旧 GM 下载逐帧一致。v13–v15 旧会话迁移及新轮切换经自动测试。

四份浏览器实际下载在命令行重演后，均得出相同首拍命中、爆虫离场和最终赛果。命令最后一项是开战后的毫秒数。

```bash
node testing/replay-battle-data.mjs testing/fixtures/ground-self-destruct/blast.json 0
node testing/replay-battle-data.mjs testing/fixtures/ground-self-destruct/mutual.json 0
node testing/replay-battle-data.mjs testing/fixtures/ground-self-destruct/approach.json 500
node testing/replay-battle-data.mjs testing/fixtures/ground-self-destruct/normal.json 7500
```
