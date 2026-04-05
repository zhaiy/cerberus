# Cerberus 技术方案

> 面向 agents 的本地优先加密金库 CLI，先把命令契约做稳，再考虑更远的能力扩展。

_当前阶段：Iteration 4 / CLI 契约稳定与运维可信度_
_最后更新：2026-04-05_

## 1. 当前状态

Cerberus 已完成前三期迭代，当前仓库已经具备以下能力：

- 本地初始化金库
- 主密码解锁与短时会话
- 新建 / 查看 / 列表 / 编辑 / 删除文本条目
- 分类与标签管理
- 标题与标签搜索
- 加密附件保存与导出
- `--vault` / `--home` 路径覆盖
- `init` / `unlock` 的非 TTY 脚本输入
- `lock`
- `list/search/show --json`
- `backup create` / `backup verify` / `backup restore`
- `export --all|--category --format json|markdown`
- `import --format json|markdown`
- `doctor check` / `doctor check --json`
- `doctor cleanup --dry-run|--apply`
- OpenClaw 基础 Skill 闭环

当前产品已经从“可备份、可导出”推进到“可恢复、可检查、可保守维护”，但距离真正适合长期交给 agents 使用，还差一步“命令契约稳定化”。

## 2. Iteration 4 目标

第四期不做 UI，也不做 TUI，继续坚持以 CLI 和 agent 自动化为中心。

本期聚焦以下目标：

- 让高风险命令具备更稳定的机器可读输出
- 统一关键命令的退出语义和错误表达
- 为 restore / import / cleanup 等操作补上可追溯的本地操作记录
- 用更强的集成验收与演练文档，提升“可托付感”

## 3. 本期范围

### 3.1 计划纳入

| 模块 | 功能 | 说明 |
|---|---|---|
| 契约 | maintenance JSON 输出补齐 | 覆盖 backup / import / doctor cleanup 等维护命令 |
| 契约 | 错误与退出码整理 | 让脚本与 agent 更容易消费失败结果 |
| 运维 | 高风险操作日志 | 记录 backup / restore / import / cleanup 等操作摘要，不记录正文 |
| 验收 | 集成演练与发布清单 | 把“能跑”提升到“可复现验证” |

### 3.2 暂不纳入

- Web UI
- TUI
- 云同步
- 语义搜索
- 双向链接
- 分布式协作

## 4. 产品原则

### 4.1 继续坚持的原则

- 加密优先于便利
- 默认离线
- 元数据最小暴露
- 尽量使用成熟组件，不自造密码学方案
- 可自动化，但不牺牲默认安全边界

### 4.2 Iteration 4 新增原则

- 面向 agents 的命令必须优先提供稳定契约
- 高风险命令不仅要安全，还要可审计、可复盘
- 诊断输出与错误输出应当适合脚本消费，而不是只适合人眼阅读
- 不为了“未来 UI”提前引入复杂交互层

## 5. 系统架构

```text
┌──────────────────────────────────────────────┐
│ Agent / Skill Layer                          │
│ OpenClaw Skill / 自动化调用 / shell scripts   │
├──────────────────────────────────────────────┤
│ CLI Contract Layer                           │
│ help / exit codes / json output / errors     │
├──────────────────────────────────────────────┤
│ Application Layer                            │
│ entries / backup / import / doctor / attach  │
├──────────────────────────────────────────────┤
│ Crypto Layer                                 │
│ age CLI 封装、identity 管理、session 管理      │
├──────────────────────────────────────────────┤
│ Storage Layer                                │
│ SQLite 元数据 + 文件系统密文                  │
├──────────────────────────────────────────────┤
│ Operations Layer                             │
│ manifest / doctor / operation log / tests    │
└──────────────────────────────────────────────┘
```

## 6. Iteration 4 设计方向

### 6.1 机器可读契约补齐

目标：

- 让维护命令对 agent 更可预测

建议方向：

- 为 `backup verify` / `backup restore --dry-run` / `import` / `doctor cleanup` 补 `--json`
- 约束 JSON 字段命名、排序和失败输出语义
- 文本输出继续保留，但不再是唯一契约

### 6.2 错误与退出码整理

目标：

- 降低 shell / agent 集成时的脆弱解析

建议方向：

- 明确哪些失败属于 `INVALID_ARGS`、哪些属于 `BACKUP_FAILED`、哪些属于 `VAULT_STATE_INVALID`
- README 和 help 要同步说明高风险命令的失败边界

### 6.3 本地操作日志

目标：

- 对高风险命令形成最小必要审计

边界：

- 记录时间、命令、目标目录、结果摘要
- 不记录正文、明文附件、主密码
- 保持本地优先，不引入远程上报

### 6.4 集成演练与发布清单

目标：

- 把“理论上支持恢复”推进到“可以重复演练”

建议方向：

- 备份 -> 校验 -> 恢复 -> 解锁 -> list 的端到端验收
- 导出 -> 导入 -> 再导出的结构稳定性验证
- doctor / cleanup 的保守边界回归样例

## 7. 风险与取舍

### 7.1 机器可读输出膨胀风险

如果每个命令随手定义一套 JSON，会让 CLI 契约失控。本期需要优先统一字段命名与返回风格。

### 7.2 审计日志泄漏风险

操作日志很有价值，但如果记录过多上下文，反而会成为新的敏感信息面。本期必须坚持“只记操作摘要，不记正文内容”。

### 7.3 过早做 UI 的分心风险

Cerberus 当前主要使用者是 agents，而不是终端外的普通 GUI 用户。此时推进 UI 会稀释精力，也会拖慢契约稳定化。

## 8. 文档归档说明

已归档文档：

- `docs/history/2026-03-mvp/`
- `docs/history/2026-04-iteration-2/`
- `docs/history/2026-04-iteration-3/`

当前 `docs/` 根目录仅保留第四期文档。
