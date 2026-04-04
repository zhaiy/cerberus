# Cerberus Roadmap

_最后更新：2026-04-04_

## 1. 当前状态

前两期已完成并完成一轮安全补强，当前已落地：

- 初始化、解锁、锁定与短时会话
- 文本条目 CRUD
- 标签与标题搜索
- 加密附件添加与导出
- OpenClaw 基础 Skill 闭环
- `--vault` / `--home`
- `--password-stdin`
- `backup create` / `backup verify`
- `export --all|--category --format json|markdown`
- `list/search/show --json`

当前最适合推进的方向不是继续堆新功能，而是把“备份”和“导出”真正闭环成“恢复”和“体检”。

## 2. 当前迭代重点

### Priority 1

#### 2.1 备份恢复

- `cerberus backup restore`
- `cerberus backup restore --dry-run`

理由：

- 只有备份没有恢复，闭环仍然不完整
- 这是当前最影响“可托付感”的缺口

#### 2.2 Vault 体检

- `cerberus doctor check`
- `cerberus doctor check --json`

理由：

- 长期使用后最现实的问题是“数据是否还一致”
- 这也是恢复前的重要前置能力

### Priority 2

#### 2.3 明文导入

- `cerberus import --format json`
- `cerberus import --format markdown`

理由：

- 导出之后需要有回流路径
- 这能帮助迁移和重建条目

#### 2.4 保守清理

- `cerberus doctor cleanup --dry-run`
- `cerberus doctor cleanup --apply`

理由：

- Doctor 只有发现问题而没有后续处理，价值有限
- 但清理必须保持保守默认

## 3. 1.0 发布候选判断

如果第三期目标全部完成，Cerberus 就有机会成为第一个“可实际使用”的 `1.0`。但我建议把 `1.0` 定义为“可托付”，而不是“功能数足够多”。

建议至少满足：

- 可恢复：备份 -> 校验 -> 恢复链路闭环
- 可迁移：导出 -> 导入链路闭环
- 可体检：doctor 能发现常见一致性问题
- 可保守维护：cleanup 默认 dry-run，显式 apply
- 可脚本化：关键维护命令具备稳定输出和明确退出语义
- 可说明：README / help / 风险边界表达完整

如果这些条件未全部满足，更适合作为 `0.9.x` 持续打磨。

## 4. 1.0 前仍建议补的非功能点

这些点不一定都要在第三期主任务里做完，但如果缺失，会影响 `1.0` 可信度：

### 4.1 文档与帮助

- `README.md` 覆盖 restore / import / doctor / cleanup
- `--help` 输出覆盖新增命令与风险提示

### 4.2 错误语义

- 高风险失败场景有明确退出码
- 脚本模式下不依赖脆弱文本解析

### 4.3 发布验收

- 至少做一次真实恢复演练
- 至少验证一个“导出后重新导入”的真实样本
- 至少验证一个“doctor 发现问题 -> cleanup 处理”的真实样本

### 4.4 安全边界

- 不泄漏敏感路径
- 不打印明文内容到错误输出
- 不在默认行为里覆盖或删除用户数据

## 5. 中期候选项

### 3.1 时间线视图

- `cerberus timeline`
- `cerberus today`

适合在恢复与 doctor 完成后考虑。

### 3.2 语义搜索

方向：

- 本地 embedding
- 受控索引
- 不暴露原文

这项价值高，但仍不应早于恢复与体检。

### 3.3 审计日志

适合在维护工具稳定后考虑：

- 记录 restore / import / cleanup 等高风险操作
- 但不记录正文敏感内容

## 6. 长期探索

- Shamir 密钥分片恢复
- 时间锁
- 双向链接
- 密码强度分析
- TUI

## 7. 风险提醒

- 任何恢复命令都必须明确目标目录，不能默认覆盖
- 任何导入命令都必须清晰处理冲突和跳过项
- 任何 cleanup 命令都应默认 dry-run
- 在没有充分验证前，不应把“可恢复”表述为绝对承诺

## 8. 文档历史

已归档文档：

- `docs/history/2026-03-mvp/`
- `docs/history/2026-04-iteration-2/`
