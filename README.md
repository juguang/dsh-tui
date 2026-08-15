# dsh-tui

一个极简的 dsh 交互式终端 UI（TUI）插件，**零 UI 依赖**（只用 Node 内置 `readline` + ANSI 颜色），核心逻辑照 headless bundle 的 startup/runner 拆分模式。

## 功能

- 交互式输入循环（`❯` 提示符，支持历史、行编辑）
- **流式输出 + markdown 渲染**：assistant 文本随 chunk 实时打印，支持 `# 标题`、`**粗体**`、`*斜体*`、`` `代码` ``、列表、引用、围栏代码块（reasoning 用暗色）
- 工具调用展示：`⚙ name(args)` + `└ ok`
- **终端审批**：工具调用需要权限时，终端内弹出 `[y/n]` 确认（`y`/`yes` → `allowed-once`，其余拒绝）
- **会话列表**：`--list` 列出持久化会话并退出；`/sessions` 在对话中列出
- `/exit` 退出；Ctrl+C 取消当前回合（2 秒内连按两次退出）
- `--resume <sessionId>` 恢复已有会话

## 安装

```sh
# 从本地目录（link 模式）
dsh plugin --profile tui add ./dsh-tui

# 或打包后安装
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
cordis.patch.yml          # bundle 补丁层：插入两行
├── tui-startup           # dsh-tui/startup.js —— 解析 --resume/--list，provide tuiStartup 服务
└── tui-runner            # dsh-tui (src/index.js) —— 读 tuiStartup，驱动 agent + readline
src/
├── index.js              # 主循环：事件渲染、readline、命令分发
├── startup.js            # 命令行解析（--resume / --list）
├── markdown.js           # 轻量 markdown → ANSI 流式渲染器
├── sessions.js           # 会话列表（ctx.sessionQuery.listSessions）
└── approval.js           # 终端审批 answerer（approval/request waterfall → [y/n]）
```

关键点（与 headless 一致）：
- 启动器只认识 `--profile`/`--patch`，TUI 自己的 flag 由 `tui-startup` 通过 `@deepseek-ai/dsh-cmdline` 解析，经 `ctx.cmdlineArgs` 拿到不可变参数快照
- runner 通过 `inject: [tuiStartup]` 等 `tuiStartup` 服务存在后才激活，`!!js ctx.tuiStartup.resume` / `!!js ctx.tuiStartup.list` 惰性求值
- 运行流程：等 Loader settle → `ctx.agents.create/resume` → 订阅 `session/event` 流式渲染 → `agent.followup()` → `whenIdle()` → 回到提示符
- 退出走 `ctx.appExit`（launcher 提供的 bounded shutdown，先 dispose 整棵树再退）

## 已验证（dsh 0.1.0-rc.6）

- 新会话 → 提问 → markdown 流式回答 → 退出（退出码 0）
- `--resume` 延续上下文
- `--list` 列出全部持久化会话
- 越界写入触发 sandbox 拒绝 → 模型请求升级 → 终端 `[y/n]` 审批 → `allowed`
