import { Context, Schema, h } from 'koishi'
import { } from 'koishi-plugin-gamedig'
import { } from 'koishi-plugin-puppeteer'

export const name = 'csss'
export const inject = ['puppeteer', 'gamedig', 'database']

export interface Config {
  timeout: number
  cacheTime: number
  maxPlayers: number
  retryCount: number
  generateImage: boolean
  imageWidth: number
  imageHeight: number             // 注：实际作为 min-height 使用
  fontFamily: string
  customHTML: string      // 自定义单个服务器 HTML 模板
  customBatchHTML: string // 自定义批量查询 HTML 模板
}

export const Config: Schema<Config> = Schema.object({
  timeout: Schema.number().min(100).max(30000).default(500).description('查询超时时间(毫秒)'),
  cacheTime: Schema.number().min(0).max(300000).default(3000).description('缓存时间(毫秒，0为禁用缓存)'),
  maxPlayers: Schema.number().min(0).max(100).default(20).description('最大显示玩家数'),
  retryCount: Schema.number().min(0).max(5).default(1).description('查询失败重试次数'),
  generateImage: Schema.boolean().default(true).description('是否生成图片横幅（影响cs和csss命令）'),
  imageWidth: Schema.number().min(600).max(2000).default(1200).description('图片宽度(像素)'),
  imageHeight: Schema.number().min(200).max(2500).default(500).description('图片最小高度(像素)，实际高度会根据内容自适应'),
  fontFamily: Schema.string().default('JetBrains Mono, monospace').description('字体'),
  customHTML: Schema.string().role('textarea').description('自定义单个服务器查询的HTML模板，支持占位符：{{SERVER_NAME}}, {{MAP}}, {{PLAYERS_COUNT}}, {{MAX_PLAYERS}}, {{BOT_COUNT}}, {{PING}}, {{HOST}}, {{PORT}}, {{PLAYERS_LIST}}, {{TIMESTAMP}}').default(''),
  customBatchHTML: Schema.string().role('textarea').description('自定义批量查询的HTML模板，支持占位符：{{TOTAL}}, {{SUCCESSFUL}}, {{QUERY_TIME}}, {{SERVERS_LIST}}, {{TIMESTAMP}}').default(''),
})

// 类型定义
interface GamedigPlayer { name: string; raw?: Record<string, unknown> }
interface GamedigResult {
  name: string; map: string; players: GamedigPlayer[]; bots: GamedigPlayer[]
  maxplayers: number; password: boolean; ping: number
  connect?: string; host?: string; port?: number; raw?: { secure?: boolean }
}
interface ServerQueryData { game: string; result: GamedigResult }
interface CacheEntry { timestamp: number; data: ServerQueryData }
interface SingleQueryResult { index: number; server: string; success: boolean; data?: ServerQueryData; error?: string }
interface BatchQueryResult { results: SingleQueryResult[]; queryTime: number; serversToQuery: string[] }

// 预编译正则表达式
const CLEAN_NAME_REGEX = /^\d+|[\u0000-\u001F]/g
const ESCAPE_HTML_REGEX = /[&<>"']/g
const ESCAPE_MAP: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }

// 工具函数
const utils = {
  formatPing(ping: number): string {
    if (!ping || ping <= 0) return '未知'
    if (ping < 50) return `🟢 ${ping}ms`
    if (ping < 100) return `🟡 ${ping}ms`
    if (ping < 200) return `🟠 ${ping}ms`
    return `🔴 ${ping}ms`
  },
  cleanName(name: string): string {
    return name ? name.replace(CLEAN_NAME_REGEX, '').trim() : '未知'
  },
  truncateText(text: string, maxLength: number): string {
    return text.length > maxLength ? text.slice(0, maxLength) + '...' : text
  },
  getPingColor(ping: number): string {
    if (ping < 50) return '#4CAF50'
    if (ping < 100) return '#FFC107'
    if (ping < 200) return '#FF9800'
    return '#c03f36'
  },
  getPlayerColor(count: number): string {
    return count > 0 ? '#4CAF50' : '#c03f36'
  },
  formatTime(ms: number): string {
    if (ms < 1000) return `${ms}ms`
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}秒`
    return `${(ms / 1000).toFixed(0)}秒`
  },
  escapeHtml(str: string): string {
    return str ? str.replace(ESCAPE_HTML_REGEX, (ch) => ESCAPE_MAP[ch] || ch) : ''
  },
  getVisualLength(str: string): number {
    let len = 0
    for (const char of str) {
      len += char.charCodeAt(0) > 255 ? 2 : 1
    }
    return len
  },
  padEndVisual(str: string, targetLen: number): string {
    const currentLen = this.getVisualLength(str)
    if (currentLen >= targetLen) return str
    return str + ' '.repeat(targetLen - currentLen)
  }
}

declare module 'koishi' {
  interface Tables {
    csss_server: { id: number; address: string }
  }
}

export function apply(ctx: Context, config: Config) {
  const cache = new Map<string, CacheEntry>()
  const logger = ctx.logger('csss')

  if (!ctx.gamedig) { logger.error('需要安装并启用 koishi-plugin-gamedig 插件'); return }
  if (!ctx.puppeteer) { logger.error('需要安装并启用 koishi-plugin-puppeteer 插件'); return }
  if (!ctx.database) { logger.error('需要安装并启用数据库插件以存储服务器列表'); return }

  ctx.model.extend('csss_server', {
    id: 'unsigned',
    address: 'string',
  }, {
    primary: 'id',
    autoInc: true,
    unique: ['address'],
  })

  async function getServerList(): Promise<string[]> {
    const records = await ctx.database.get('csss_server', {}, ['id', 'address'])
    return records.sort((a, b) => a.id - b.id).map(r => r.address)
  }

  async function addServer(address: string): Promise<boolean> {
    try {
      await ctx.database.create('csss_server', { address })
      return true
    } catch (error) {
      if ((error as Error).message.includes('UNIQUE')) return false
      throw error
    }
  }

  async function removeServerByIndex(index: number): Promise<boolean> {
    const records = await ctx.database.get('csss_server', {}, ['id'])
    if (index < 1 || index > records.length) return false
    await ctx.database.remove('csss_server', { id: records[index - 1].id })
    return true
  }

  async function clearServers(): Promise<number> {
    const count = (await ctx.database.get('csss_server', {}, ['id'])).length
    if (count === 0) return 0
    await ctx.database.remove('csss_server', {})
    return count
  }

  function parseAddress(input: string): { host: string; port: number } {
    if (typeof input !== 'string') throw new Error(`地址必须是字符串`)
    let address = input.replace(/^(http|https|udp|tcp):\/\//, '')

    const ipv6WithPortMatch = address.match(/^\[([^\]]+)\]:(\d+)$/)
    if (ipv6WithPortMatch) {
      const port = parseInt(ipv6WithPortMatch[2], 10)
      if (port >= 1 && port <= 65535) return { host: ipv6WithPortMatch[1], port }
      throw new Error('端口无效')
    }

    const ipv6OnlyMatch = address.match(/^\[([^\]]+)\]$/)
    if (ipv6OnlyMatch) return { host: ipv6OnlyMatch[1], port: 27015 }

    const parts = address.split(':')
    if (parts.length === 2) {
      const port = parseInt(parts[1], 10)
      if (port >= 1 && port <= 65535) return { host: parts[0], port }
      throw new Error('端口无效')
    }

    if (parts.length === 1) return { host: parts[0], port: 27015 }

    throw new Error(`无效的地址格式 "${input}"。支持: IP:端口, 域名:端口, [IPv6]:端口`)
  }

  async function queryServer(host: string, port: number): Promise<ServerQueryData> {
    const cacheKey = `${host}:${port}`
    const now = Date.now()

    if (config.cacheTime > 0) {
      const cached = cache.get(cacheKey)
      if (cached && now - cached.timestamp < config.cacheTime) {
        return cached.data
      }
    }

    let lastError: unknown
    for (let i = 0; i <= config.retryCount; i++) {
      try {
        const result = await ctx.gamedig.query({
          type: 'csgo', host, port, maxAttempts: 1,
          socketTimeout: config.timeout, attemptTimeout: config.timeout,
        })
        const data: ServerQueryData = { game: 'csgo', result: result as GamedigResult }

        if (config.cacheTime > 0) {
          cache.set(cacheKey, { timestamp: now, data })
        }
        return data
      } catch (error) {
        lastError = error
        if (i < config.retryCount) await new Promise(resolve => setTimeout(resolve, 1000))
      }
    }
    throw new Error(`无法连接到服务器 ${lastError instanceof Error ? lastError.message : '未知错误'}`)
  }

  async function queryServers(serversToQuery: string[]): Promise<BatchQueryResult> {
    const startTime = Date.now()
    const results = await Promise.allSettled(
      serversToQuery.map(async (server, index) => {
        try {
          const { host, port } = parseAddress(server)
          const data = await queryServer(host, port)
          return { index: index + 1, server, success: true, data } as SingleQueryResult
        } catch (error) {
          return { index: index + 1, server, success: false, error: (error as Error).message } as SingleQueryResult
        }
      })
    )

    return {
      results: results.map((res, idx) => res.status === 'fulfilled' ? res.value : { index: idx + 1, server: serversToQuery[idx], success: false, error: '未知错误' }),
      queryTime: Date.now() - startTime,
      serversToQuery
    }
  }

  function generateTextTable(results: SingleQueryResult[], serversToQuery: string[], queryTime: number, title: string = '批量查询结果'): string {
    const successful = results.filter(r => r.success).length
    let message = `📊 ${title} (${utils.formatTime(queryTime)})\n✅ 成功 ${successful} 个 ❌ 失败 ${results.length - successful} 个\n\n`

    results.forEach((result, idx) => {
      const num = (idx + 1).toString().padStart(2, ' ')
      if (result.success && result.data) {
        const d = result.data.result
        const name = utils.cleanName(d.name || '未知')
        const truncated = utils.truncateText(name, 12)
        const paddedName = utils.padEndVisual(truncated, 24)
        message += `${num} ${paddedName} ${d.players.length}/${d.maxplayers}\n`
      } else {
        message += `${num} ${serversToQuery[idx].padEnd(20)} ❌ 查询失败\n`
      }
    })
    return message
  }

  function formatServerInfo(data: ServerQueryData): string {
    const r = data.result
    const lines = [
      ` Counter-Strike 服务器\n`,
      r.name ? `🏷️ 名称 ${utils.cleanName(r.name)}` : null,
      r.map ? `🗺️ 地图 ${r.map}` : null,
      `👥 玩家 ${r.players.length}/${r.maxplayers}${r.bots.length ? ` (${r.bots.length} Bot)` : ''}`,
      r.ping ? `📶 Ping ${utils.formatPing(r.ping)}` : null,
      r.connect ? `🔗 连接 ${r.connect}` : `📍 地址 ${r.host || '未知'}:${r.port || '未知'}`,
    ]
    return lines.filter(Boolean).join('\n')
  }

  function formatPlayers(players: GamedigPlayer[]): string {
    if (!players.length) return '👤 服务器当前无在线玩家'
    const sorted = [...players].sort((a, b) => utils.cleanName(a.name).localeCompare(utils.cleanName(b.name)))
    const display = sorted.slice(0, config.maxPlayers)
    let msg = `👤 在线玩家 (${players.length}人)\n`
    display.forEach((p, i) => msg += `${i + 1}. ${utils.cleanName(p.name)}\n`)
    if (players.length > config.maxPlayers) msg += `... 还有 ${players.length - config.maxPlayers} 位玩家未显示`
    return msg.trim()
  }

  // 基础 CSS
  function getBaseCSS(): string {
    return `
      * { margin: 0; padding: 0; box-sizing: border-box; }
      body { 
        background: #1c1c1fcc; 
        font-family: ${config.fontFamily}; 
        width: ${config.imageWidth}px; 
        min-height: ${config.imageHeight}px; 
        padding: 40px; 
        color: #71717a; 
        position: relative; 
        border: 2px solid #2e2e33; 
        font-size: 24px;
      }
      .corner { position: absolute; width: 25px; height: 25px; border-color: #fbbf24; border-style: solid; border-width: 0; }
      .corner-tl { top: 2px; left: 2px; border-top-width: 3px; border-left-width: 3px; }
      .corner-tr { top: 2px; right: 2px; border-top-width: 3px; border-right-width: 3px; }
      .corner-bl { bottom: 2px; left: 2px; border-bottom-width: 3px; border-left-width: 3px; }
      .corner-br { bottom: 2px; right: 2px; border-bottom-width: 3px; border-right-width: 3px; }
      .divider { height: 2px; background: #2e2e33; margin: 20px 0; }
      .timestamp { margin-top: 30px; font-size: 0.8em; color: #666666; text-align: left; }
    `
  }

  // 生成玩家列表 HTML
  function buildPlayersListHTML(players: GamedigPlayer[]): string {
    const pCount = players.length
    if (pCount === 0) {
      return `<div class="player-row" style="color: #aaaaaa;">服务器当前无玩家在线</div>`
    }
    const sorted = [...players].sort((a, b) => utils.cleanName(a.name).localeCompare(utils.cleanName(b.name))).slice(0, config.maxPlayers)
    const isTwoCols = pCount > 10
    if (isTwoCols) {
      const half = Math.ceil(sorted.length / 2)
      const renderCol = (arr: typeof sorted) => arr.map(p => `<div class="player-row">${utils.escapeHtml(utils.truncateText(utils.cleanName(p.name), 20))}</div>`).join('')
      let html = `<div style="display: flex; gap: 40px;"><div>${renderCol(sorted.slice(0, half))}</div><div>${renderCol(sorted.slice(half))}</div></div>`
      if (pCount > config.maxPlayers) {
        html += `<div class="player-row" style="color: #aaaaaa; font-style: italic;">... 还有 ${pCount - config.maxPlayers} 位玩家未显示</div>`
      }
      return html
    } else {
      let html = sorted.map(p => `<div class="player-row">${utils.escapeHtml(utils.truncateText(utils.cleanName(p.name), 20))}</div>`).join('')
      if (pCount > config.maxPlayers) {
        html += `<div class="player-row" style="color: #aaaaaa; font-style: italic;">... 还有 ${pCount - config.maxPlayers} 位玩家未显示</div>`
      }
      return html
    }
  }

  // 生成单个服务器默认 HTML
  function generateDefaultServerHTML(data: ServerQueryData, host: string, port: number): string {
    const r = data.result
    const playersHTML = buildPlayersListHTML(r.players)
    return `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
      ${getBaseCSS()}
      .title { text-align: center; font-size: 1.5em; color: #71717a; margin-bottom: 20px; }
      .server-name { text-align: center; font-size: 1.8em; font-weight: bold; color: #fbbf24; margin: 10px 0 20px; word-break: break-word; }
      .info-row { display: flex; justify-content: space-between; margin: 15px 0; font-size: 1em; }
      .player-section { margin-top: 20px; }
      .player-section-title { font-size: 1em; font-weight: bold; color: #fcf8de; margin-bottom: 10px; }
      .player-row { font-size: 0.9em; color: #dddddd; line-height: 1.8; }
    </style></head><body>
      <div class="corner corner-tl"></div><div class="corner corner-tr"></div><div class="corner corner-bl"></div><div class="corner corner-br"></div>
      <div class="title">[服务器状态查询]</div>
      <div class="server-name">${utils.escapeHtml(utils.cleanName(r.name || '未知服务器'))}</div>
      <div class="divider"></div>
      <div class="info-row"><span>地图: ${utils.escapeHtml(r.map || '未知')}</span><span>IP: ${utils.escapeHtml(`${host}:${port}`)}</span></div>
      <div class="info-row"><span style="color: ${utils.getPlayerColor(r.players.length)};">人数: ${r.players.length}/${r.maxplayers}${r.bots.length ? ` (${r.bots.length} Bot)` : ''}</span><span style="color: ${utils.getPingColor(r.ping)};">Ping: ${r.ping ? r.ping + 'ms' : '未知'}</span></div>
      <div class="player-section"><div class="player-section-title">在线玩家</div><div class="divider" style="margin: 5px 0 15px;"></div>${playersHTML}</div>
      <div class="timestamp">查询时间: ${new Date().toLocaleString('zh-CN')}</div>
    </body></html>`
  }

  // 使用自定义模板渲染单个服务器 HTML
  function renderCustomServerHTML(data: ServerQueryData, host: string, port: number, template: string): string {
    const r = data.result
    const playersListHTML = buildPlayersListHTML(r.players)
    const replacements: Record<string, string> = {
      '{{SERVER_NAME}}': utils.escapeHtml(utils.cleanName(r.name || '未知服务器')),
      '{{MAP}}': utils.escapeHtml(r.map || '未知'),
      '{{PLAYERS_COUNT}}': r.players.length.toString(),
      '{{MAX_PLAYERS}}': r.maxplayers.toString(),
      '{{BOT_COUNT}}': r.bots.length.toString(),
      '{{PING}}': r.ping ? r.ping.toString() : '未知',
      '{{HOST}}': utils.escapeHtml(host),
      '{{PORT}}': port.toString(),
      '{{PLAYERS_LIST}}': playersListHTML,
      '{{TIMESTAMP}}': new Date().toLocaleString('zh-CN'),
    }
    let html = template
    for (const [placeholder, value] of Object.entries(replacements)) {
      html = html.split(placeholder).join(value)
    }
    return html
  }

  // 生成批量查询默认 HTML
  function generateDefaultBatchHTML(results: SingleQueryResult[], serversToQuery: string[], queryTime: number): string {
    const successful = results.filter(r => r.success).length
    let serversHTML = results.map((result, index) => {
      if (result.success && result.data) {
        const d = result.data.result
        return `<div class="server-item">
          <div class="server-header"><span class="server-index">${index + 1}.</span><span class="server-name">${utils.escapeHtml(utils.cleanName(d.name || '未知'))}</span><span class="server-players" style="color: ${utils.getPlayerColor(d.players.length)};">${d.players.length}/${d.maxplayers}</span></div>
          <div class="server-details"><span class="server-addr">${utils.escapeHtml(serversToQuery[index])}</span></div>
          <div class="server-details"><span class="server-map">地图: ${utils.escapeHtml(d.map || '')}</span><span class="server-ping" style="color: ${utils.getPingColor(d.ping)};">延迟: ${d.ping}ms</span></div>
        </div>`
      }
      return `<div class="server-item error">
        <div class="server-header"><span class="server-index">${index + 1}.</span><span class="server-name">${utils.escapeHtml(serversToQuery[index])}</span><span class="server-status">❌ 查询失败</span></div>
        <div class="server-details error-msg">${utils.escapeHtml(result.error || '未知错误')}</div>
      </div>`
    }).join('')

    return `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
      ${getBaseCSS()}
      .title { text-align: center; font-size: 1.8em; color: #71717a; margin-bottom: 20px; font-weight: bold; }
      .stats { display: flex; justify-content: space-between; font-size: 1em; margin-bottom: 10px; }
      .divider { background: #FFD700; margin: 15px 0 30px; }
      .server-item { margin-bottom: 30px; border-bottom: 1px solid #555555; padding-bottom: 20px; }
      .server-item:last-child { border-bottom: none; }
      .server-header { display: flex; align-items: center; gap: 10px; font-size: 1.2em; font-weight: bold; color: #ffffff; margin-bottom: 8px; }
      .server-index { color: #fbbf24; }
      .server-players { margin-left: auto; }
      .server-details { display: flex; flex-wrap: wrap; gap: 20px; font-size: 0.9em; color: #aaaaaa; position: relative; }
      .server-details span { white-space: nowrap; }
      .server-details .server-ping {position: absolute;right: 0;font-size: 24px;}
      .error .server-name { color: #c03f36; }
      .error-msg { color: #c03f36; font-size: 1em; }
    </style></head><body>
      <div class="corner corner-tl"></div><div class="corner corner-tr"></div><div class="corner corner-bl"></div><div class="corner corner-br"></div>
      <div class="title">[服务器状态批量查询]</div>
      <div class="stats"><span>查询时间: ${new Date().toLocaleString('zh-CN')}</span><span>耗时: ${utils.formatTime(queryTime)} | 成功: ${successful}/${results.length}</span></div>
      <div class="divider"></div>
      ${serversHTML}
      <div class="timestamp">📋 输入 \`cs 服务器地址\` 查询单个服务器</div>
    </body></html>`
  }

  // 生成批量查询服务器列表 HTML
  function buildServersListHTML(results: SingleQueryResult[], serversToQuery: string[]): string {
    return results.map((result, index) => {
      if (result.success && result.data) {
        const d = result.data.result
        return `<div class="server-item">
          <div class="server-header"><span class="server-index">${index + 1}.</span><span class="server-name">${utils.escapeHtml(utils.cleanName(d.name || '未知'))}</span><span class="server-players" style="color: ${utils.getPlayerColor(d.players.length)};">${d.players.length}/${d.maxplayers}</span></div>
          <div class="server-details"><span class="server-addr">${utils.escapeHtml(serversToQuery[index])}</span></div>
          <div class="server-details"><span class="server-map">地图: ${utils.escapeHtml(d.map || '')}</span><span class="server-ping" style="color: ${utils.getPingColor(d.ping)};">延迟: ${d.ping}ms</span></div>
        </div>`
      }
      return `<div class="server-item error">
        <div class="server-header"><span class="server-index">${index + 1}.</span><span class="server-name">${utils.escapeHtml(serversToQuery[index])}</span><span class="server-status">❌ 查询失败</span></div>
        <div class="server-details error-msg">${utils.escapeHtml(result.error || '未知错误')}</div>
      </div>`
    }).join('')
  }

  function renderCustomBatchHTML(results: SingleQueryResult[], serversToQuery: string[], queryTime: number, template: string): string {
    const successful = results.filter(r => r.success).length
    const serversListHTML = buildServersListHTML(results, serversToQuery)
    const replacements: Record<string, string> = {
      '{{TOTAL}}': results.length.toString(),
      '{{SUCCESSFUL}}': successful.toString(),
      '{{QUERY_TIME}}': utils.formatTime(queryTime),
      '{{SERVERS_LIST}}': serversListHTML,
      '{{TIMESTAMP}}': new Date().toLocaleString('zh-CN'),
    }
    let html = template
    for (const [placeholder, value] of Object.entries(replacements)) {
      html = html.split(placeholder).join(value)
    }
    return html
  }

  async function renderToImage(html: string): Promise<Buffer> {
    const page = await ctx.puppeteer.page()
    try {
      await page.setViewport({ width: config.imageWidth, height: config.imageHeight, deviceScaleFactor: 2 })
      await page.setContent(html, { waitUntil: 'load' })
      return await page.screenshot({ fullPage: true, type: 'png' })
    } finally {
      await page.close().catch(() => { })
    }
  }

  // 命令定义
  ctx.command('cs <address:string>', '查询服务器状态')
    .alias('查询').alias('server')
    .option('image', '-i 生成图片横幅')
    .option('text', '-t 输出文本信息')
    .option('clear', '-c 清除缓存')
    .action(async ({ options }, address) => {
      if (!address) return '使用格式 cs [地址:端口]\n示例 cs 127.0.0.1:27015 cs edgebug.cn'
      if (options?.clear) { const count = cache.size; cache.clear(); return `已清除 ${count} 条缓存记录` }

      try {
        const { host, port } = parseAddress(address)
        const data = await queryServer(host, port)
        const shouldGenImage = options?.image || (config.generateImage && !options?.text)

        if (shouldGenImage) {
          try {
            let html: string
            if (config.customHTML && config.customHTML.trim()) {
              html = renderCustomServerHTML(data, host, port, config.customHTML)
            } else {
              html = generateDefaultServerHTML(data, host, port)
            }
            return h.image(await renderToImage(html), 'image/png')
          } catch (imgErr) {
            logger.error('生成图片失败', imgErr)
            return `生成图片失败，已转为文本输出。\n\n${formatServerInfo(data)}\n\n${formatPlayers(data.result.players)}`
          }
        }
        return `${formatServerInfo(data)}\n\n${formatPlayers(data.result.players)}`
      } catch (error) {
        const err = error as Error
        let msg = `查询失败: ${err.message}\n\n`
        if (err.message.includes('无效的地址格式')) msg += '地址格式应为 地址:端口，默认端口27015'
        else msg += '请检查地址、防火墙及服务器类型'
        return msg
      }
    })

  ctx.command('cs.status', '检查插件状态和配置')
    .action(async () => {
      const gamedigStatus = ctx.gamedig ? '✅ 可用' : '❌ 不可用'
      let puppeteerStatus = '❌ 不可用'
      if (ctx.puppeteer) {
        try { const page = await ctx.puppeteer.page(); await page.setContent('<div>test</div>'); await page.close(); puppeteerStatus = '✅ 可用' } catch (e) { puppeteerStatus = `❌ 不可用` }
      }
      return `✅ CS服务器查询插件状态\n💾 缓存数量: ${cache.size}\n🗄️ 数据库服务器数量: ${(await getServerList()).length}\n🕹️ Gamedig: ${gamedigStatus}\n🖼️ Puppeteer: ${puppeteerStatus}\n⚙️ 配置: 超时=${config.timeout}ms 缓存=${config.cacheTime}ms 重试=${config.retryCount} 最大玩家=${config.maxPlayers} 图片=${config.generateImage ? '是' : '否'}`
    })

  ctx.command('cs.help', '查看帮助')
    .action(() => `🔫 CS服务器查询插件帮助\n\n📝 单服查询: cs [地址:端口]\n选项: -i 图片, -t 文本, -c 清除缓存\n\n🎯 批量查询: csss [地址1 地址2 ...]  (不指定地址则查询数据库列表)\n管理命令:\ncsss -l                查看数据库列表\ncsss -a <地址:端口>    添加服务器\ncsss -r <序号>         移除服务器\ncsss -c                清空数据库列表\n\n📋 状态: cs.status\n💡 默认端口27015，支持IPv6 (如 [::1]:27015)`)

  ctx.command('csss', '批量查询服务器状态')
    .alias('批量查询')
    .option('list', '-l 显示配置的服务器列表')
    .option('add', '-a <address:string> 添加服务器到列表')
    .option('remove', '-r <index:number> 从列表中移除服务器')
    .option('clear', '-c 清空服务器列表')
    .option('image', '-i 生成图片横幅')
    .option('text', '-t 输出文本信息')
    .action(async ({ session, options }, ...addresses) => {
      if (options?.list) {
        const list = await getServerList()
        if (!list.length) return '📋 服务器列表为空，请使用 csss -a 地址:端口 添加'
        return '📋 数据库中的服务器列表\n' + list.map((s, i) => `${i + 1}. ${s}`).join('\n')
      }
      if (options?.add !== undefined) {
        if (typeof options.add !== 'string' || !options.add.trim()) return '❌ 请提供要添加的服务器地址\n正确用法：csss -a 127.0.0.1:27015'
        try {
          parseAddress(options.add)
          const added = await addServer(options.add)
          if (!added) return `⚠️ 服务器 ${options.add} 已存在于列表中`
          return `✅ 已添加服务器 ${options.add}\n当前列表 ${(await getServerList()).length} 个服务器`
        } catch (error) { return `❌ 添加失败: ${(error as Error).message}` }
      }
      if (options?.remove !== undefined) {
        const index = options.remove
        if (typeof index !== 'number' || !Number.isInteger(index) || index < 1) {
          return '❌ 请提供有效的服务器序号（正整数）'
        }
        const success = await removeServerByIndex(options.remove)
        if (success) return `✅ 已移除序号 ${options.remove}\n当前列表 ${(await getServerList()).length} 个服务器`
        return `❌ 索引无效，请输入 1-${(await getServerList()).length} 之间的数字`
      }
      if (options?.clear) { return `✅ 已清空服务器列表，共移除 ${await clearServers()} 个服务器` }

      let serversToQuery: string[] = addresses.length > 0 ? addresses as string[] : await getServerList()
      if (!serversToQuery.length) return '❌ 没有可查询的服务器\n请使用 csss -a 地址:端口 添加服务器\n或使用 csss 地址1 地址2 ... 临时查询'

      const maxServers = 10
      if (serversToQuery.length > maxServers) {
        serversToQuery = serversToQuery.slice(0, maxServers)
        if (session) session.send(`⚠️ 服务器数量超过限制，仅查询前 ${maxServers} 个`)
      }

      try {
        const { results, queryTime } = await queryServers(serversToQuery)
        const shouldGenImage = options?.image || (config.generateImage && !options?.text)

        if (shouldGenImage) {
          try {
            let html: string
            if (config.customBatchHTML && config.customBatchHTML.trim()) {
              html = renderCustomBatchHTML(results, serversToQuery, queryTime, config.customBatchHTML)
            } else {
              html = generateDefaultBatchHTML(results, serversToQuery, queryTime)
            }
            return h.image(await renderToImage(html), 'image/png')
          } catch (imgErr) {
            logger.error('生成批量查询图片失败', imgErr)
          }
        }
        return generateTextTable(results, serversToQuery, queryTime) + '\n📋 输入 `cs 服务器地址` 查询单个服务器'
      } catch (error) { return `❌ 批量查询失败: ${(error as Error).message}` }
    })

  ctx.on('dispose', () => cache.clear())
}