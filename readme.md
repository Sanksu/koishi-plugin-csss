# koishi-plugin-csss

[![npm](https://img.shields.io/npm/v/koishi-plugin-csss?style=flat-square)](https://www.npmjs.com/package/koishi-plugin-csss)

cs server status - 一个用于 Koishi 的 CS1.6 / CSS / CS:GO / CS2 服务器状态查询插件，支持单个/批量查询、服务器列表管理，并可将结果渲染为图片。

## 功能

- **单个/批量服务器查询**：查询指定/多个IP的 CS 服务器信息，支持从数据库读取预设列表或临时输入（基于gamedig）。
- **服务器列表管理**：在数据库中添加、移除、查看和清空常用服务器地址。
- **图片渲染**：将查询结果生成为游戏风格的图片横幅（基于 Puppeteer）。

## 依赖插件

本插件强依赖以下插件，请确保它们已安装并启用：

- [`koishi-plugin-gamedig`](https://www.npmjs.com/package/koishi-plugin-gamedig) – 查询 Source 引擎服务器
- [`koishi-plugin-puppeteer`](https://www.npmjs.com/package/koishi-plugin-puppeteer) – 将 HTML 渲染为图片
- `database`：用于存储服务器列表。

## 命令列表

### `cs <address:string>` - 查询单个服务器

查询指定地址的 CS 服务器状态。

**别名**：`查询`、`server`

**选项**：

- `-i, --image`：强制生成图片横幅（即使配置中关闭了图片生成）。

- `-t, --text`：强制输出文本格式（即使配置中开启了图片生成）。

- `-c, --clear`：清除插件运行时的内存缓存。

**用法**：

```bash
cs 127.0.0.1:27015
cs edgebug.cn
cs [::1]:27015 -i
```

### `cs.status` - 检查插件状态

显示插件当前运行状态、缓存数量和依赖可用性。

**用法**：

```bash
cs.status
```

### `cs.help` - 查看帮助信息

显示本插件的命令帮助。

### `csss [...addresses]` - 批量查询服务器

批量查询多个服务器。如果不指定地址，将查询数据库中存储的服务器列表。

**别名**：`批量查询`

**选项**：

- `-l, --list`：显示数据库中保存的服务器列表。

- `-a <address>, --add <address>`：添加一个服务器到数据库列表。

- `-r <index>, --remove <index>`：从数据库列表中移除指定序号的服务器。

- `-c, --clear`：清空数据库中的服务器列表。

- `-i, --image`：强制生成图片横幅。

- `-t, --text`：强制输出文本格式。

**用法**：

```bash
# 查询数据库中的所有服务器
csss

# 临时查询指定的几个服务器
csss 192.168.1.1:27015 game.example.com:27016

# 管理数据库列表
csss -l                         #显示数据库中保存的服务器列表
csss -a 127.0.0.1:27015         #将127.0.0.1:27015添加到数据库列表
csss -r 1                       #从数据库列表中移除序号为1的服务器
csss -c                         #清空数据库中的服务器列表
```

> 批量查询最多支持 10 个服务器，超出时仅查询前 10 个并给出提示。

## 自定义样式指南

`koishi-plugin-csss` 支持通过 `customHTML` 和 `customBatchHTML` 配置项自定义服务器状态图片的 HTML 结构和样式，从而打造符合自己风格的展示效果。本指南将说明可用的 HTML 结构、类名和修改示例。

### 1. 单个服务器查询模板 (`customHTML`)

当用户执行 `cs <地址>` 命令并生成图片时，插件会使用此模板渲染 HTML。

| 占位符 | 说明 | 示例值 |
|--------|------|--------|
| `{{SERVER_NAME}}` | 服务器名称（过滤特殊字符） | `HNS \| 身法躲猫猫` |
| `{{MAP}}` | 当前地图名称 | `hns_bbcity` |
| `{{PLAYERS_COUNT}}` | 当前玩家人数 | `4` |
| `{{MAX_PLAYERS}}` | 服务器最大玩家数 | `20` |
| `{{BOT_COUNT}}` | Bot 数量 | `2` |
| `{{PING}}` | 服务器延迟（毫秒） | `35` |
| `{{HOST}}` | 服务器 IP 或域名 | `127.0.0.1` |
| `{{PORT}}` | 端口号 | `27015` |
| `{{PLAYERS_LIST}}` | 玩家列表 HTML（自动生成，见下方说明） | - |
| `{{TIMESTAMP}}` | 当前查询时间（本地化格式） | `2026/4/21 23:30:25` |

### {{PLAYERS_LIST}} 生成的结构


无玩家时：

```html
<div class="player-row">服务器当前无玩家在线</div>
```

有玩家时（玩家数超过 10 人会自动分为两列显示，通过 display: flex 布局）：

```html
<div class="player-row">Player1</div>
<div class="player-row">Player2</div>
<!-- 超过 maxPlayers 时追加 -->
<div class="player-row">... 还有 N 位玩家未显示</div>
```


### 2. 批量查询模板 (customBatchHTML)

当用户执行 csss 命令（不带地址参数，查询数据库列表）并生成图片时使用。

| 占位符 | 说明 | 示例值 |
|--------|------|--------|
| `{{TOTAL}}` | 查询的服务器总数 | `5` |
| `{{SUCCESSFUL}}` | 成功查询的服务器数量 | `3` |
| `{{QUERY_TIME}}` | 批量查询总耗时（格式化） | `1.2秒 或 350ms` |
| `{{SERVERS_LIST}}` | 服务器列表 HTML（自动生成，见下方说明） | - |
| `{{TIMESTAMP}}` | 当前查询时间（本地化格式） | `2026/4/21 23:30:25` |

### {{SERVERS_LIST}} 生成的结构

每个服务器会生成如下 HTML（成功时）：

```html
<div class="server-item">
  <div class="server-header">
    <span class="server-index">1.</span>
    <span class="server-name">HNS | 身法躲猫猫</span>
    <span class="server-players">4/20</span>
  </div>
  <div class="server-details">
    <span class="server-addr">127.0.0.1:27015</span>
  </div>
  <div class="server-details">
    <span class="server-map">地图: hns_bbcity</span>
    <span class="server-ping">延迟: 35ms</span>
  </div>
</div>
```

查询失败时：

```html
<div class="server-item error">
  <div class="server-header">
    <span class="server-index">2.</span>
    <span class="server-name">127.0.0.1:27015</span>
    <span class="server-status">❌ 查询失败</span>
  </div>
  <div class="server-details error-msg">连接超时</div>
</div>
```

### 默认 HTML 模板结构参考

以下为当前版本默认模板的实际 HTML 结构，可供自定义时参考。

#### 单个服务器查询 (`cs`)

```html
<body>
  <div class="atmosphere" aria-hidden="true"></div>
  <main class="shell">
    <header class="hero">
      <p class="eyebrow">SERVER STATUS</p>
      <h1>服务器状态</h1>
    </header>
    <section class="server-grid">
      <div class="server-item">
        <div class="server-header">
          <span class="server-name">服务器名称</span>
          <span class="server-players" style="color: #4CAF50;">18/24</span>
        </div>
        <div class="server-details">
          <span class="server-addr">IP: 127.0.0.1</span>
        </div>
        <div class="server-details">
          <span class="server-map">地图: de_mirage</span>
          <span class="server-ping" style="color: #4CAF50;">延迟: 32ms</span>
        </div>
        <div class="border"></div>
        <!-- 玩家列表（由 {{PLAYERS_LIST}} 占位符生成） -->
        <div class="player-row">Player1</div>
        <div class="player-row">Player2</div>
        ...
      </div>
    </section>
    <footer class="site-footer">
      <p>查询时间：2026/6/18 13:33:37</p>
    </footer>
  </main>
</body>
```

#### 批量服务器查询 (`csss`)

```html
<body>
  <div class="atmosphere" aria-hidden="true"></div>
  <main class="shell">
    <header class="hero">
      <p class="eyebrow">SERVER DIRECTORY</p>
      <h1>服务器列表</h1>
      <p class="subtitle">查询耗时：1.2秒 | 成功：4/6</p>
    </header>
    <section class="server-grid">
      <!-- 成功的服务器条目 -->
      <div class="server-item">
        <div class="server-header">
          <span class="server-index">1.</span>
          <span class="server-name">服务器A</span>
          <span class="server-players" style="color: #4CAF50;">12/32</span>
        </div>
        <div class="server-details"><span class="server-addr">127.0.0.1:27015</span></div>
        <div class="server-details"><span class="server-map">地图: de_dust2</span><span class="server-ping" style="color: #4CAF50;">延迟: 45ms</span></div>
      </div>
      <!-- 失败的服务器条目 -->
      <div class="server-item error">
        <div class="server-header">
          <span class="server-index">2.</span>
          <span class="server-name">192.168.1.1:27016</span>
          <span class="server-status">❌ 查询失败</span>
        </div>
        <div class="server-details error-msg">连接超时</div>
      </div>
    </section>
    <footer class="site-footer">
      <p>查询时间：2026/6/18 13:33:37</p>
      <p>📋 输入 `cs 服务器地址` 查询单个服务器</p>
    </footer>
  </main>
</body>
```

### 注意事项

- 使用 `!important`：默认样式通常带有较高优先级，自定义时建议加 `!important` 确保覆盖。

- 字体支持：请确保运行环境已安装您指定的字体，否则将回退到默认字体。

- 图片尺寸：`imageWidth` 和 `imageHeight` 在配置中设定，但可通过 CSS 覆盖 `body` 的 `width` 和 `min-height`。

- 缓存限制：内存缓存最多保留 10 条记录，超出时自动淘汰最旧或已过期的条目。
