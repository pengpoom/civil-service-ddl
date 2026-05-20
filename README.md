# 考公考编 DDL

> Just-DDL Network 独立专题仓库。中文优先展示，跟踪公务员、事业单位、选调生、三支一扶和基层项目相关报名、笔试、面试节点。

## 页面

- GitHub Pages: https://pengpoom.github.io/civil-service-ddl/
- Hub: https://just-agent.github.io/just-ddl/
- Repo: https://github.com/pengpoom/civil-service-ddl

## 数据概览

| 指标 | 数值 |
| --- | ---: |
| 当前记录 | 27 |
| 真实公告 | 21 |
| Source board 入口 | 6 |
| 来源族 | 6 |
| 当前状态 | 北京公开招聘 parser + Source board 种子数据 |

## 数据说明

当前数据采用真实公告和 Source board 混合模式：北京公开招聘来源已由 crawler 解析公告正文中的报名截止时间；其他来源先登记官方入口，`deadline` 仅用于排序和数据契约占位，页面应通过 `isDatePlaceholder: true` 显示“待官方公告”，不应展示倒计时。

后续 crawler 解析出真实公告时间后，再将对应条目改为真实 `deadline`，并移除 `isDatePlaceholder`。

## 数据链路

- `data/items.json`: DDL 条目，每条事件包含 `deadline`、`url`、`source`。
- `data/sources.json`: 官方来源和入口清单。
- `scripts/crawl-sources.mjs`: source-specific crawler；当前支持北京市公开招聘公告报名截止时间解析，失败时保留当前 `data/items.json`。
- `scripts/validate-data.mjs`: 数据质量校验。
- `scripts/link-check.mjs`: 链接检查，默认 warning-only，设置 `STRICT_LINK_CHECK=1` 后严格失败。

## 本地校验

```bash
npm run validate
npm run link-check
STRICT_LINK_CHECK=1 npm run link-check
```

## 自动更新

`.github/workflows/update-data.yml` 每周运行 crawler、validator 和 link-check。解析出真实数据后，会通过 `repository_dispatch` 通知 Hub 同步。
