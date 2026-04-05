# Cerberus Iteration 3 任务卡

_最后更新：2026-04-04_

## 用途

本文件用于将 Cerberus 第三期迭代拆成更适合分发给不同 LLM 的任务卡。

本期主题：

- 恢复闭环
- 明文导入
- 一致性体检
- 数据卫生工具

## 使用方式

每次下发任务建议附带：

1. 当前技术方案：`docs/PROJECT.md`
2. 当前迭代计划：`docs/ITERATION_PLAN.md`
3. 本文档中对应任务卡
4. 仓库当前代码状态

## 推荐分发策略

如果你准备在这一期切换模型，建议不要把整期一次性丢给单个模型，而是按任务卡拆分后比较：

1. 用更强的模型做 `backup restore`
   建议：`gpt-5.4`。
2. 用代码效率更高或成本更低的模型做 `import`
   建议：`gpt-5.3-codex` 或 `gpt-5.4-mini`。
3. 用擅长系统梳理的模型做 `doctor check`
   建议：`gpt-5.3-codex`。
4. 用较稳妥的模型做 `doctor cleanup`
   建议：`gpt-5.4-mini` 或 `gpt-5.3-codex`。

这样在迭代结束后，更容易比较不同模型在“安全边界、测试可信度、文档遵守度”上的差异。

## 通用任务卡模板

```md
# 任务名称

## 目标

请完成：

- 

## 背景

- 项目是 Cerberus，本地优先的加密私密笔记金库
- 当前已完成前两期迭代
- 第三期聚焦恢复闭环与数据体检
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
- 对恢复、导入、清理类操作保持保守默认

## 输出要求

- 完成代码修改
- 补最少必要测试
- 简述实现方式
- 列出风险、假设和未完成项

## 验收标准

- 
```

## 任务卡列表

### Task Card 1：备份恢复 `backup restore`

适合模型：

- `gpt-5.4`
- `gpt-5.3-codex`

```md
# Task Card 1：备份恢复

## 目标

请实现 `cerberus backup restore` 的最小可用版本。

## 本次范围

- 从备份目录生成恢复计划
- 恢复前自动调用或复用备份校验
- 支持 `--dry-run`
- 将备份恢复到显式输出目录

## 不在范围内

- 不覆盖已有非空目录
- 不实现增量恢复
- 不实现远程备份恢复

## 可修改文件范围

- `src/commands/backup*.ts`
- `src/services/**`
- `src/core/**`
- `tests/**`
- `README.md`

## 实现要求

- 明确区分备份源目录与恢复目标目录
- restore 默认保守
- dry-run 输出稳定且可读

## 验收标准

- 正常备份可恢复为可用 vault
- 非法备份无法进入恢复
- 非空目标目录默认拒绝
```

### Task Card 2：明文导入 `import`

适合模型：

- `gpt-5.3-codex`
- `gpt-5.4-mini`

```md
# Task Card 2：明文导入

## 目标

请实现 `cerberus import` 的最小可用版本。

## 本次范围

- `--format json`
- `--format markdown`
- 从显式输入目录导入
- 导入结果统计

## 不在范围内

- 不做隐式去重合并
- 不恢复原始 entry id
- 不处理复杂 markdown frontmatter 方言

## 可修改文件范围

- `src/commands/import.ts`
- `src/services/**`
- `src/storage/**`
- `src/cli/index.ts`
- `tests/**`

## 实现要求

- 仅在用户显式指定时读取明文
- 不默认覆盖已有条目
- 导入结果应区分成功 / 跳过 / 冲突

## 验收标准

- JSON 导出文件可重新导入
- Markdown 目录可导入
- 输出统计清晰
```

### Task Card 3：Vault 体检 `doctor check`

适合模型：

- `glm5.1`
- `gpt-5.3-codex`

```md
# Task Card 3：Doctor 检查

## 目标

请实现 `cerberus doctor check`。

## 本次范围

- 检查配置、数据库、entries、attachments 一致性
- 文本输出
- `--json` 输出

## 不在范围内

- 不自动修复正文
- 不删除任何数据

## 可修改文件范围

- `src/commands/doctor*.ts`
- `src/services/**`
- `src/storage/**`
- `src/cli/index.ts`
- `tests/**`

## 验收标准

- 能发现缺失密文
- 能发现孤儿文件与孤儿记录
- json 输出稳定
```

### Task Card 4：保守清理 `doctor cleanup`

适合模型：

- `gpt-5.4-mini`
- `gpt-5.3-codex`

```md
# Task Card 4：Doctor 清理

## 目标

请实现基于 doctor 结果的保守清理能力。

## 本次范围

- `doctor cleanup --dry-run`
- `doctor cleanup --apply`
- 仅处理可明确判定的孤儿项

## 不在范围内

- 不修复缺失正文
- 不自动重建数据库记录
- 不删除仍被引用的文件

## 可修改文件范围

- `src/commands/doctor*.ts`
- `src/services/**`
- `src/storage/**`
- `tests/**`

## 实现要求

- 默认 dry-run
- `--apply` 才实际删除
- 输出必须列出具体处理项

## 验收标准

- 默认只报告不删除
- apply 后仅清理孤儿项
- 错误路径有最小必要测试
```

## Iteration 3 完成后的统一评估口径

如果你希望在第三期完成后比较不同模型的开发质量，建议统一按以下维度打分：

1. 需求符合度：是否完整覆盖任务卡验收标准。
2. 安全边界：是否默认保守，是否避免覆盖/误删/路径泄漏。
3. 测试可信度：是否真正测试了生产代码路径，而不是复制实现自证。
4. 代码边界：模块拆分是否清晰，是否引入无关重构。
5. 脚本友好度：输出、退出码、`--json` 契约是否稳定。
6. 文档完成度：README、help、风险提示是否同步更新。

如果你愿意，等下期开发完成后，我可以按这个口径直接给出模型间的横向评审结果。
