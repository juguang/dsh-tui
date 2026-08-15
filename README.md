# dsh-tui

一个基于 **pi-tui**（差分渲染终端 UI 库）构建的 dsh 交互式终端界面（TUI）插件。界面分层：顶部状态栏、中部滚动消息区（markdown + 工具卡片）、底部带 `❯` 提示与占位符的边框输入框。

## 界面

```
new session-xxx · deepseek-official/deepseek-v4-flash · /home/user/project  ● idle   ← 状态栏
───────────────────────────────────────────────────────────────────────────
assistant
    新会话 模型 deepseek-official/deepseek-v4-flash，工作目录 /home/user/project…
───────────────────────────────────────────────────────────────────────────
❯ 用一句话回答：1加1等于几
 ⏺
    **答案**：2
───────────────────────────────────────────────────────────────────────────
❯ 输入消息，Enter 发送，/help 查看命令                                       ← 输入框
───────────────────────────────────────────────────────────────────────────
```

## 功能

- **差分渲染**：pi-tui 只更新变化的行，无闪烁；支持 CSI 2026 同步输出、括号粘贴
- **流式 markdown**：assistant 回答逐 chunk 渲染（标题/粗体/斜体/行内代码/列表/围栏代码块/链接）
- **工具卡片**：`⚙ name(args)` + `└ ok/error`
- **终端审批**：工具调用需要权限时，会话区弹出"需要批准"卡片，输入 `y` 允许本次 / `n` 拒绝
- **会话列表**：`--list` 列出持久化会话并退出；`/sessions` 在对话中列出
- **编辑器**：多行输入，`❯` prompt 在框内，空输入显示占位符，支持历史（↑↓）
- `/exit` 退出；Ctrl+C 取消当前回合（空闲时连按两次退出）；`--resume <sessionId>` 恢复会话

## 安装

```sh
cd dsh-tui && pnpm pack
dsh plugin --profile tui add -w ./dsh-tui-0.1.0.tgz
```

## 启动

```sh
dsh --profile tui                    # 新会话
dsh --profile tui --resume <id>      # 恢复会话
dsh --profile tui --list             # 列出持久化会话并退出
dsh --profile tui --help             # 查看帮助
```

## 架构

```
cordis.patch.yml          # bundle 补丁层：tui-startup（解析 --resume/--list）+ tui-runner
src/
├── index.js              # 主循环：agent 驱动、会话事件→UI、命令分发
├── startup.js            # 命令行解析（--resume / --list）
├── ui.js                 # ChatUI：header + transcript + HintEditor（prompt/placeholder）
├── theme.js              # 调色板（状态栏/消息/工具/编辑器/placeholder）
├── sessions.js           # 会话列表（ctx.sessionQuery.listSessions）
└── approval.js           # 终端审批（approval/request waterfall → 会话卡片 + 编辑器 y/n）
```

关键点：
- **渲染**：`@earendil-works/pi-tui`（公共 registry，作为 dependencies 安装），`TuiMainScreen` + `Container` + `Editor`/`Markdown`/`Text`；`HintEditor` 是 Editor 子类，把 `❯ ` prompt 放进边框、空输入显示占位符
- **交互**：编辑器 `onSubmit` → `agent.followup()` → 订阅 `session/event` 流式更新 assistant 消息 → `whenIdle()` 后恢复编辑器焦点
- **审批**：`approval/request` waterfall 应答——会话区追加"需要批准"卡片，编辑器临时接管为 y/n 输入
- **dsh 依赖**（`@deepseek-ai/*`）动态 import；pi-tui 静态 import（公共 registry）
- 退出走 `ctx.appExit`（launcher 的 bounded shutdown，先 dispose 整棵树）

## 已验证（dsh 0.1.0-rc.6 + pi-tui 0.84.2）

- 新会话 → 提问 → markdown 流式回答 → 编辑器恢复（stderr 0 错误）
- `--resume` 延续上下文；`--list` 列出持久化会话
- 越界写入触发 sandbox 拒绝 → 模型升级 → 会话区审批卡片 → `y` 允许
- 注：`script` 伪终端下测试需用 `\r` 模拟 Enter（raw mode 下 Enter 是 CR）；真实终端正常
