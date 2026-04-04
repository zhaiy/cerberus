# Cerberus 技术方案

> 你的秘密、记忆与最后的话，在本地得到守护。

_最后更新：2026-03-30_

## 1. 项目定位

Cerberus 是一个本地优先的私密笔记金库，用于保存高敏感度文本与附件，并通过命令行和对话式入口进行管理。

它不是云笔记、团队协作工具，也不是具有法律效力的遗嘱系统。项目第一阶段聚焦在：

- 本地运行
- 单用户
- 强加密存储
- 标签化管理
- 易于通过自然语言入口操作

### 产品表达

为了避免法律语义和不必要的承诺，原“遗嘱”分类在产品层面统一替换为更中性的私密表达，例如：

- 最后的话
- 留言
- 信笺
- 封存

MVP 默认使用“最后的话”作为预设分类名称。

## 2. 产品目标

### 2.1 目标用户

- 希望把敏感信息留在本地的个人用户
- 愿意使用命令行或自然语言管理内容的用户
- 有“长期保存私密记录”需求的用户

### 2.2 核心价值

- 对话即界面：降低私密内容录入门槛
- 本地优先：不依赖云服务，不默认联网
- 加密存储：正文与附件落盘前加密
- 可管理：支持分类、标签、时间排序和列表查看

### 2.3 MVP 目标

在 4 周内交付一个本地可用的最小版本，支持：

- 初始化金库
- 主密码解锁
- 新建、查看、列出、编辑、删除文本条目
- 添加和导出附件
- 通过分类和标签管理条目
- 按标题与标签搜索元数据
- 提供可集成到 OpenClaw 的基础 Skill 入口

## 3. 非目标

以下内容明确不属于 MVP：

- 云同步
- 多端实时一致性
- 远程访问
- 全文检索加密内容
- 法律遗嘱模板或法律效力声明
- 时间锁机制
- 密钥分片恢复流程

这些方向可以在后续版本探索，但不会阻塞第一版落地。

## 4. 功能范围

### 4.1 MVP 功能

| 模块 | 功能 | 说明 |
|---|---|---|
| 初始化 | `cerberus init` | 设置主密码，创建本地金库目录与配置 |
| 解锁 | 会话解锁 | 使用主密码解锁当前 CLI 会话 |
| 条目管理 | 新建 / 列表 / 查看 / 编辑 / 删除 | 正文加密存储 |
| 分类系统 | 预设分类 | `diary`, `note`, `last_words`, `collection`, `secret` |
| 标签系统 | 多标签 | 用于组织和检索 |
| 搜索 | 标题 + 标签搜索 | 仅搜索元数据，不搜索正文 |
| 附件 | 添加 / 列表 / 导出 | 附件单独加密保存 |
| Skill 集成 | 基础命令映射 | 将自然语言意图转成 CLI 调用 |

### 4.2 后续版本

| 模块 | 方向 |
|---|---|
| 恢复机制 | 密钥分片、恢复联系人流程 |
| 检索增强 | 临时解密后的受控索引 |
| 使用体验 | TUI 或桌面壳层 |
| 互操作 | 导入导出、备份校验 |

## 5. 技术原则

### 5.1 核心原则

- 加密优先于功能便利
- 默认离线
- 元数据最小暴露
- 尽量使用成熟组件，不自造密码学方案
- 明确区分“可搜索元数据”和“必须加密正文”

### 5.2 加密原则

Cerberus 统一使用 `age` 负责实际加密与解密，不自行实现底层对称加密算法，不自行设计 nonce 逻辑。

项目只负责：

- 通过主密码派生出用于保护 age 身份信息的包装密钥
- 在会话中安全加载解锁后的 age 身份
- 调用 `age` 对正文和附件进行加密/解密

这意味着：

- 不直接自行实现 XChaCha20-Poly1305
- 不手工管理每条内容的 nonce
- 不将密码学安全寄托在自定义格式上

## 6. 系统架构

```text
┌──────────────────────────────────────────────┐
│ Skill Layer                                  │
│ OpenClaw Skill / 对话式入口                   │
│ 将自然语言转换为结构化动作                     │
├──────────────────────────────────────────────┤
│ Application Layer                            │
│ Use Cases: init/unlock/new/list/show/search  │
│ 业务规则、输入校验、权限检查                   │
├──────────────────────────────────────────────┤
│ Crypto Layer                                 │
│ age CLI 或 age 库封装                         │
│ identity 管理、文件加解密、密钥会话管理         │
├──────────────────────────────────────────────┤
│ Storage Layer                                │
│ SQLite: 元数据                                │
│ File System: 加密正文与加密附件                │
└──────────────────────────────────────────────┘
```

### 6.1 模块职责

#### Skill Layer

- 接收用户自然语言输入
- 做轻量意图识别
- 生成结构化参数
- 调用 CLI 或应用层接口

#### Application Layer

- 校验命令参数
- 处理分类、标签、条目状态
- 管理条目与附件的生命周期
- 协调存储与加密模块

#### Crypto Layer

- 初始化 age 身份
- 保护和读取本地密钥材料
- 加密正文与附件
- 解密导出到受控临时位置

#### Storage Layer

- 保存和查询元数据
- 管理条目文件路径与附件路径
- 提供按分类、标签、时间的检索能力

## 7. 数据边界与存储设计

### 7.1 存储目录

```text
~/.cerberus/
├── vault/
│   ├── entries/
│   │   └── <entry-id>.age
│   └── attachments/
│       └── <attachment-id>.age
├── db.sqlite
├── config.json
├── keys/
│   └── identity.age.enc
└── sessions/
    └── .gitkeep
```

### 7.2 哪些数据加密

默认必须加密：

- 条目正文
- 附件二进制内容
- age 身份文件

默认不加密但尽量最小化暴露：

- 条目 ID
- 分类
- 标签
- 标题
- 创建时间
- 更新时间
- 附件数量

说明：

- MVP 搜索依赖标题和标签，因此这两类元数据默认明文保存在 SQLite 中。
- 如果后续要提升隐私等级，可以增加“隐藏标题模式”，但不放进当前阶段。

### 7.3 SQLite 建议表结构

`entries`

- `id`
- `title`
- `category`
- `content_path`
- `created_at`
- `updated_at`
- `deleted_at`

`tags`

- `id`
- `name`

`entry_tags`

- `entry_id`
- `tag_id`

`attachments`

- `id`
- `entry_id`
- `original_name`
- `mime_type`
- `encrypted_path`
- `size_bytes`
- `created_at`

## 8. 安全边界

### 8.1 威胁模型

MVP 主要防御：

- 设备丢失后磁盘内容被直接读取
- 本地文件被复制后离线尝试破解
- 无意泄漏到日志、历史记录或普通文本文件

MVP 不防御：

- 设备已被持续入侵时的内存窃取
- 拥有当前系统账户权限的主动恶意程序
- 高级取证级别攻击
- 用户自己泄漏主密码

### 8.2 主密码与密钥管理

推荐设计：

1. 初始化时生成一份 age identity
2. 使用主密码通过 Argon2id 派生包装密钥
3. 用包装密钥加密 age identity 后写入本地
4. 每次解锁时用主密码解开 identity
5. 在当前进程会话中持有 identity，用于后续正文和附件加解密

注意：

- 主密码本身不直接用于加密条目内容
- 条目内容统一由 age identity 加密
- 不将解锁后的 identity 明文长期落盘

### 8.3 会话策略

MVP 建议：

- 默认命令级解锁：敏感命令执行时提示输入主密码
- 可选短时会话缓存：例如缓存 15 分钟，超时后重新解锁
- 会话缓存仅保存在本机受限权限目录，进程退出后尽量清理

如果第一版希望更稳，建议先只做“每次敏感操作都解锁”，后续再加短时缓存。

### 8.4 临时文件策略

- 查看正文时优先直接输出到终端，不落盘
- 编辑正文时解密到临时文件，编辑完成后重新加密并清理临时文件
- 导出附件时必须明确目标路径，不自动散落到系统临时目录
- 所有临时文件应尽量设置受限权限

### 8.5 日志与错误处理

- 不记录正文
- 不记录主密码
- 不记录解密后的附件路径内容
- 错误信息不回显敏感数据

## 9. CLI 设计

### 9.1 命令清单

```bash
cerberus init
cerberus unlock

cerberus new --title "..." --category diary --tags life,idea
cerberus list
cerberus list --category diary
cerberus show <entry-id>
cerberus edit <entry-id>
cerberus delete <entry-id>

cerberus search --tag life
cerberus search --title "旅行"

cerberus attach add <entry-id> <file-path>
cerberus attach list <entry-id>
cerberus attach export <attachment-id> <target-path>
```

### 9.2 分类枚举

- `diary`
- `note`
- `last_words`
- `collection`
- `secret`

CLI 内部使用稳定英文枚举，展示层再映射为中文名称。

### 9.3 输出原则

- 列表输出不展示正文摘要
- 查看正文时明确提示当前是解密内容
- 删除操作要求二次确认或 `--yes`

## 10. OpenClaw Skill 集成边界

Skill 在 MVP 中只做“自然语言入口”，不承担安全核心逻辑。

职责：

- 意图识别
- 参数补全
- 调用 CLI
- 以更自然的方式展示结果

不负责：

- 直接管理密钥
- 持久化敏感内容
- 绕过 CLI 的权限与解锁检查

建议 Skill 支持的意图：

- 记录一条内容
- 列出某类内容
- 按标签检索
- 查看某条内容
- 删除某条内容

## 11. MVP 开发计划

### 阶段 1：项目骨架与配置

目标：

- 初始化 TypeScript CLI 项目
- 建立目录结构
- 定义配置读取和路径解析逻辑

交付物：

- 可运行的 `cerberus --help`
- 基础日志和错误处理

### 阶段 2：金库初始化与解锁

目标：

- 实现 `init`
- 生成并保护 age identity
- 保存本地配置

交付物：

- 能创建 `~/.cerberus/`
- 能完成首次初始化

### 阶段 3：条目 CRUD

目标：

- 实现 `new/list/show/edit/delete`
- 正文加密落盘
- 元数据写入 SQLite

交付物：

- 可创建并查看加密条目

### 阶段 4：标签与搜索

目标：

- 标签关联
- 标题与标签搜索
- 分类筛选和排序

交付物：

- 可通过 `list/search` 管理内容

### 阶段 5：附件支持

目标：

- 附件加密存储
- 附件列表
- 附件导出

交付物：

- 可安全保存和导出图片、音频等附件

### 阶段 6：Skill 接入

目标：

- 提供基础 Skill 适配层
- 跑通创建、列表、查看三类典型流程

交付物：

- 对话式入口可用

## 12. 项目骨架建议

```text
cerberus/
├── docs/
│   └── PROJECT.md
├── src/
│   ├── cli/
│   │   └── index.ts
│   ├── commands/
│   │   ├── init.ts
│   │   ├── unlock.ts
│   │   ├── new.ts
│   │   ├── list.ts
│   │   ├── show.ts
│   │   ├── edit.ts
│   │   ├── delete.ts
│   │   ├── search.ts
│   │   └── attach.ts
│   ├── core/
│   │   ├── config.ts
│   │   ├── paths.ts
│   │   ├── errors.ts
│   │   └── types.ts
│   ├── crypto/
│   │   ├── age.ts
│   │   ├── identity.ts
│   │   └── session.ts
│   ├── storage/
│   │   ├── db.ts
│   │   ├── entries.ts
│   │   ├── tags.ts
│   │   └── attachments.ts
│   ├── services/
│   │   ├── vault-service.ts
│   │   └── search-service.ts
│   ├── skill/
│   │   └── openclaw.ts
│   └── index.ts
├── tests/
│   ├── unit/
│   └── integration/
├── package.json
├── tsconfig.json
├── README.md
└── .gitignore
```

## 13. 开工建议

为了降低首个版本的风险，建议按下面顺序实现：

1. `init`
2. `new`
3. `list`
4. `show`
5. `delete`
6. `edit`
7. `search`
8. `attach`
9. `skill`

### 第一版最小验收标准

- 初始化后能创建一条加密文本
- 能列出条目元数据
- 能查看解密正文
- 能按标签找到目标条目
- 能添加并导出一个附件

达到以上标准，就已经是一个真实可用的 MVP。
