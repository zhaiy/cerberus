# Cerberus MVP 开发计划

_最后更新：2026-03-30_

## 目标

这份文档用于将 Cerberus 的 MVP 拆分为可独立执行、可分阶段验收、可交由不同 LLM 协作完成的开发任务。

拆分原则：

- 单阶段目标清晰
- 阶段之间依赖尽量简单
- 每阶段有明确交付物和验收标准
- 优先保证核心链路先落地

## 总体范围

MVP 聚焦以下能力：

- 本地初始化金库
- 主密码解锁
- 文本条目加密存储
- 分类与标签管理
- 标题与标签搜索
- 加密附件保存与导出
- OpenClaw Skill 的最小接入

MVP 不包含：

- 云同步
- 全文搜索加密正文
- 远程访问
- 法律相关遗嘱能力
- 时间锁
- 密钥分片恢复

## 阶段规划

### Phase 0：项目基线

目标：

- 建立可持续开发的 TypeScript CLI 工程基础

交付物：

- `package.json`
- `tsconfig.json`
- 基础目录结构
- CLI 入口与 help 输出
- 基础错误处理
- `.gitignore`
- `README.md`
- 测试目录占位

验收标准：

- `cerberus --help` 可运行
- 目录结构与技术方案一致
- 项目可继续承接后续命令实现

建议模型：

- `glm5.1`
- `minimax m2.7`

备注：

- 该阶段规则明确，适合先由中小模型快速铺底

### Phase 1：配置与本地路径管理

目标：

- 统一管理 `~/.cerberus` 金库路径和运行时上下文

交付物：

- 本地路径解析模块
- `config.json` 读写逻辑
- vault / entries / attachments / keys / sessions 目录管理
- 统一 `AppContext` 或 runtime 模块

验收标准：

- 可稳定解析并创建本地目录
- 重复执行初始化目录逻辑不会破坏已有结构
- 所有命令都能复用同一套上下文对象

建议模型：

- `glm5.1`
- `minimax m2.7`

### Phase 2：`init` 初始化流程

目标：

- 完成 Cerberus 的首次初始化闭环

交付物：

- `cerberus init`
- 首次设置主密码
- 生成 age identity
- 使用主密码派生包装密钥并加密保存 identity
- 初始化 SQLite 数据库

验收标准：

- 首次初始化成功
- 本地生成完整金库结构
- age identity 不以明文长期落盘
- 重复初始化有明确提示或保护逻辑

建议模型：

- `gpt-5.3-codex`

备注：

- 该阶段涉及安全边界和初始化流程编排，建议交给更稳的模型

### Phase 3：解锁与会话管理

目标：

- 为敏感命令建立统一的解锁与会话机制

交付物：

- `cerberus unlock`
- 主密码校验
- 解开受保护的 age identity
- 短时 session 缓存策略
- session 过期与清理逻辑

验收标准：

- 敏感命令可检测当前是否已解锁
- session 超时后需要重新解锁
- 不在日志或错误中泄漏敏感信息

建议模型：

- `gpt-5.3-codex`

### Phase 4：SQLite 元数据层

目标：

- 建立 MVP 所需的元数据持久化能力

交付物：

- migration 机制
- `entries` 表
- `tags` 表
- `entry_tags` 表
- `attachments` 表
- repository 或 storage 层接口

验收标准：

- 数据表结构稳定
- CRUD 接口清晰
- 支持分类筛选、标签关联、排序查询

建议模型：

- `glm5.1`
- `gpt-5.3-codex`

备注：

- 若实现较标准，可先交给中等模型；若涉及较复杂 schema 和迁移策略，再交给更强模型

### Phase 5：条目最小闭环 `new/list/show`

目标：

- 尽快做出第一个真实可用的 MVP 主流程

交付物：

- `cerberus new`
- `cerberus list`
- `cerberus show`
- 正文加密落盘
- 元数据写入与读取
- 解密显示正文

验收标准：

- 可以创建一条加密文本
- `list` 只展示元数据
- `show` 能正确解密并显示正文
- 磁盘中的正文不可直接明文读取

建议模型：

- `gpt-5.3-codex`

备注：

- 这是 MVP 最核心的主链路，尽量由同一个模型连续完成

### Phase 6：编辑与删除 `edit/delete`

目标：

- 补齐文本条目的生命周期管理

交付物：

- `cerberus edit <id>`
- `cerberus delete <id>`
- 解密到临时文件进行编辑
- 编辑完成后重新加密
- 删除确认机制

验收标准：

- 编辑后正文内容正确更新
- 临时文件不残留
- 删除流程可控，避免误操作

建议模型：

- `gpt-5.3-codex`

### Phase 7：标签与搜索

目标：

- 补齐 MVP 的组织与检索能力

交付物：

- 多标签写入
- `search --title`
- `search --tag`
- `list --category`
- 查询结果格式化输出

验收标准：

- 能按标题和标签查到目标条目
- 不触碰正文全文搜索
- 搜索结果稳定、易读

建议模型：

- `glm5.1`
- `minimax m2.7`

### Phase 8：附件功能

目标：

- 支持基本的私密附件保存和导出

交付物：

- `attach add <entry-id> <file-path>`
- `attach list <entry-id>`
- `attach export <attachment-id> <target-path>`
- 附件加密保存
- 附件元数据记录
- 导出时按需解密

验收标准：

- 附件可被加密保存
- 附件列表可查询
- 导出文件内容正确
- 不将解密附件随意散落到临时目录

建议模型：

- `gpt-5.3-codex`

备注：

- 文件路径、导出流程和错误处理容易出细节问题，建议交给更稳的模型

### Phase 9：OpenClaw Skill MVP

目标：

- 为后续对话入口打通最小链路

交付物：

- Skill 请求结构定义
- 意图到命令的映射逻辑
- 支持 `new/list/show/search` 等典型动作
- 基础错误反馈

验收标准：

- 可从结构化请求调用核心功能
- 不绕过 CLI 安全检查
- 返回结果适合对话场景展示

建议模型：

- `glm5.1`
- `gpt-5.3-codex`

### Phase 10：测试与收尾

目标：

- 让 MVP 达到可交付状态

交付物：

- 核心单元测试
- `init/new/show/search/attach` 集成测试
- README 使用说明
- 错误场景补全
- 发布前检查清单

验收标准：

- 主流程有自动化测试覆盖
- 文档可带新人跑通 MVP
- 常见失败场景有清晰提示

建议模型：

- 测试脚本和 README 可交给 `glm5.1` / `minimax m2.7`
- 核心测试设计建议由 `gpt-5.3-codex` 复核

## 推荐执行顺序

建议按以下顺序推进：

1. Phase 0
2. Phase 1
3. Phase 2
4. Phase 4
5. Phase 5
6. Phase 3
7. Phase 6
8. Phase 7
9. Phase 8
10. Phase 9
11. Phase 10

说明：

- 如果你希望尽快看到“能创建和查看条目”的成果，可以优先做 `init + metadata + new/list/show`
- `unlock` 也可以在主链路稳定后补上更完整的 session 机制

## 推荐并行拆分

如果后续希望多个 LLM 并行开发，建议按以下 4 条工作流拆分：

### 工作流 A：核心安全流

范围：

- `init`
- `unlock`
- `crypto/identity`
- `crypto/session`
- `crypto/age`

建议模型：

- `gpt-5.3-codex`

### 工作流 B：数据存储流

范围：

- SQLite schema
- migration
- repository / storage 层
- tags / attachments metadata

建议模型：

- `glm5.1`
- `gpt-5.3-codex`

### 工作流 C：CLI 命令流

范围：

- `new`
- `list`
- `show`
- `edit`
- `delete`
- `search`
- `attach`

建议模型：

- 核心命令优先 `gpt-5.3-codex`
- 简单命令和参数处理可交给 `glm5.1`

### 工作流 D：文档与测试流

范围：

- README
- 测试
- 错误场景补全
- 验收脚本

建议模型：

- `glm5.1`
- `minimax m2.7`

## 最小验收标准

达到以下条件即可认为 MVP 初步成立：

- 初始化后可创建一条加密文本
- 可列出条目元数据
- 可查看解密后的正文
- 可按标签找到目标条目
- 可添加并导出一个附件

## 分发给不同 LLM 时的建议

为了减少返工，建议你给每个模型下发任务时附带以下约束：

- 明确它只负责的模块和文件范围
- 明确不能改动的接口
- 提前给出验收标准
- 要求补最少必要测试
- 要求记录假设和未完成项

推荐下发格式：

1. 任务目标
2. 可修改文件范围
3. 输入与依赖前提
4. 输出要求
5. 验收标准
6. 不在本次范围内的事项

这样更适合让多个模型在不同阶段稳定接力。
