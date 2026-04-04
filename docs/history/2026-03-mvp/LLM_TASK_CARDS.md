# Cerberus LLM 任务卡模板

_最后更新：2026-03-30_

## 用途

这份文档用于将 Cerberus 的 MVP 开发任务进一步整理成适合分发给不同 LLM 的任务卡模板。

目标：

- 让不同模型可以分阶段接力开发
- 降低上下文漂移和重复返工
- 控制每次任务的边界和改动范围
- 提高阶段性交付物的可验收性

## 使用方式

每次给 LLM 下发任务时，建议提供以下上下文：

1. 当前项目技术方案：`docs/PROJECT.md`
2. 当前开发计划：`docs/MVP_PLAN.md`
3. 本文档中对应阶段的任务卡
4. 当前仓库实际代码状态

建议工作方式：

- 每次只分配一个清晰阶段
- 明确可修改文件范围
- 明确不可改动的接口或模块
- 要求输出未完成项、风险和假设

## 通用任务卡模板

以下模板适用于任何阶段，可按需复制：

```md
# 任务名称

## 目标

请完成：

- 

## 背景

- 项目是 Cerberus，本地优先的加密私密笔记金库
- 技术方案见 `docs/PROJECT.md`
- MVP 计划见 `docs/MVP_PLAN.md`
- 当前阶段只实现本任务范围，不扩展需求

## 本次范围

- 

## 不在范围内

- 

## 可修改文件范围

- 

## 尽量不要改动

- 

## 实现要求

- 使用 TypeScript
- 保持模块边界清晰
- 不要引入与本任务无关的大改动
- 不要自行扩展产品范围
- 对安全相关逻辑保持保守实现

## 输出要求

- 完成代码修改
- 如有必要，补最少必要测试
- 简要说明实现方式
- 列出风险、假设和未完成项

## 验收标准

- 
```

## 模型分配建议

### `gpt-5.3-codex`

适合：

- 核心安全逻辑
- 初始化与解锁流程
- 主链路命令实现
- 附件导出与临时文件管理
- 多模块协同重构

不建议优先给它的任务：

- 纯模板化 README 补写
- 很机械的样板文件生成

### `glm5.1`

适合：

- 数据层
- CLI 壳层与参数解析
- 标准 CRUD
- 测试补全
- 文档同步整理

### `minimax m2.7`

适合：

- 样板代码
- 简单命令占位
- README、注释、格式整理
- 低风险外围模块

不建议单独承担：

- 核心密码学边界实现
- 多模块强耦合主链路

## 分阶段任务卡

### Task Card 0：项目基线

适合模型：

- `glm5.1`
- `minimax m2.7`

```md
# Task Card 0：项目基线

## 目标

请完善 Cerberus 的基础工程结构，使仓库具备继续开发 MVP 的条件。

## 背景

- 项目是本地优先的加密私密笔记工具
- 当前需要先完成 CLI 工程基线

## 本次范围

- 完善 `package.json`
- 完善 `tsconfig.json`
- 建立 CLI 入口
- 建立基础目录结构
- 补基础错误处理
- 补 `.gitignore` 和 `README.md`

## 不在范围内

- 不实现真实加密逻辑
- 不接入 SQLite
- 不实现业务命令细节

## 可修改文件范围

- `package.json`
- `tsconfig.json`
- `README.md`
- `.gitignore`
- `src/index.ts`
- `src/cli/**`
- `src/core/errors.ts`

## 尽量不要改动

- `docs/PROJECT.md`
- `docs/MVP_PLAN.md`

## 输出要求

- 保证 `cerberus --help` 可运行
- 代码结构清晰
- 不引入超出当前阶段的大依赖

## 验收标准

- CLI 基础入口可用
- 工程目录稳定
- 后续命令可以直接接入
```

### Task Card 1：配置与路径管理

适合模型：

- `glm5.1`
- `minimax m2.7`

```md
# Task Card 1：配置与路径管理

## 目标

请实现 Cerberus 的本地路径解析、配置读写和运行时上下文模块。

## 本次范围

- 实现 `~/.cerberus` 路径解析
- 管理 vault / entries / attachments / keys / sessions
- 实现配置对象与配置文件读写
- 构建统一 `AppContext`

## 不在范围内

- 不实现真实加密
- 不实现数据库操作

## 可修改文件范围

- `src/core/paths.ts`
- `src/core/config.ts`
- `src/core/runtime.ts`
- `src/core/types.ts`
- `src/commands/init.ts`

## 尽量不要改动

- CLI 命令分发结构
- crypto 层占位接口

## 实现要求

- 目录创建逻辑幂等
- 配置结构简单、可扩展
- 错误提示明确

## 验收标准

- 能稳定解析本地路径
- 可创建并复用配置
- 其他命令可拿到统一上下文
```

### Task Card 2：初始化流程 `init`

适合模型：

- `gpt-5.3-codex`

```md
# Task Card 2：初始化流程 init

## 目标

请实现 `cerberus init` 的最小可用初始化流程。

## 本次范围

- 首次设置主密码
- 生成 age identity
- 使用主密码派生包装密钥
- 加密保存 identity
- 初始化本地目录
- 初始化 SQLite 数据库或数据库占位

## 不在范围内

- 不实现完整 session 缓存
- 不实现条目 CRUD
- 不实现 Skill 接入

## 可修改文件范围

- `src/commands/init.ts`
- `src/crypto/age.ts`
- `src/crypto/identity.ts`
- `src/services/vault-service.ts`
- `src/core/**`
- `src/storage/db.ts`

## 尽量不要改动

- `src/commands/new.ts`
- `src/commands/show.ts`
- `src/skill/**`

## 实现要求

- 使用 age 作为内容加密机制
- 不让 identity 明文长期落盘
- 初始化流程要有重复执行保护
- 错误提示不能泄漏敏感信息

## 输出要求

- 给出实现说明
- 说明 identity 的包装与保存方式
- 列出安全假设

## 验收标准

- `cerberus init` 可运行
- 初始化后目录完整
- identity 已被保护存储
- 重复初始化有明确处理逻辑
```

### Task Card 3：解锁与会话管理 `unlock`

适合模型：

- `gpt-5.3-codex`

```md
# Task Card 3：解锁与会话管理 unlock

## 目标

请实现 Cerberus 的解锁和短时会话机制。

## 本次范围

- `cerberus unlock`
- 主密码校验
- 解开受保护的 identity
- 建立短时 session 缓存
- 会话过期检查与清理

## 不在范围内

- 不实现条目 CRUD
- 不实现附件功能

## 可修改文件范围

- `src/commands/unlock.ts`
- `src/crypto/identity.ts`
- `src/crypto/session.ts`
- `src/services/vault-service.ts`
- `src/core/config.ts`
- `src/core/types.ts`

## 尽量不要改动

- metadata schema
- Skill 层

## 实现要求

- 不在日志中输出敏感信息
- 过期逻辑清晰
- 会话文件权限尽量收紧

## 验收标准

- 可成功解锁
- 敏感命令可识别会话状态
- 过期后需重新解锁
```

### Task Card 4：SQLite 元数据层

适合模型：

- `glm5.1`
- `gpt-5.3-codex`

```md
# Task Card 4：SQLite 元数据层

## 目标

请实现 Cerberus MVP 所需的 SQLite 元数据层与基础 repository。

## 本次范围

- 设计并创建 `entries`、`tags`、`entry_tags`、`attachments` 表
- 实现 migration
- 提供基础增删查改接口
- 提供分类、标签、时间排序查询接口

## 不在范围内

- 不实现正文加解密
- 不实现 Skill

## 可修改文件范围

- `src/storage/db.ts`
- `src/storage/entries.ts`
- `src/storage/tags.ts`
- `src/storage/attachments.ts`
- `src/core/types.ts`

## 尽量不要改动

- crypto 模块接口
- CLI 入口

## 实现要求

- schema 简洁稳定
- 接口命名清晰
- 不把正文内容放入 SQLite

## 验收标准

- 表结构可初始化
- repository 接口可复用
- 支持后续 `new/list/show/search/attach`
```

### Task Card 5：条目主链路 `new/list/show`

适合模型：

- `gpt-5.3-codex`

```md
# Task Card 5：条目主链路 new/list/show

## 目标

请实现 Cerberus MVP 的核心文本条目流程：创建、列出、查看。

## 本次范围

- `cerberus new`
- `cerberus list`
- `cerberus show`
- 正文加密落盘
- 元数据写入和读取
- 查看时解密显示正文

## 不在范围内

- 不实现 edit/delete
- 不实现附件
- 不实现全文搜索

## 可修改文件范围

- `src/commands/new.ts`
- `src/commands/list.ts`
- `src/commands/show.ts`
- `src/services/vault-service.ts`
- `src/storage/entries.ts`
- `src/storage/tags.ts`
- `src/crypto/age.ts`
- `src/crypto/session.ts`

## 尽量不要改动

- `init` 和 `unlock` 的外部接口
- `docs/PROJECT.md` 中约定的产品边界

## 实现要求

- 只搜索和展示元数据，不泄漏正文
- 正文必须加密保存
- `show` 默认直接输出到终端，不长期落盘

## 输出要求

- 给出使用示例
- 说明依赖的前置条件

## 验收标准

- 可创建一条加密文本
- `list` 只显示元数据
- `show` 能解密显示正文
- 磁盘中正文不可直接明文读取
```

### Task Card 6：编辑与删除 `edit/delete`

适合模型：

- `gpt-5.3-codex`

```md
# Task Card 6：编辑与删除 edit/delete

## 目标

请补齐条目的编辑和删除流程。

## 本次范围

- `cerberus edit <id>`
- `cerberus delete <id>`
- 编辑临时文件流程
- 重新加密覆盖
- 删除确认机制

## 不在范围内

- 不实现版本历史
- 不实现恢复站

## 可修改文件范围

- `src/commands/edit.ts`
- `src/commands/delete.ts`
- `src/services/vault-service.ts`
- `src/crypto/age.ts`
- `src/crypto/session.ts`
- `src/storage/entries.ts`

## 尽量不要改动

- metadata schema 主体结构

## 实现要求

- 临时文件要及时清理
- 删除行为要可控
- 错误中断时尽量避免数据损坏

## 验收标准

- 条目可编辑
- 编辑后内容正确更新
- 删除操作行为清晰
```

### Task Card 7：标签与搜索

适合模型：

- `glm5.1`
- `minimax m2.7`

```md
# Task Card 7：标签与搜索

## 目标

请实现 Cerberus MVP 的标签写入和标题/标签搜索功能。

## 本次范围

- 创建条目时写入多个标签
- `search --title`
- `search --tag`
- `list --category`
- 查询输出格式整理

## 不在范围内

- 不实现正文全文搜索
- 不实现语义搜索

## 可修改文件范围

- `src/commands/search.ts`
- `src/commands/list.ts`
- `src/storage/tags.ts`
- `src/storage/entries.ts`
- `src/services/search-service.ts`

## 尽量不要改动

- crypto 层
- identity / session 逻辑

## 实现要求

- 搜索仅针对标题和标签
- 查询逻辑清晰
- 输出格式便于 CLI 阅读

## 验收标准

- 能按标题和标签查询
- 能按分类过滤列表
- 不涉及正文检索
```

### Task Card 8：附件功能

适合模型：

- `gpt-5.3-codex`

```md
# Task Card 8：附件功能

## 目标

请实现 Cerberus MVP 的附件加密保存、列表和导出能力。

## 本次范围

- `attach add <entry-id> <file-path>`
- `attach list <entry-id>`
- `attach export <attachment-id> <target-path>`
- 附件加密保存
- 附件元数据写入

## 不在范围内

- 不实现附件预览
- 不实现批量导出

## 可修改文件范围

- `src/commands/attach.ts`
- `src/storage/attachments.ts`
- `src/services/vault-service.ts`
- `src/crypto/age.ts`

## 尽量不要改动

- 既有条目 CRUD 接口

## 实现要求

- 导出路径必须显式指定
- 不将解密附件随意留在临时目录
- 错误提示不暴露敏感路径内容

## 验收标准

- 附件可加密保存
- 附件列表可读
- 附件可正确导出
```

### Task Card 9：OpenClaw Skill MVP

适合模型：

- `glm5.1`
- `gpt-5.3-codex`

```md
# Task Card 9：OpenClaw Skill MVP

## 目标

请实现 Cerberus 的最小 Skill 接入层，将结构化请求映射到已有命令或服务。

## 本次范围

- Skill 请求结构定义
- 意图到动作的映射
- 支持 `new/list/show/search`
- 对话式结果格式化

## 不在范围内

- 不实现复杂多轮推理
- 不绕过 CLI 的安全检查

## 可修改文件范围

- `src/skill/openclaw.ts`
- `src/services/vault-service.ts`
- `src/services/search-service.ts`

## 尽量不要改动

- crypto 层
- metadata schema

## 实现要求

- Skill 只是入口层，不承担安全核心逻辑
- 返回内容适合对话展示
- 出错时能清晰反馈

## 验收标准

- 结构化请求可映射到核心能力
- 不绕过解锁与权限检查
- 结果适合 OpenClaw 场景
```

### Task Card 10：测试与收尾

适合模型：

- `glm5.1`
- `minimax m2.7`
- `gpt-5.3-codex` 复核

```md
# Task Card 10：测试与收尾

## 目标

请为 Cerberus MVP 补齐最少必要测试与交付文档。

## 本次范围

- 核心单元测试
- `init/new/show/search/attach` 集成测试
- README 使用说明
- 常见错误场景说明

## 不在范围内

- 不做高覆盖率追求
- 不扩展产品功能

## 可修改文件范围

- `tests/**`
- `README.md`
- 必要时补少量源代码以提升可测性

## 尽量不要改动

- 核心业务逻辑，除非为了修复测试中发现的明确问题

## 实现要求

- 优先覆盖核心主流程
- 测试命名清晰
- 文档以可运行示例为主

## 验收标准

- MVP 主流程有自动化测试
- README 可指导他人跑通
- 常见失败场景有说明
```

## 下发给 LLM 时的附加约束建议

建议在任务卡后面附加以下统一要求：

```md
补充要求：

- 只修改本任务相关范围，避免顺手大改
- 如果发现上游接口缺失，可以补最小必要接口，但要说明原因
- 如果遇到安全边界不明确的地方，优先选择保守实现
- 不要自行增加不在 MVP 范围内的新功能
- 最终请输出：
  - 修改了哪些文件
  - 做了什么
  - 没做什么
  - 风险和假设
```

## 推荐协作策略

推荐按以下顺序和分工协作：

1. 用 `glm5.1` 或 `minimax m2.7` 完成基线和路径层
2. 用 `gpt-5.3-codex` 完成 `init`、`unlock`、`new/list/show`
3. 用 `glm5.1` 继续补 metadata 查询、标签与搜索
4. 用 `gpt-5.3-codex` 完成附件与编辑流程
5. 用 `glm5.1` 或 `minimax m2.7` 整理 README 与测试
6. 最后用较强模型对主链路做一次复核

这样可以在成本、速度和稳定性之间取得较好的平衡。
