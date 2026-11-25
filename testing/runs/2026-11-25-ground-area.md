# 2026-11-25 地面范围伤害开发自测

#game研讨会:#41，候选分支 `feat/41-ground-area`，开发基线 `c1e40079ddae7a191fa3f1228c21a0beaa61b587`。工作电脑使用隔离地址，保持候选和医疗兵试玩的浏览器存档各自独立。[GM](http://localhost:8770/arena-ground-area/gm.html) · [普通竞猜](http://localhost:8770/arena-ground-area/)

| 场景 | 自测结果 |
| --- | --- |
| 火蝠扇扫 | (7,4) 的火蝠面向 (7,5)，三名敌兵各扣 39，背后 (7,3) 保持 280/280。同格友兵排除。 |
| 巨像直线 | (7,4) 的巨像扫 (7,5)、(7,6)、(7,7)，各扣 30，线外 (8,5) 保持 280/280。自动用例另核斜向三格，以及主目标在 (8,6) 时的方向并列和红蓝镜像。 |
| 执政官与金甲虫 | (7,3) 的攻击者打 (7,5) 的主目标、同格另一名和 (7,6) 邻兵。一级分别为 16／8／8 与 100／50／50，(7,7) 范围外保持 280/280。二级执政官 19／9。自动用例另核主目标层与附带目标层、友军排除、建筑仅主目标直击。 |
| 同拍伤害与治疗 | 金甲虫溅射扣 50，医疗兵同拍已经为 45/100 的陆战队员治疗 12，陆战队员结算后为 7/100。另一组主目标只剩 30，治疗 12，过量伤害按 42 点记录，目标阵亡。 |
| Edge GM 与下载 | 隔离 Edge，390 CSS px。页面逐个摆放四种攻击者和内外目标，核首拍技能文本、实际伤害、范围外血量、0.5 秒单步、原样重开、红蓝镜像和刷新。四份 GM 由浏览器实际下载。规则 10 的旧 GM 恢复后仍走单次直击，正常竞猜的会话 ID、余额和下注回执保持一致。 |
| Edge 正常竞猜 | 固定种子 8，红蓝真实表单各投 600，受控时钟转到开战第 11.5 秒。点 (8,3) 读到金甲虫附带 50，黑暗圣堂武士 108→58。第 25 秒红方拆基地，比分 41∶15，余额 9,664，次轮按规则 11 开局。结算后实际下载并复跑。 |

Node 80 项通过。规则 8、9、10 各 24 个普通战局，共 4,276 帧和赛果与基线逐帧一致。另有 3 份旧 GM 导出逐帧一致。普通会话 v13/v14 的旧局规则与下一轮迁移已由自动测试验证。

从浏览器实际下载的五份样本均重演到对应命中和赛果。以下命令中的时间为开战后的毫秒数。`power` 是配置伤害，`applied` 是有效伤害，`before` 和 `after` 是本拍结算前后生命。

```bash
node testing/replay-battle-data.mjs testing/fixtures/ground-area/fan.json 0
node testing/replay-battle-data.mjs testing/fixtures/ground-area/line.json 0
node testing/replay-battle-data.mjs testing/fixtures/ground-area/archon.json 0
node testing/replay-battle-data.mjs testing/fixtures/ground-area/reaver.json 0
node testing/replay-battle-data.mjs testing/fixtures/ground-area/normal.json 11500
```
