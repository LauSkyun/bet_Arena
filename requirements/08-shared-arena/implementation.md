# 同局多人、试玩账号与历史 · 实现记录

| 项 | 内容 |
| --- | --- |
| 对应需求 | [08-shared-arena v0.2](requirement.md) |
| 实现范围 | HTTP 试玩服务、SQLite、普通竞技场账号入口、个人历史和 GM 文件导入 |
| 分支 | `feat/44-shared-arena`，开发自测见运行记录 |
| 日期 | 2026-11-25 |

## 可运行入口

在项目根目录用 Node 24 LTS 启动，然后访问 [多人试玩](http://localhost:8780/) 。

```sh
node server/http.mjs
```

默认监听 `127.0.0.1:8780`，数据库为 `data/shared-arena.sqlite`。`ARENA_HOST`、`ARENA_PORT`、`ARENA_DB` 可覆盖地址、端口和文件。新数据库的默认轮次是下注 60 秒、战斗 40 秒。首次建库可用 `ARENA_BET_SECONDS` 和 `ARENA_BATTLE_SECONDS` 设置独立测试环境的时长。重启沿用 SQLite 已保存的轮次、配置、账号和余额。

## 实现与验收

- `server/shared-arena.mjs` 使用 SQLite 写事务协调当前轮次、账号扣点、请求回执以及结算。结算时保存封盘阵容和公共帧，导出时填入当前账号的投入和结算。公共轮次和本地匿名试玩使用同一套战斗与结算规则。
- `server/http.mjs` 提供账号、状态、下注、历史和战局包接口。服务端签发 30 天有效的会话，页面登录后将会话保存在当前标签的 `sessionStorage`，由该标签的请求携带。退出撤销当前会话。`/arena/` 与匿名页共用棋盘和下注界面，从服务端更新。`/history/` 每页显示最多 20 条已结算的个人记录。
- [Linux HTTP、SQLite 和 Windows Edge 开发自测](../../testing/runs/2026-11-25-shared-arena.md)。独立验收待 Cindy 使用原卡分节点执行。

历史与下载使用当前标签的会话。页面恢复可见时重新查询该会话。待确认下注仅会在本页账号匹配时重试。升级后原登录页须重新输入原用户名，原 SQLite 的 UID、余额、下注、结算与档案可直接续用。[独立登录开发复测](../../testing/runs/2026-11-25-shared-arena.md#同浏览器标签独立登录复测)

下注记录在 SQLite 原有 `bets.data` 中附加首次请求时点。导出保留确认和拒绝，按 UID 读取。旧回执可恢复确认时间，缺失的拒绝时点和系统强化保留为空并标记流水不完整。[归档复测](../../testing/runs/2026-11-25-shared-arena.md#本人拒绝记录复测)
