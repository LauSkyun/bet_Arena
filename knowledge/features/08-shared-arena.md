# 同局多人、试玩账号与历史

[正式需求](../../requirements/08-shared-arena/requirement.md) · [启动说明](../../requirements/08-shared-arena/implementation.md) · [IT22 XMind](../../testing/cases/shared-arena-2026-11-25.xmind) · [独立验收](../../testing/runs/2026-11-25-shared-arena-independent.md)

可信内测使用单机服务。唯一规范化用户名续接同一 UID，首次发 10,000 点；不同 UID 共享轮次、公共总投、封盘与赛果，各自查看实扣、余额与历史。匿名试玩使用原入口与独立数据。

已接受与已拒绝的可追踪本人请求按请求号只写一次。重试读取原结果，结算事务每位玩家只入账一次。旧 SQLite 记录缺少拒绝时点时保留原结果并标明流水不完整。同一浏览器两个标签可以分别登录不同账号；刷新、历史下载、旧回执和退出都使用本标签身份。账号切换只影响本页。升级前已有账号使用原用户名在各页进入一次，SQLite 的余额和历史沿用。

完整包内公共战斗可用 GM 按实录重播，个人投注、入账和历史只取当前账号。进行中导出截至服务当前拍。重开服务需使用同一 SQLite 文件，复测核旧余额与下载终帧一致。

[同浏览器双标签复验](../../testing/runs/2026-11-25-shared-arena-tab-session-independent.md)

## dev 多人下注模拟

GM 保存的配置从下一轮生效。陪练投入进入公共奖池，赢款进入模拟账本；个人下载用来源和强化效果还原陪练投入。升级已开盘的旧轮时维持其原规则。跨轮恢复按计划时点交错处理陪练和系统投入。[模块需求](../../requirements/10-gm-multiplayer/requirement.md) · [独立验收](../../testing/runs/2026-11-27-gm-multiplayer-independent.md)
