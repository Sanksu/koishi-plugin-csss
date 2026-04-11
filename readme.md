# koishi-plugin-csss

[![npm](https://img.shields.io/npm/v/koishi-plugin-csss?style=flat-square)](https://www.npmjs.com/package/koishi-plugin-csss)

cs server status - 一个用于 Koishi 的 CS:GO / CS2 服务器状态查询插件，支持单个/批量查询、服务器列表管理，并可将结果渲染为图片。

## 功能

- **单个/批量服务器查询**：查询指定/多个IP的 CS 服务器信息，支持从数据库读取预设列表或临时输入（基于gamedig）。
- **服务器列表管理**：在数据库中添加、移除、查看和清空常用服务器地址。
- **图片渲染**：将查询结果生成为游戏风格的图片横幅（基于 Puppeteer）。

## 依赖插件

本插件强依赖以下插件，请确保它们已安装并启用：

- `koishi-plugin-gamedig`：用于查询 Source 引擎服务器。
- `koishi-plugin-puppeteer`：用于将 HTML 渲染为图片。
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

## 自定义样式指南

`koishi-plugin-csss` 支持通过 `customCSS` 配置项注入自定义 CSS，让您能自由调整生成图片的视觉效果。本指南将说明可用的 HTML 结构、类名和修改示例。

### HTML 结构概览

### 单个服务器查询 (cs)

```html
<body>
  <div class="corner corner-tl"></div>
  <div class="corner corner-tr"></div>
  <div class="corner corner-bl"></div>
  <div class="corner corner-br"></div>
  
  <div class="title">[服务器状态查询]</div>
  <div class="server-name">服务器名称</div>
  <div class="divider"></div>
  
  <div class="info-row">
    <span>地图: de_dust2</span>
    <span>IP: 127.0.0.1:27015</span>
  </div>
  <div class="info-row">
    <span style="color: #4CAF50;">人数: 12/32</span>
    <span style="color: #4CAF50;">Ping: 45ms</span>
  </div>
  
  <div class="player-section">
    <div class="player-section-title">在线玩家</div>
    <div class="divider" style="margin: 5px 0 15px;"></div>
    <!-- 玩家列表 -->
    <div class="player-row">玩家名1</div>
    <div class="player-row">玩家名2</div>
    ...
  </div>
  
  <div class="timestamp">查询时间: 2024/1/1 12:00:00</div>
</body>
```

### 批量服务器查询 (csss)

```html
<body>
  <!-- 四角边框装饰 -->
  <div class="corner corner-tl"></div> ...
  
  <div class="title">[服务器状态批量查询]</div>
  <div class="stats">
    <span>查询时间: ...</span>
    <span>耗时: 2.1秒 | 成功: 3/5</span>
  </div>
  <div class="divider"></div>
  
  <!-- 每个服务器一个 item -->
  <div class="server-item">
    <div class="server-header">
      <span class="server-index">1.</span>
      <span class="server-name">服务器A</span>
      <span class="server-players" style="color: #4CAF50;">12/32</span>
    </div>
    <div class="server-details">
      <span class="server-addr">127.0.0.1:27015</span>
      <span class="server-ping" style="color: #4CAF50;">延迟: 45ms</span>
    </div>
    <div class="server-details">
      <span class="server-map">地图: de_dust2</span>
    </div>
  </div>
  
  <!-- 查询失败的条目 -->
  <div class="server-item error">
    <div class="server-header">
      <span class="server-index">2.</span>
      <span class="server-name">192.168.1.1:27016</span>
      <span class="server-status">❌ 查询失败</span>
    </div>
    <div class="server-details error-msg">连接超时</div>
  </div>
  
  <div class="timestamp">📋 输入 `cs 服务器地址` 查询单个服务器</div>
</body>
```

### 注意事项

- 使用`!important`：默认样式通常带有较高优先级，自定义时建议加`!important`确保覆盖。

- 字体支持：请确保运行环境已安装您指定的字体，否则将回退到默认等宽字体。

- 图片尺寸：`imageWidth` 和 `imageHeight` 在配置中设定，但可通过 CSS 覆盖 `body` 的 `width` 和 `min-height`。
