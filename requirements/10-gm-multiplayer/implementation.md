# GM 多人下注模拟 · 实现记录

| 项 | 内容 |
| --- | --- |
| 版本 | v0.1 · 2026-11-27 |
| 需求 | [requirement.md](requirement.md) |
| 基线 | develop `6e3b6be`（含奖池规则 2） |
| 候选分支 | `feat/57-gm-multiplayer` |

## 代码落点

- `server/gm-bots.mjs`：纯逻辑。配置校验、种子确定性计划 `botPlan`。
- `server/shared-arena.mjs`：SQLite 增 `bot_bets`；`configure`/`gmConfig` 接口与 GM 密钥；`extraEvents` 只取该轮冻结的 `round.gmConfig`（升级途中当前轮无配置则按原状），`observeExtra` 在事件触发时落库回执；结算按规则档计算陪练入账并写轮次 `sim`；导出陪练事件去个人回执。
- `prototype-playtest/betting.mjs`：`advanceBetting` 把系统参照事件与该轮额外事件（陪练）合并成按计划时点排序的单一事件流，交错 invest，强化等级归属在连续推进与补跑下一致；陪练事件同走公共总投闸门。
- `prototype-playtest/round.mjs`：`advance` 每轮从 `observe.extraEvents` 取该轮计划交给 `advanceBetting`，逐轮交错处理再封盘。
- `prototype-playtest/round-archive.mjs`：`betDataReport` 透传 `sim` 模拟账本。
- `prototype-playtest/shared-gm.html`：dev GM 设置页；`server/http.mjs`：`/gm/` 与 `/api/gm/config`，`X-GM-Key` 校验。

## 配置生效与版本

- `gmConfig` 存会话级，当前轮冻结在 `round.gmConfig`，下一新建轮才用新值；`settlementMode=2` 映射 `settlementRules=2`，`=1` 映射缺省（旧倍率）。
- 旧库升级：仅当库无 `gmConfig` 时补默认配置并启用规则 2；已有 `gmConfig` 的库尊重 GM 设定，重启不翻转结算模式。

## 结算口径

- 奖池档（规则 2）：真人与陪练实扣共同成池，按 `settlePlayerPool` 分配；陪练入账写 `sim`。
- 旧倍率档：按封盘冻结倍率 `winningCredit(amount, rates[side])` 核陪练入账，平局/作废退本金，负方为 0。
- 真人余额/历史只按真人账号结算；陪练不建账号、不扣真人余额、不落真人历史。

## 持久化与恢复

- 计划由种子＋轮号＋**该轮冻结配置**确定性重算；回执按 `(round, request_id)` 唯一键落库。升级途中当前轮无轮内配置时不生成陪练，新配置只供下一轮。
- `advanceBetting` 对 catch-up 中每一轮都把参照与陪练事件按时点交错处理，到点才落库回执；封盘后不再补单。
- 停机跨封盘：重启后按同一计划重算、唯一键跳过已下单时点；连续运行与跳转恢复的逐笔 effects 归属、封盘快照与账本一致（固定种子 42 对照）。

## 导出

- `bet_log`：`source:player` 带个人回执；`source:bot` 保留来源/边别/金额/时点/效果，去掉个人回执对象，避免混入模拟身份。
- 公共 `stakes/totals/rates/pool` 反映全体（含陪练），`sim` 列陪练模拟入账；个人下载只含本人回执。

## 自测与边界

- 130 项 Node 测试通过（GM 权限、确定性、账本隔离、重启跨封盘、旧倍率陪练入账与退款、跨轮追赶、去回执、公共总投闸门、升级途中当前轮不提前下注、逐笔 effects 连续/补跑一致）。
- 边界：人数 1–5、金额下限≤上限、金额正整数、公共总投不超 `maxReferenceThreshold`、封盘后禁补单、重复请求唯一键去重。
- 本机 HTTP 实测：`/gm/` 200、错密钥 403、对密钥下轮生效。验收脚本与结果见卡内独验回执。
