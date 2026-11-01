# 手机操作模式（随插件安装）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用户安装本插件后，DSH「工作模式」列表里自动出现「手机操作」，只挂手机任务需要的插件行。

**Architecture:** `plugin/package.json` 的 `dsh.bundle.patch` 从单文件改为有序数组；新增的 patch 文件插入一条 `@deepseek-ai/dsh-agent-preset` 声明。`mobile_*` 六个工具注册在宿主层，任何模式都有，preset 里不重复挂插件本体。

**Tech Stack:** Cordis YAML patch、DSH agent preset、一次性 Node 校验脚本。

**Spec:** 2026-11-01 对话里确认的焦点模式设计（含 fs / shell / jobs）。

## Global Constraints

- preset `config.id` = `mobile-control`，`order: 5`，展示名 `手机操作`。
- 不新增运行时依赖，不改插件 JS 代码。
- shell 行按平台二选一：`tool-pwsh` 仅 Windows、`tool-bash` 仅非 Windows，用 `!!js` 表达式。
- 不挂 `tool-web`、`tool-schedule`、`tool-skill`、subagent / workflow / plan / goal。

## Review Focus

- 装完列表里没有「手机操作」：bundle patch 没被组合进 profile（路径或数组写错）。
- 模式挂上后看不到 `mobile_*`：说明“宿主注册对所有模式可见”的前提错了，方案要重做。
- Windows 上 shell 工具缺席或工具名对不上。
- `!!js` 标签被 YAML 解析器拒绝，导致整个 patch 加载失败、bundle 被跳过。

---

### Task 1: 声明手机操作 preset 并随 bundle 分发

**Files:**
- Create: `plugin/presets/mobile.patch.yml`
- Modify: `plugin/package.json`（`dsh.bundle.patch`、`files`）
- Modify: `README.md`
- Test: `.tmp-asar/check-preset.mjs`（一次性校验脚本，不提交）

**Interfaces:**
- Produces: preset id `mobile-control`、Loader 行 id `preset-mobile-control`、展示名 `手机操作`。

- [ ] **Step 1: 跑校验确认 RED**

Run: `node .tmp-asar/check-preset.mjs`
Expected: 非零退出，报 `plugin/presets/mobile.patch.yml` 不存在。

- [ ] **Step 2: 写 `plugin/presets/mobile.patch.yml`**

行顺序：`persona`（complete 手机操作员提示词）→ `tool-fs` → `tool-fs-search`（`sampleOverCapGlobResults: false`）→ `tool-bash` / `tool-pwsh`（`!!js` 平台条件）→ `tool-jobs` → `tool-ask-user` → `tool-todo` → `compaction` 组（`compaction-basic` + `command-compact` + `tool-result-pruner`，isolate 与 standard 一致）。

- [ ] **Step 3: 改 `plugin/package.json`**

`dsh.bundle.patch` 改成 `["./cordis.patch.yml", "./presets/mobile.patch.yml"]`；`files` 加 `presets/*.patch.yml`。

- [ ] **Step 4: 跑校验确认 GREEN**

Run: `node .tmp-asar/check-preset.mjs`
Expected: `PASS`，退出码 0（含 preset 结构、行集合、package.json 两处接线）。

- [ ] **Step 5: 回归离线测试**

Run: `node plugin/test/client.mjs`
Expected: 退出码 0（不需要手机）。

- [ ] **Step 6: README 补安装说明**

「装」一节末尾加一段：重启 DSH 后「工作模式」多出「手机操作」，只带手机任务需要的工具。

- [ ] **Step 7: Commit**

```bash
git add plugin/presets/mobile.patch.yml plugin/package.json README.md
git commit -m "feat: 随插件安装手机操作模式"
```
