# dsh-tui

一个极简的 dsh 交互式终端 UI（TUI）插件，**零 UI 依赖**（只用 Node 内置 `readline` + ANSI 颜色），核心逻辑照 headless bundle 的 startup/runner 拆分模式。

## 功能

- 交互式输入循环（`❯` 提示符，支持历史、行编辑）
- **流式输出**：assistant 文本随 chunk 实时打印（reasoning 用暗色）
- 工具调用展示：`⚙ name(args)` + `└ ok`
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
dsh --profile tui            # 新会话
dsh --profile tui --resume <id>   # 恢复会话
dsh --profile tui --help     # 查看帮助
```

## 架构

```
cordis.patch.yml          # bundle 补丁层：插入两行
├── tui-startup           # dsh-tui/startup.js —— 解析 --resume，provide tuiStartup 服务
└── tui-runner            # dsh-tui (src/index.js) —— 读 tuiStartup，驱动 agent + readline
```

关键点（与 headless 一致）：
- 启动器只认识 `--profile`/`--patch`，TUI 自己的 flag 由 `tui-startup` 通过 `@deepseek-ai/dsh-cmdline` 解析，经 `ctx.cmdlineArgs` 拿到不可变参数快照
- runner 通过 `inject: [tuiStartup]` 等 `tuiStartup` 服务存在后才激活，`!!js ctx.tuiStartup.resume` 惰性求值
- 运行流程：等 Loader settle → `ctx.agents.create/resume` → 订阅 `session/event` 流式渲染 → `agent.followup()` → `whenIdle()` → 回到提示符
- 退出走 `ctx.appExit`（launcher 提供的 bounded shutdown，先 dispose 整棵树再退）
