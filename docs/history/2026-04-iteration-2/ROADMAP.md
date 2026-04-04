# Cerberus Roadmap

_最后更新：2026-03-31_

## 1. 当前状态

第一期 MVP 已完成并完成一轮补强，当前已落地：

- 初始化、解锁与短时会话
- 文本条目 CRUD
- 标签与标题搜索
- 加密附件添加与导出
- OpenClaw 基础 Skill
- `--vault` / `--home`
- `--password-stdin`

当前最适合推进的方向不是“更炫的能力”，而是“更可恢复、更可迁移、更适合脚本和长期使用”。

## 2. 当前迭代重点

### Priority 1

#### 2.1 备份创建与校验

- `cerberus backup create`
- `cerberus backup verify`

理由：

- 备份是数据安全底线
- 这是当前最缺但最关键的能力

#### 2.2 明文导出

- `cerberus export --all`
- `cerberus export --category`
- `cerberus export --format json|markdown`

理由：

- 解决迁移与整理需求
- 让用户不被单一工具格式锁住

#### 2.3 CLI 自动化补齐

- `cerberus lock`
- `list/search/show --json`

理由：

- 当前 CLI 已可用，但脚本集成还不够顺手

### Priority 2

#### 2.4 Skill 最小闭环补齐

- `delete`
- `edit`
- `attach add/list/export`

理由：

- 当前 skill 只覆盖一部分主链路
- 补齐后更接近“对话即界面”

## 3. 中期候选项

### 3.1 时间线视图

- `cerberus timeline`
- `cerberus today`

适合在备份与导出完成后考虑。

### 3.2 语义搜索

方向：

- 本地 embedding
- 受控索引
- 不暴露原文

这项价值高，但不应早于备份。

### 3.3 TUI

可在 CLI 稳定之后推进，避免过早把逻辑复杂度转移到 UI。

## 4. 长期探索

- Shamir 密钥分片恢复
- 时间锁
- 审计日志
- 双向链接
- 密码强度分析

## 5. 风险提醒

- 任何涉及明文导出的功能，都需要明确 UX 和输出边界
- 备份如果格式设计过重，容易拖慢交付
- 在没有恢复验证前，不应把“已备份”作为强承诺

## 6. 文档历史

上一期文档已归档：

- `docs/history/2026-03-mvp/LLM_TASK_CARDS.md`
- `docs/history/2026-03-mvp/MVP_PLAN.md`
- `docs/history/2026-03-mvp/PROJECT.md`
- `docs/history/2026-03-mvp/ROADMAP.md`
