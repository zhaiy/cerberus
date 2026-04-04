# Cerberus Iteration 2 任务卡

_最后更新：2026-03-31_

## 用途

本文件用于将 Cerberus 第二期迭代拆成更适合分发给不同 LLM 的任务卡。

本期主题：

- 数据安全与可迁移
- 备份、导出、自动化、Skill 补齐

## 使用方式

每次下发任务建议附带：

1. 当前技术方案：`docs/PROJECT.md`
2. 当前迭代计划：`docs/ITERATION_PLAN.md`
3. 本文档中对应任务卡
4. 仓库当前代码状态

## 通用任务卡模板

```md
# 任务名称

## 目标

请完成：

- 

## 背景

- 项目是 Cerberus，本地优先的加密私密笔记金库
- 当前已完成第一期 MVP
- 第二期聚焦数据安全与可迁移
- 技术方案见 `docs/PROJECT.md`
- 当前迭代计划见 `docs/ITERATION_PLAN.md`

## 本次范围

- 

## 不在范围内

- 

## 可修改文件范围

- 

## 实现要求

- 使用 TypeScript
- 保持模块边界清晰
- 不引入与本任务无关的大改动
- 对明文导出与备份逻辑保持保守实现

## 输出要求

- 完成代码修改
- 补最少必要测试
- 简述实现方式
- 列出风险、假设和未完成项

## 验收标准

- 
```

## 任务卡列表

### Task Card 1：备份创建 `backup create`

适合模型：

- `gpt-5.3-codex`
- `gpt-5.4`

```md
# Task Card 1：备份创建

## 目标

请实现 `cerberus backup create` 的最小可用版本。

## 本次范围

- 设计备份结构
- 收集 vault 必要文件
- 生成 `manifest.json`
- 计算文件摘要
- 将备份写入指定输出位置

## 不在范围内

- 不实现 restore
- 不实现远程上传
- 不引入云存储

## 可修改文件范围

- `src/commands/backup*.ts`
- `src/services/**`
- `src/core/**`
- `tests/**`
- `README.md`

## 实现要求

- 清晰区分源 vault 和输出目录
- 备份结构可校验
- 不泄漏明文正文到 manifest

## 验收标准

- 可创建包含完整 vault 数据的备份
- manifest 信息完整
- 测试覆盖主链路
```

### Task Card 2：备份校验 `backup verify`

适合模型：

- `glm5.1`
- `gpt-5.3-codex`

```md
# Task Card 2：备份校验

## 目标

请实现 `cerberus backup verify`。

## 本次范围

- 读取 manifest
- 校验备份结构
- 校验文件存在性
- 校验摘要

## 不在范围内

- 不恢复文件
- 不修改原 vault

## 可修改文件范围

- `src/commands/backup*.ts`
- `src/services/**`
- `tests/**`

## 验收标准

- 正常备份可通过校验
- 缺文件或损坏时能失败
```

### Task Card 3：明文导出 `export`

适合模型：

- `gpt-5.3-codex`

```md
# Task Card 3：明文导出

## 目标

请实现 `cerberus export` 的最小可用版本。

## 本次范围

- `--all`
- `--category`
- `--format json|markdown`
- 输出到显式目录

## 不在范围内

- 不实现自动同步
- 不实现加密导出

## 可修改文件范围

- `src/commands/export.ts`
- `src/services/**`
- `src/storage/**`
- `tests/**`

## 实现要求

- 仅在用户显式指定时导出明文
- 不默认覆盖已有文件
- 输出结构清晰

## 验收标准

- 可导出全部条目
- 可按分类导出
- json / markdown 格式正确
```

### Task Card 4：CLI 自动化增强

适合模型：

- `glm5.1`
- `minimax m2.7`

```md
# Task Card 4：CLI 自动化增强

## 目标

请补齐脚本友好的命令行为。

## 本次范围

- `cerberus lock`
- `list --json`
- `search --json`
- `show --json`

## 不在范围内

- 不重构全部参数解析器
- 不更改现有默认表格输出风格

## 可修改文件范围

- `src/commands/**`
- `src/cli/index.ts`
- `tests/**`

## 验收标准

- `lock` 可主动清理会话
- `--json` 输出稳定且可解析
```

### Task Card 5：Skill 最小闭环补齐

适合模型：

- `glm5.1`
- `gpt-5.3-codex`

```md
# Task Card 5：Skill 最小闭环补齐

## 目标

请补齐 OpenClaw Skill 的剩余关键 intent。

## 本次范围

- `delete`
- `edit`
- `attach add`
- `attach list`
- `attach export`

## 不在范围内

- 不实现复杂多轮推理
- 不引入新的 agent framework

## 可修改文件范围

- `src/skill/openclaw.ts`
- `src/services/**`
- `tests/**`

## 验收标准

- Skill 覆盖剩余关键主命令
- 返回结构清晰
- 敏感错误信息不泄漏路径细节
```
