# Cerberus Iteration 3 开发计划

_最后更新：2026-04-04_

## 目标

第三期聚焦“恢复闭环与数据体检”，把当前产品从“可备份、可导出”推进到“可恢复、可检查、可整理”。

核心目标：

- 用户可以恢复一个通过校验的备份
- 用户可以从明文导出重新导入数据
- 用户可以检查 vault 的结构一致性
- 用户可以保守地清理孤儿数据

## 范围

### In Scope

- `backup restore`
- `backup restore --dry-run`
- `import --format json`
- `import --format markdown`
- `doctor check`
- `doctor check --json`
- `doctor cleanup --dry-run`
- `doctor cleanup --apply`

### Out of Scope

- 自动合并冲突条目
- 云端备份与同步
- 语义搜索
- TUI
- 审计日志

## 拆分原则

- 先补恢复，再做导入与体检
- 每个阶段都应可独立验收
- 对清理与恢复保持保守默认
- 一切可能破坏现有数据的操作都要显式触发

## 阶段规划

### Phase 1：备份恢复

目标：

- 实现 `cerberus backup restore`

交付物：

- 恢复计划生成
- dry-run 输出
- 从备份目录恢复完整 vault
- 基础错误处理

验收标准：

- 正常备份可恢复到新目录
- restore 前会校验备份
- 默认不覆盖已有目录

### Phase 2：导入

目标：

- 实现 `cerberus import`

交付物：

- `--format json`
- `--format markdown`
- 明确输入目录策略
- 冲突与跳过输出

验收标准：

- JSON 导出结果可重新导入
- Markdown 目录可导入为条目
- 行为在脚本模式下稳定

### Phase 3：Doctor 检查

目标：

- 实现 `cerberus doctor check`

交付物：

- 配置 / DB / 文件系统一致性检查
- 文本输出
- `--json` 输出

验收标准：

- 能发现缺失密文、孤儿文件、孤儿记录
- 输出结构清晰

### Phase 4：Cleanup

目标：

- 提供保守的数据清理能力

交付物：

- `doctor cleanup --dry-run`
- `doctor cleanup --apply`
- 基于 doctor 结果的孤儿数据处理

验收标准：

- 默认不删除任何数据
- `--apply` 后只清理可明确判定的孤儿项

## 建议顺序

1. `backup restore`
2. `import`
3. `doctor check`
4. `doctor cleanup`

## 建议模型分配

为了降低并行开发时的耦合，建议按任务性质分配：

1. `backup restore`
   建议：`gpt-5.4` 或 `gpt-5.3-codex`
   原因：涉及恢复流程、目录安全边界、dry-run 语义和较多错误路径。
2. `import`
   建议：`gpt-5.3-codex` 或 `gpt-5.4-mini`
   原因：格式解析和输出统计较多，但安全边界相对清晰。
3. `doctor check`
   建议：`gpt-5.3-codex`
   原因：需要系统性梳理 DB、文件系统和一致性规则。
4. `doctor cleanup`
   建议：`gpt-5.4-mini` 或 `gpt-5.3-codex`
   原因：逻辑不一定复杂，但对保守默认和误删风险很敏感。

## 测试要求

本期每一阶段都建议至少满足：

- 单元测试覆盖边界条件
- 集成测试覆盖主链路
- 对错误路径有最小必要验证

重点测试：

- restore 前校验失败
- restore 拒绝覆盖非空目录
- JSON / Markdown 导入格式正确
- doctor 能发现孤儿数据
- cleanup 默认 dry-run，不误删

建议额外覆盖：

- restore 后 vault 可直接执行 `list` / `show`
- import 后可再次 `export` 并保持结构稳定
- doctor 的文本输出与 json 输出结论一致
- cleanup 对非孤儿项明确拒绝处理

## 完成定义

当以下条件都满足时，可认为三期完成：

- 用户可以从备份恢复 vault
- 用户可以从明文导入数据
- 用户可以检查 vault 一致性
- 用户可以保守处理孤儿数据

## 1.0 候选发布门槛

如果你希望第三期完成后把 Cerberus 视为第一个可使用的 `1.0`，我建议至少再满足以下条件：

### 功能门槛

- 备份、校验、恢复三条链路可端到端验证
- 导出、导入可形成最小迁移闭环
- doctor 能识别常见数据不一致
- cleanup 只处理可明确判定的孤儿项

### 质量门槛

- `npm run check` 与 `npm test` 稳定全绿
- 恢复、导入、doctor 至少各有一条集成测试主链路
- 高风险命令默认保守，不覆盖、不删除、不隐式修复
- 关键错误信息可读，但不泄漏敏感路径与明文

### 发布门槛

- `README.md` 补齐 restore / import / doctor 的使用说明
- 明确写出“1.0 支持范围”和“仍不支持的能力”
- 至少完成一次真实备份 -> 恢复 -> 解锁 -> 列表检查的手工验收

## 1.0 前仍建议补的点

即使三期功能按计划完成，我仍建议在宣布 `1.0` 前检查以下项目是否也已补齐：

1. 帮助信息与 README 是否覆盖所有新命令，避免功能存在但不可发现。
2. 错误码与脚本返回语义是否一致，尤其是 restore / import / doctor / cleanup。
3. 高风险命令是否都有 `--dry-run`、显式目标路径或确认边界。
4. `--json` 输出是否为稳定契约，而不是随手打印。
5. 是否做过一次跨目录、跨机器场景的真实恢复演练。

如果这些点仍缺失，我会更倾向把它定义为 `0.9.x` 而不是 `1.0`。
