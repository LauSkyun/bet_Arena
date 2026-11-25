# 同局多人、试玩账号与历史 · 实现记录

| 项 | 内容 |
| --- | --- |
| 对应需求 | [08-shared-arena v0.1](requirement.md) |
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
- `server/http.mjs` 提供账号、状态、下注、历史和战局包接口。浏览器持有 30 天会话，退出结束该浏览器当前会话。`/arena/` 与匿名页共用棋盘和下注界面，从服务端更新。`/history/` 每页显示最多 20 条已结算的个人记录。
- [Linux HTTP、SQLite 和 Windows Edge 开发自测](../../testing/runs/2026-11-25-shared-arena.md)。独立验收待 Cindy 使用原卡分节点执行。

账号入口完成登录或退出后通知同浏览器的历史标签。历史恢复可见时重新查询当前会话，并在请求前清除原姓名、表格和下载入口。请求失效后，晚到的旧响应不会更新页面。[双标签复测](../../testing/runs/2026-11-25-shared-arena.md#双标签换账号复测)
