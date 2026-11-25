# 2026-11-25 GM 导入指定战局重播开发自测

#game研讨会:#46，分支 `feat/46-gm-replay-import`，基线 `4089250f452dea72c62f82cf290c31666758506c`。从 GM 顶部打开导入页，Edge 390 CSS 像素，通过实际文件输入选择 JSON。[GM 候选](http://localhost:8766/arena-gm-replay-import/gm.html) · [导入重播页](http://localhost:8766/arena-gm-replay-import/replay.html)

| 场景 | 自测 |
| --- | --- |
| 旧封盘快照 | 导入 `testing/fixtures/ground-self-destruct/normal.json`。按规则 12 推演，播放后暂停在 0.5 秒，单步至 1 秒，回到起点正好一拍。第 7.5 秒命中伤害 81。自动用例另核规则 1 和 3、旧方格及早期文件默认开火版本。 |
| 单独战斗日志 | 从 `testing/fixtures/round-archive/partial.json` 提取 `battle_log` 单独选入，提示记录截至 7.5 秒。末拍后播放和单步停用，无最终赛果。 |
| 完整战局包 | 导入 `testing/fixtures/round-archive/complete.json`。第 6.5 秒点 (6,3)，追猎者生命为 73，实际伤害 47，拍内生命 120→73。记录共 77 拍，38 秒止，红 18 格、蓝 38 格、蓝队获胜。 |
| 失败保留原状态 | 实际选择破损 JSON、轮次冲突、未知日志版本、缺一拍的损坏日志和未封盘包，均显示对应提示，先前部分日志的拍号和累计内容保持一致。 |
| 原存档 | 导入前在 GM 放一座红营。选入多份文件、单步至终局后，原普通会话和 GM 存档逐字节一致。 |

`node --test prototype-playtest/*.test.mjs` 通过 95 项。现有 v1 文件格式支持战斗规则 1–12 和开火版本 1–2。独立页复用 `setupBattleLogPanel` 及同拍命中文字，部分日志的截止时间和完整局末拍按文件内容读取。
