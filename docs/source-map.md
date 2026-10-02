# 源码与接口映射

技术栈：React 19、TypeScript、shadcn/ui、平台Table、ECharts；NestJS、Drizzle/Postgres；妙搭官方结构化AI插件与自动化触发器。

| 职责 | 文件 |
| --- | --- |
| 公共契约、指标、输入校验 | `shared/api.interface.ts`、`metric-catalog.ts`、`validation.ts` |
| 访问码、独立会话、管理权限 | `server/modules/research/access.service.ts` |
| 扶摇网络适配与业务错误解码 | `fuyao.service.ts`、`source-contract.ts` |
| 财务与价格窗口公式 | `metrics.ts` |
| 三态判断、同快照比较 | `screening.ts` |
| 数据快照读取 | `dataset.service.ts` |
| 持久化、锁、限流、任务租约 | `storage.service.ts` |
| AI解析及审计 | `intent.service.ts`、`server/capabilities/zh-intent-parser.json` |
| 分片队列、恢复、监控分发 | `job.service.ts` |
| 策略不可变版本与恢复 | `strategy.service.ts` |
| 手动与定时共用检查逻辑 | `monitor.service.ts` |
| 平台自动化绑定 | `research.automation.ts` |
| 业务及维护接口 | `research.controller.ts` |
| 前端请求出口 | `client/src/api/research.ts` |
| 工作台与访问入口 | `client/src/pages/research/ResearchPage.tsx` |
| 条件、结果、证据、策略库 | 同目录 `ConditionEditor`、`ResultsPanel`、`EvidenceDialog`、`StrategyLibrary` |

后端表结构由平台生成：`server/database/schema.ts`。业务模块在 `server/app.module.ts` 中注册，位于View fallback之前。

## HTTP API

| 方法与路径 | 说明 |
| --- | --- |
| GET `/api/access/session` | 会话有效性 |
| POST `/api/access/verify` | 访问码校验，限流后设置HttpOnly Cookie |
| POST `/api/access/logout` | 服务端撤销会话 |
| GET `/api/research/catalog` | 指标、配置及最新快照状态 |
| POST `/api/research/intent` | 快速创建解析任务 |
| GET `/api/research/jobs/:id` | 仅查询自己的解析任务 |
| POST `/api/research/runs` | 已确认条件筛选 |
| GET `/api/research/runs/:id` | 恢复自己的结果 |
| POST `/api/research/compare` | 比较同快照前后结果 |
| POST `/api/research/runs/:id/stocks` | 1只详情或2—3只比较 |
| GET/POST `/api/research/versions` | 列出/保存自己的版本 |
| GET `/api/research/versions/:id` | 恢复条件、结果与数据版本 |
| GET/POST `/api/research/monitors` | 列出/创建自己的监控 |
| PATCH `/api/research/monitors/:id` | 启停固定版本监控 |
| POST `/api/research/monitors/:id/check` | 手动检查及事件 |
| POST `/api/maintenance/refresh` | 独立管理员凭证创建全池刷新 |
| POST `/api/maintenance/recover` | 独立管理员凭证恢复一个待处理或租约过期任务 |
| GET `/api/maintenance/jobs/:id` | 管理员查看刷新进度 |
| POST `/api/maintenance/development/work/:id` | 仅development及管理员可用的验证入口 |

研究接口统一使用 `SessionGuard`；服务端从已验证Cookie获取owner，不接受前端ownerId。前端使用平台 `axiosForBackend` 函数并保留平台CSRF保护。访问码是经明确选择的评审访客方案，不建立注册、企业成员或角色系统。

## 可恢复取数

刷新入口 → 日历/300成分 → 3个100股估值任务 → 300个逐股财报/日线任务 → 不可变快照 → 每个监控独立任务。

父任务持久化下一分片；子任务和股票记录使用确定性ID。重试先检查已存在结果，过期租约由平台恢复触发器处理。浏览器轮询只读任务，不承担调度。快照保留最近7份及仍被结果引用者（比仅保留已保存策略更保守）。

触发器启用/变更需重新发布才能在线上生效，启用前已插入的任务不会重放INSERT事件。维护者可调用recover执行一个恢复单元，后续分片仍由真实INSERT触发器接续；手动恢复不计为定时调度验收。

## 发布对应

已发布访问入口：[知衡工作台](https://bytedance.feishuapp.cn/app/app_17f88a68s0k)。平台公开可达，研究接口需要服务端访问码会话。

| 验证版本 | 发布记录 |
| --- | --- |
| 条件值比较修复、桌面主流程验收 | 提交 `d907fa8fe81bcc6c34576af159fcfd526bb567ea`；release `7692066895445544139`，finished |
| 代码与实际页面一致性 | Chrome加载脚本URL包含该完整提交ID，保存与恢复流程已通过 |

公开源码：[barradasnuno312-collab/zhiheng-stock-screener](https://github.com/barradasnuno312-collab/zhiheng-stock-screener)。匿名仓库访问、`git ls-remote`及原始README读取已验证。

源码交付采用独立副本，不复制应用私有Git历史。导出的 `SOURCE-MANIFEST.json` 记录来源提交及每个文件的SHA-256；`RELEASE-MANIFEST.json`建立来源提交、release与在线URL的对应。平台配置、真实数据缓存、会话、内部工作笔记和个人资料不在公开范围。

每日调度已取得真实cron与`source=schedule`事件证据，配置恢复为每天北京时间16:30。最终运行版本以交付包`RELEASE-MANIFEST.json`中的来源提交与release为准；公开仓库根目录保留同一份清单供核对。
