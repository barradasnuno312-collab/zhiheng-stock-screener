# 结构化解析调用依据

核验日期：2026-10-02。实际插件版本：`@official-plugins/ai-text-to-json@1.0.26`。

Schema 摘录卡：

- 实例：`zh-intent-parser`；action：`textToJson`；输出模式：`unary`。
- 输入 required：`text`、`catalog`、`previous`，均为纯文本字符串。
- 输出 required：`intentSummary`（string）、`conditions`、`clarifications`、`unsupportedRequests`、`warnings`（array）。
- 数组内部结构仅由插件说明引导；必须通过 `shared/validation.ts` 的 Zod 校验。
- 调用侧：Server。原因：访问码保护、访客/全局配额与解析日志一致落库；使用任务触发、状态查询，入口快速返回。
- 服务端 `call()` 无泛型，结果先按 unknown 接收，再验证；所有输入均为文本。
- 固定模型ID `2015`、temperature `0.5`、maxTokens `8192` 遵守已安装manifest，不擅自映射为某个未核实的模型品牌。

实际获取路径：`miaoda-cli plugin list` 不支持该命令；`fullstack-cli` 命中了无关的旧npm工具，已停止；最终使用项目内 `plugin-hydrate.js` 成功生成运行时Schema，确认上述字段。之后安装普通npm依赖会移除独立插件包，应重新执行 `lark-cli apps +plugin-install`。

2026-10-02已完成首次真实调用及13组代表性表达验证，结构化输出达到既定字段预期；任务入队和可查询终态均通过。同日云端INSERT触发器自动执行真实解析，Chrome展示PE<30与营收同比>10两条条件；无需本地worker。详情见 `test-report.md`。
