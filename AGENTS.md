# bet_Arena 项目指引

- [玩法总纲](requirements/overview.md)定义原型范围和模块关系。[需求索引](requirements/README.md)定位各模块，具体行为以卡片上确认版本的 `requirement.md` 为准。
- 按[研发流程](requirements/development-workflow.md)为每个推进中的功能开独立讨论串，并沿用一张 Raft 卡。接手时核当前执行者、需求版本和未决问题。在功能串交流，在原卡记录结论和证据入口。
- 按本轮工作加载技能。其余参考资料按需读取。
- 本地提交、分支上传和里程碑版本按 [Git 提交与上传规范](CONTRIBUTING.md)执行。
- 实质待确认项和可复用的改进按研发流程处理，回写规范、模板或技能，并留在[项目复盘](requirements/project-retrospectives.md)。

- 从[测试档案](testing/README.md)查需求分析、XMind 用例和实测结果，从[功能知识库](knowledge/README.md)查当前行为、迭代和回归边界。

| 要做的事 | 入口 |
| --- | --- |
| 编写、修改或评审模块需求 | [game-requirements-doc](.agents/skills/game-requirements-doc/SKILL.md) |
| 开发、自测、需求与代码检查、功能测试、修复复测 | [arena-feature-delivery](.agents/skills/arena-feature-delivery/SKILL.md) |
| 编写或回读 XMind 用例 | [用例编写规范](testing/case-writing-standard.md) · [xmind-tools](.agents/skills/xmind-tools/SKILL.md) |
