# Cerberus Iteration 2 开发计划

_最后更新：2026-03-31_

## 目标

第二期聚焦“数据安全与可迁移”，把当前 MVP 从“能用”推进到“更可托付”。

核心目标：

- 用户可以创建和校验备份
- 用户可以按需导出明文
- CLI 更适合脚本集成
- Skill 层不再只覆盖一半主链路

## 范围

### In Scope

- `backup create`
- `backup verify`
- `export --all`
- `export --category`
- `export --format json|markdown`
- `lock`
- `list/search/show --json`
- Skill 的 `delete/edit/attach` 最小支持

### Out of Scope

- `backup restore` 的完整恢复流程
- 语义搜索
- TUI
- timeline / today
- 密钥分片
- 时间锁

## 拆分原则

- 先做备份与导出，再做体验增强
- 每个阶段都应可独立验收
- 不为“未来的大功能”提前做复杂抽象
- 对明文导出保持保守实现

## 阶段规划

### Phase 1：备份格式与创建

目标：

- 实现 `cerberus backup create`

交付物：

- 备份目录或备份包格式定义
- `manifest.json`
- 文件完整性摘要
- 创建命令与基础错误处理

验收标准：

- 可生成包含完整 vault 数据的备份
- 备份中包含结构化 manifest
- 不会把解密后的 identity 或正文明文混入备份元数据

### Phase 2：备份校验

目标：

- 实现 `cerberus backup verify`

交付物：

- manifest 校验
- 文件存在性校验
- 摘要校验
- 校验结果输出

验收标准：

- 备份损坏时可发现
- 正常备份可稳定通过校验

### Phase 3：条目导出

目标：

- 实现 `cerberus export`

交付物：

- `--all`
- `--category`
- `--format json|markdown`
- 明确输出目录策略

验收标准：

- 可导出可读明文
- 不误解密到临时未知位置
- 行为在脚本模式下稳定

### Phase 4：CLI 自动化补齐

目标：

- 提高脚本友好度

交付物：

- `cerberus lock`
- `list --json`
- `search --json`
- `show --json`

验收标准：

- 脚本调用不需要脆弱的文本解析
- 会话可以显式关闭

### Phase 5：Skill 最小闭环

目标：

- 补齐自然语言入口的基础覆盖

交付物：

- `delete`
- `edit`
- `attach add`
- `attach list`
- `attach export`

验收标准：

- Skill 覆盖主命令闭环
- 不引入新的敏感信息泄漏

## 建议顺序

1. `backup create`
2. `backup verify`
3. `export`
4. `lock`
5. `--json`
6. Skill 补齐

## 测试要求

本期每一阶段都建议至少满足：

- 单元测试覆盖边界条件
- 集成测试覆盖主链路
- 对错误路径有最小必要验证

重点测试：

- 备份损坏检测
- 导出格式正确性
- `--json` 输出稳定性
- `lock` 后敏感命令重新要求解锁

## 完成定义

当以下条件都满足时，可认为二期完成：

- 用户可以创建并验证备份
- 用户可以按分类或全部导出条目
- CLI 脚本不必解析脆弱的纯文本表格
- Skill 覆盖主链路中的剩余关键命令
