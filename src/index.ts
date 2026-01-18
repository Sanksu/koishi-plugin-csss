import { Context, Schema, h } from 'koishi'
import { } from 'koishi-plugin-gamedig'
import { } from 'koishi-plugin-canvas'

export const name = 'cs-server-status'

export interface Config {
  timeout: number
  cacheTime: number
  maxPlayers: number
  retryCount: number
  showVAC: boolean
  showPassword: boolean
  generateImage: boolean
  imageWidth: number
  imageHeight: number
  fontSize: number
  fontFamily: string
  serverList: string[]
  batchTimeout: number
  // 新增定时任务配置
  scheduleEnabled: boolean
  scheduleInterval: number
  scheduleStartTime: string
  scheduleEndTime: string
  scheduleGroups: string[]
  scheduleUseImage: boolean
  // 新增QQ适配器配置
  qqAdapterName: string
  useFullChannelId: boolean
}

export const Config: Schema<Config> = Schema.object({
  timeout: Schema.number()
    .min(1000)
    .max(30000)
    .default(5000)
    .description('查询超时时间(毫秒)'),

  cacheTime: Schema.number()
    .min(0)
    .max(300000)
    .default(30000)
    .description('缓存时间(毫秒，0为禁用缓存)'),

  maxPlayers: Schema.number()
    .min(0)
    .max(100)
    .default(20)
    .description('最大显示玩家数'),

  retryCount: Schema.number()
    .min(0)
    .max(5)
    .default(2)
    .description('查询失败重试次数'),

  showVAC: Schema.boolean()
    .default(true)
    .description('是否显示VAC状态'),

  showPassword: Schema.boolean()
    .default(true)
    .description('是否显示密码保护信息'),

  generateImage: Schema.boolean()
    .default(true)
    .description('是否生成图片横幅（影响cs和csss命令）'),

  imageWidth: Schema.number()
    .min(600)
    .max(2000)
    .default(1200)
    .description('图片宽度(像素)'),

  imageHeight: Schema.number()
    .min(200)
    .max(2500)
    .default(500)
    .description('图片最小高度(像素)，实际高度会根据内容自适应'),

  fontSize: Schema.number()
    .min(12)
    .max(48)
    .default(24)
    .description('字体大小'),

  fontFamily: Schema.string()
    .default('"JetBrains Mono", monospace')
    .description('字体家族'),

  serverList: Schema.array(Schema.string())
    .role('table')
    .description('批量查询服务器列表（格式: 地址:端口，每行一个）')
    .default([
      'edgebug.cn:27015',
      'edgebug.cn:27016',
      'edgebug.cn:27017',
      'edgebug.cn:27018',
      'edgebug.cn:27019',
    ]),

  batchTimeout: Schema.number()
    .min(1000)
    .max(60000)
    .default(15000)
    .description('批量查询总超时时间(毫秒)'),

  // 定时任务配置
  scheduleEnabled: Schema.boolean()
    .default(false)
    .description('是否启用定时自动查询功能'),

  scheduleInterval: Schema.number()
    .min(1)
    .max(1440)
    .default(5)
    .description('定时查询间隔时间(分钟)'),

  scheduleStartTime: Schema.string()
    .pattern(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/)
    .default('08:00')
    .description('定时任务开始时间(24小时制，格式: HH:MM)'),

  scheduleEndTime: Schema.string()
    .pattern(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/)
    .default('23:00')
    .description('定时任务结束时间(24小时制，格式: HH:MM)'),

  scheduleGroups: Schema.array(Schema.string())
    .role('table')
    .description('定时发送的群组ID列表（每行一个群组ID）')
    .default([]),

  scheduleUseImage: Schema.boolean()
    .default(true)
    .description('定时任务是否使用图片格式输出'),

  // QQ适配器配置
  qqAdapterName: Schema.string()
    .default('qq')
    .description('QQ适配器名称（默认为"qq"，如果在QQ配置中指定了其他名称请修改）'),

  useFullChannelId: Schema.boolean()
    .default(true)
    .description('是否使用完整的频道ID格式（推荐开启）'),
})

interface CacheEntry {
  timestamp: number
  data: any
}

// 颜色和样式常量
const COLORS = {
  background: 'rgba(28,28,31,0.80)',
  text: 'rgb(113, 113, 122)',
  textLight: '#aaaaaa',
  textLighter: '#dddddd',
  textWhite: '#ffffff',
  border: '#2e2e33',
  accent: '#fbbf24',
  success: '#4CAF50',
  warning: '#FFC107',
  error: '#c03f36',
  pingGreen: '#4CAF50',
  pingYellow: '#FFC107',
  pingOrange: '#FF9800',
  pingRed: '#c03f36',
  playerOnline: '#4CAF50',
  playerOffline: '#c03f36',
  title: '#71717a',
  highlight: '#fbbf24',
  divider: '#555555',
  timestamp: '#666666',
  gold: '#FFD700',
  playerName: 'rgb(252, 248, 222)',
}

// 工具函数集合
const utils = {
  formatPing(ping: number): string {
    if (!ping || ping < 0) return '未知'
    if (ping < 50) return `🟢 ${ping}ms`
    if (ping < 100) return `🟡 ${ping}ms`
    if (ping < 200) return `🟠 ${ping}ms`
    return `🔴 ${ping}ms`
  },

  cleanName(name: string): string {
    return name ? name.replace(/\^[0-9]/g, '').replace(/[\u0000-\u001F]/g, '').trim() : '未知'
  },

  truncateText(text: string, maxLength: number): string {
    return text.length > maxLength ? text.substring(0, maxLength) + '...' : text
  },

  getPingColor(ping: number): string {
    if (ping < 50) return COLORS.pingGreen
    if (ping < 100) return COLORS.pingYellow
    if (ping < 200) return COLORS.pingOrange
    return COLORS.pingRed
  },

  getPlayerColor(count: number): string {
    return count > 0 ? COLORS.playerOnline : COLORS.playerOffline
  },

  formatTime(ms: number): string {
    if (ms < 1000) return `${ms}ms`
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}秒`
    return `${(ms / 1000).toFixed(0)}秒`
  },

  parseTimeToMinutes(timeStr: string): number {
    const [hours, minutes] = timeStr.split(':').map(Number)
    return hours * 60 + minutes
  },

  isWithinScheduleTime(startTime: string, endTime: string): boolean {
    const now = new Date()
    const currentMinutes = now.getHours() * 60 + now.getMinutes()
    const startMinutes = this.parseTimeToMinutes(startTime)
    const endMinutes = this.parseTimeToMinutes(endTime)

    return currentMinutes >= startMinutes && currentMinutes <= endMinutes
  },

  formatGroupId(groupId: string, adapterName: string, useFullChannelId: boolean): string {
    if (useFullChannelId) {
      return `${adapterName}:${groupId}`
    }
    return groupId
  },
}

export function apply(ctx: Context, config: Config) {
  const cache = new Map<string, CacheEntry>()
  let scheduleTimer: NodeJS.Timeout = null

  // 检查所需插件是否可用
  if (!ctx.gamedig) {
    console.error('koishi-plugin-gamedig 未安装或未启用')
    return ctx.logger('cs-server-status').error('需要安装并启用 koishi-plugin-gamedig 插件')
  }

  if (!ctx.canvas) {
    console.error('koishi-plugin-canvas 未安装或未启用')
    return ctx.logger('cs-server-status').error('需要安装并启用 koishi-plugin-canvas 插件')
  }

  // 通用查询结果处理函数
  async function queryServers(serversToQuery: string[]) {
    const startTime = Date.now()
    const results = await Promise.allSettled(
      serversToQuery.map(async (server, index) => {
        try {
          const { host, port } = parseAddress(server)
          const data = await queryServer(host, port)
          return {
            index: index + 1,
            server,
            success: true,
            data
          }
        } catch (error: any) {
          return {
            index: index + 1,
            server,
            success: false,
            error: error.message
          }
        }
      })
    )
    const endTime = Date.now()
    const queryTime = endTime - startTime

    return { results, queryTime, serversToQuery }
  }

  // 通用文本表格生成函数
  function generateTextTable(results: any[], serversToQuery: string[], queryTime: number, title: string = '批量查询结果'): string {
    const successful = results.filter(r => r.status === 'fulfilled' && r.value.success).length
    const failed = results.length - successful

    let message = `📊 ${title} (${utils.formatTime(queryTime)})\n`
    message += `✅ 成功: ${successful} 个 | ❌ 失败: ${failed} 个\n\n`
    message += '序号 服务器名称    在线人数\n'
    message += '──────────────────────────────\n'

    results.forEach((result, index) => {
      const serverInfo = serversToQuery[index]
      if (result.status === 'fulfilled') {
        const { success, data, error } = result.value

        if (success && data) {
          const { result: serverData } = data
          const serverName = serverData.name ? utils.cleanName(serverData.name) : '未知'
          const playerCount = serverData.players?.length || 0
          const maxPlayers = serverData.maxplayers || 0

          const truncatedName = utils.truncateText(serverName, 20)
          const paddedName = truncatedName.padEnd(20, ' ')

          message += `${(index + 1).toString().padStart(2, ' ')}  ${paddedName} ${playerCount}/${maxPlayers}\n`
        } else {
          message += `${(index + 1).toString().padStart(2, ' ')}  ${serverInfo} ❌ 查询失败: ${error}\n`
        }
      } else {
        message += `${(index + 1).toString().padStart(2, ' ')}  ${serverInfo} ❌ 查询失败\n`
      }
    })

    return message
  }

  // 定时任务执行函数
  async function executeScheduleTask() {
    if (!config.scheduleEnabled || config.scheduleGroups.length === 0 || config.serverList.length === 0) {
      return
    }

    if (!utils.isWithinScheduleTime(config.scheduleStartTime, config.scheduleEndTime)) {
      return
    }

    try {
      const { results, queryTime, serversToQuery } = await queryServers(config.serverList)
      const now = new Date()
      const timeStr = now.toLocaleString('zh-CN')

      let outputContent: string | h

      if (config.scheduleUseImage) {
        try {
          const imageBuffer = await generateBatchImage(results, serversToQuery, queryTime)
          outputContent = h.image(imageBuffer, 'image/png')
        } catch (imageError) {
          console.error('定时任务生成图片失败:', imageError)
          outputContent = `🕒 ${timeStr} 服务器状态更新\n生成图片失败，使用文本格式：\n\n`
        }
      }

      if (typeof outputContent === 'string' || !config.scheduleUseImage) {
        const textMessage = generateTextTable(results, serversToQuery, queryTime, '服务器状态更新')
        outputContent = `🕒 ${timeStr}\n\n${textMessage}`
      }

      // 向配置的群组发送消息
      for (const groupId of config.scheduleGroups) {
        try {
          const formattedGroupId = utils.formatGroupId(groupId, config.qqAdapterName, config.useFullChannelId)
          await ctx.broadcast([formattedGroupId], outputContent)
          console.log(`定时任务消息已发送到群组: ${formattedGroupId}`)
        } catch (error) {
          console.error(`定时任务发送消息到群组 ${groupId} 失败:`, error)
        }
      }

    } catch (error) {
      console.error('定时任务执行失败:', error)
    }
  }

  // 启动定时任务
  function startScheduleTask() {
    if (scheduleTimer) {
      clearInterval(scheduleTimer)
    }

    if (config.scheduleEnabled && config.scheduleInterval > 0) {
      const intervalMs = config.scheduleInterval * 60 * 1000
      executeScheduleTask()
      scheduleTimer = setInterval(executeScheduleTask, intervalMs)
      console.log(`定时任务已启动，间隔: ${config.scheduleInterval}分钟，时间范围: ${config.scheduleStartTime}-${config.scheduleEndTime}`)
    }
  }

  // 停止定时任务
  function stopScheduleTask() {
    if (scheduleTimer) {
      clearInterval(scheduleTimer)
      scheduleTimer = null
      console.log('定时任务已停止')
    }
  }

  // 监听配置变化
  ctx.on('config', () => {
    if (config.scheduleEnabled) {
      startScheduleTask()
    } else {
      stopScheduleTask()
    }
  })

  function parseAddress(input: string): { host: string, port: number } {
    let address = input.replace(/^(http|https|udp|tcp):\/\//, '')

    if (address.includes('[')) {
      const match = address.match(/^\[([^\]]+)\](?::(\d+))?$/)
      if (match) {
        const host = match[1]
        const port = match[2] ? parseInt(match[2]) : 27015
        if (port >= 1 && port <= 65535) return { host, port }
      }
    }

    const parts = address.split(':')
    if (parts.length === 2) {
      const host = parts[0]
      const port = parseInt(parts[1])
      if (!isNaN(port) && port >= 1 && port <= 65535) return { host, port }
    } else if (parts.length === 1) {
      return { host: parts[0], port: 27015 }
    }

    throw new Error(`无效的地址格式: ${input}\n正确格式: 地址:端口 或 地址`)
  }

  async function queryServer(host: string, port: number): Promise<{ game: string, result: any }> {
    const cacheKey = `${host}:${port}`
    const now = Date.now()

    if (config.cacheTime > 0) {
      const cached = cache.get(cacheKey)
      if (cached && now - cached.timestamp < config.cacheTime) {
        return cached.data
      }
    }

    let lastError: Error

    for (let i = 0; i <= config.retryCount; i++) {
      try {
        const result = await ctx.gamedig.query({
          type: 'csgo',
          host,
          port,
          maxAttempts: 1,
          socketTimeout: config.timeout,
          attemptTimeout: config.timeout,
        })

        const data = { game: 'csgo', result }

        if (config.cacheTime > 0) {
          cache.set(cacheKey, { timestamp: now, data })
        }

        return data
      } catch (error) {
        lastError = error
        if (i < config.retryCount) {
          await new Promise(resolve => setTimeout(resolve, 1000))
        }
      }
    }

    throw new Error(`无法连接到服务器: ${lastError?.message || '未知错误'}`)
  }

  function formatServerInfo(data: { game: string, result: any }): string {
    const { result } = data

    const lines = [
      ` Counter-Strike 服务器\n`,
      result.name ? `🏷️ 名称: ${utils.cleanName(result.name)}` : null,
      result.map ? `🗺️ 地图: ${result.map}` : null,
      `👥 玩家: ${result.players?.length || 0}/${result.maxplayers || 0}${result.bots?.length ? ` (${result.bots.length} Bot)` : ''}`,
      config.showPassword && result.password !== undefined ? `🔒 密码: ${result.password ? '是 🔐' : '否 🔓'}` : null,
      result.ping ? `📶 Ping: ${utils.formatPing(result.ping)}` : null,
      result.connect ? `🔗 连接: ${result.connect}` : `📍 地址: ${result.host || '未知'}:${result.port || '未知'}`,
      config.showVAC && result.raw?.secure !== undefined ? `🛡️ VAC: ${result.raw.secure ? '启用 ✅' : '关闭 ❌'}` : null,
    ]

    return lines.filter(Boolean).join('\n')
  }

  function formatPlayers(players: any[]): string {
    if (!players || players.length === 0) {
      return '👤 服务器当前无在线玩家'
    }

    const sortedPlayers = [...players].sort((a, b) => {
      const nameA = utils.cleanName(a.name).toLowerCase()
      const nameB = utils.cleanName(b.name).toLowerCase()
      return nameA.localeCompare(nameB)
    })

    const displayPlayers = sortedPlayers.slice(0, config.maxPlayers)
    let message = `👤 在线玩家 (${players.length}人):\n`

    displayPlayers.forEach((player, index) => {
      message += `${index + 1}. ${utils.cleanName(player.name)}\n`
    })

    if (players.length > config.maxPlayers) {
      message += `... 还有 ${players.length - config.maxPlayers} 位玩家未显示`
    }

    return message.trim()
  }

  // 图片生成相关的工具函数
  const imageUtils = {
  calculateServerNameFontSize(ctx: any, name: string, maxWidth: number, baseFontSize: number): number {
    try {
      if (!ctx || typeof ctx.measureText !== 'function') {
        console.warn('Canvas context not available, returning default font size')
        return baseFontSize * 1.5
      }
      
      let fontSize = baseFontSize * 1.5
      while (fontSize > baseFontSize * 0.8) {
        ctx.font = `bold ${fontSize}px ${config.fontFamily}`
        const measurement = ctx.measureText(name)
        if (measurement && measurement.width <= maxWidth) break
        fontSize -= 1
      }
      return fontSize
    } catch (error) {
      console.error('Error in calculateServerNameFontSize:', error)
      return baseFontSize * 1.5
    }
  },

    calculatePlayerListParams(playerCount: number) {
      const shouldEnlarge = playerCount > 0 && playerCount < 10
      return {
        shouldEnlarge,
        fontSizeMultiplier: shouldEnlarge ? 1.2 : 0.9,
        rowHeight: shouldEnlarge ? 40 : 30,
        nameMaxLength: shouldEnlarge ? 40 : 30,
        needTwoColumns: playerCount > 10
      }
    },

    drawBackground(ctx: any, width: number, height: number, color: string = COLORS.background) {
      ctx.fillStyle = color
      ctx.fillRect(0, 0, width, height)
    },

    drawTitle(ctx: any, text: string, x: number, y: number, fontSize: number, fontFamily: string, color: string = COLORS.textWhite) {
      ctx.fillStyle = color
      ctx.font = `bold ${fontSize}px ${fontFamily}`
      ctx.textAlign = 'center'
      ctx.fillText(text, x, y)
    },

    drawDivider(ctx: any, x1: number, y1: number, x2: number, y2: number, color: string = COLORS.divider, width: number = 2) {
      ctx.strokeStyle = color
      ctx.lineWidth = width
      ctx.beginPath()
      ctx.moveTo(x1, y1)
      ctx.lineTo(x2, y2)
      ctx.stroke()
    },

    drawText(ctx: any, text: string, x: number, y: number, options: {
      color?: string
      fontSize?: number
      fontFamily?: string
      align?: 'left' | 'center' | 'right'
      bold?: boolean
      italic?: boolean
    } = {}) {
      const {
        color = COLORS.text,
        fontSize = config.fontSize,
        fontFamily = config.fontFamily,
        align = 'left',
        bold = false,
        italic = false
      } = options

      ctx.fillStyle = color
      ctx.textAlign = align
      const fontStyle = `${bold ? 'bold' : ''} ${italic ? 'italic' : ''} ${fontSize}px ${fontFamily}`
      ctx.font = fontStyle.trim() || `${fontSize}px ${fontFamily}`
      ctx.fillText(text, x, y)
    },

    drawPlayerList(ctx: any, players: any[], startY: number, width: number, maxHeight: number, params: ReturnType<typeof imageUtils.calculatePlayerListParams>) {
      let y = startY

      if (players.length === 0) {
        this.drawText(ctx, '服务器当前无在线玩家', 80, y, { color: COLORS.textLight })
        return { y: y + 35, displayedCount: 0 }
      }

      const sortedPlayers = [...players].sort((a, b) => {
        const nameA = utils.cleanName(a.name).toLowerCase()
        const nameB = utils.cleanName(b.name).toLowerCase()
        return nameA.localeCompare(nameB)
      })

      if (params.needTwoColumns) {
        const leftColumnX = 80
        const rightColumnX = width / 2 + 80
        const playersPerColumn = Math.ceil(players.length / 2)
        const displayPerColumn = Math.min(playersPerColumn, Math.ceil(config.maxPlayers / 2))

        const leftPlayers = sortedPlayers.slice(0, displayPerColumn)
        const rightPlayers = sortedPlayers.slice(displayPerColumn, displayPerColumn * 2)

        let currentY = y
        let displayedCount = 0

        leftPlayers.forEach(player => {
          const name = utils.truncateText(utils.cleanName(player.name), params.nameMaxLength)
          this.drawText(ctx, name, leftColumnX, currentY, {
            fontSize: config.fontSize * params.fontSizeMultiplier,
            color: COLORS.textLighter
          })
          currentY += params.rowHeight
          displayedCount++
        })

        currentY = y
        rightPlayers.forEach(player => {
          const name = utils.truncateText(utils.cleanName(player.name), params.nameMaxLength)
          this.drawText(ctx, name, rightColumnX, currentY, {
            fontSize: config.fontSize * params.fontSizeMultiplier,
            color: COLORS.textLighter
          })
          currentY += params.rowHeight
          displayedCount++
        })

        y = Math.max(currentY + 15, y)

        const totalDisplayed = leftPlayers.length + rightPlayers.length
        if (players.length > totalDisplayed) {
          this.drawText(ctx, `... 还有 ${players.length - totalDisplayed} 位玩家未显示`, leftColumnX, y, {
            fontSize: config.fontSize * 0.8,
            color: COLORS.textLight,
            italic: true
          })
          y += 30
        }

        return { y, displayedCount }
      } else {
        const displayPlayers = sortedPlayers.slice(0, config.maxPlayers)

        displayPlayers.forEach(player => {
          const name = utils.truncateText(utils.cleanName(player.name), params.nameMaxLength)
          this.drawText(ctx, name, 80, y, {
            fontSize: config.fontSize * params.fontSizeMultiplier,
            color: COLORS.textLighter
          })
          y += params.rowHeight
        })

        return { y, displayedCount: displayPlayers.length }
      }
    },

    // 统一边框绘制函数
    drawBorder(ctx: any, width: number, height: number) {
      // 主边框
      this.drawDivider(ctx, 1, 1, width - 1, 1, COLORS.border, 2)
      this.drawDivider(ctx, width - 1, 1, width - 1, height - 1, COLORS.border, 2)
      this.drawDivider(ctx, width - 1, height - 1, 1, height - 1, COLORS.border, 2)
      this.drawDivider(ctx, 1, height - 1, 1, 1, COLORS.border, 2)

      // 侧边装饰线
      this.drawDivider(ctx, 5, 0.5 * height - 0.05 * height, 5, height - 0.5 * height + 0.05 * height, COLORS.border, 6)
      this.drawDivider(ctx, width - 5, 0.5 * height - 0.05 * height, width - 5, height - 0.5 * height + 0.05 * height, COLORS.border, 6)

      // 角标装饰
      this.drawDivider(ctx, 2, 2, 0.025 * width, 2, COLORS.accent, 3)
      this.drawDivider(ctx, 2, 2, 2, 0.025 * width, COLORS.accent, 3)
      this.drawDivider(ctx, width - 2, 2, width - 2, 0.025 * width, COLORS.accent, 3)
      this.drawDivider(ctx, width - 2, 2, width - 0.025 * width, 2, COLORS.accent, 3)
      this.drawDivider(ctx, width - 2, height - 2, width - 2, height - 0.025 * width, COLORS.accent, 3)
      this.drawDivider(ctx, width - 2, height - 2, width - 0.025 * width, height - 2, COLORS.accent, 3)
      this.drawDivider(ctx, 2, height - 2, 0.025 * width, height - 2, COLORS.accent, 3)
      this.drawDivider(ctx, 2, height - 2, 2, height - 0.025 * width, COLORS.accent, 3)
    }
  }

  function calculateImageHeight(data: { game: string, result: any }): number {
    const { result } = data
    const playerCount = result.players?.length || 0
    const playerParams = imageUtils.calculatePlayerListParams(playerCount)

    let baseHeight = 280

    if (playerCount === 0) {
      baseHeight += 60
    } else {
      baseHeight += 90

      if (playerParams.needTwoColumns) {
        const rows = Math.ceil(Math.min(playerCount, config.maxPlayers) / 2)
        baseHeight += rows * playerParams.rowHeight
      } else {
        const rows = Math.min(playerCount, config.maxPlayers)
        baseHeight += rows * playerParams.rowHeight
      }

      if (playerCount > config.maxPlayers) {
        baseHeight += 40
      }
    }

    if (config.showPassword && result.password !== undefined) {
      baseHeight += 35
    }

    if (config.showVAC && result.raw?.secure !== undefined) {
      baseHeight += 35
    }

    const height = Math.max(baseHeight, config.imageHeight)
    return Math.min(height, 2500)
  }

  // 生成单个服务器状态图片
  async function generateServerImage(data: { game: string, result: any }, host: string, port: number): Promise<Buffer> {
    const { result } = data

    const width = config.imageWidth
    const height = calculateImageHeight(data)

    const canvas = await ctx.canvas.createCanvas(width, height)
    const ctx2d = canvas.getContext('2d')

    imageUtils.drawBackground(ctx2d, width, height)

    const titleY = 80
    imageUtils.drawTitle(ctx2d, '[服务器状态查询]', width / 2, titleY, config.fontSize * 1.5, config.fontFamily, COLORS.title)

    if (result.name) {
      const cleanName = utils.cleanName(result.name)
      const fontSize = imageUtils.calculateServerNameFontSize(ctx2d, cleanName, width - 160, config.fontSize)
      imageUtils.drawTitle(ctx2d, cleanName, width / 2, titleY + 50, fontSize * 1.8, config.fontFamily, COLORS.highlight)
    }

    imageUtils.drawDivider(ctx2d, 80, titleY + 80, width - 80, titleY + 80, COLORS.border, 2)

    let y = titleY + 120

    if (result.map) {
      imageUtils.drawText(ctx2d, `地图: ${result.map}`, 80, y)
    }
    imageUtils.drawText(ctx2d, `IP: ${host}:${port}`, width - 80, y, { align: 'right' })

    y += 40

    const playerCount = result.players?.length || 0
    const botCount = result.bots?.length || 0
    const maxPlayers = result.maxplayers || 0
    const playerText = `人数: ${playerCount}/${maxPlayers}${botCount > 0 ? ` (${botCount} Bot)` : ''}`
    imageUtils.drawText(ctx2d, playerText, 80, y, { color: utils.getPlayerColor(playerCount) })

    if (result.ping) {
      imageUtils.drawText(ctx2d, `Ping: ${result.ping}ms`, width - 80, y, {
        align: 'right',
        color: utils.getPingColor(result.ping)
      })
    }

    y += 50

    const playerParams = imageUtils.calculatePlayerListParams(playerCount)

    imageUtils.drawText(ctx2d, '在线玩家', 80, y, { color: COLORS.playerName, bold: true, fontSize: config.fontSize })
    y += 40

    imageUtils.drawDivider(ctx2d, 80, y - 15, width - 80, y - 15, COLORS.divider, 1.5)

    y += 25
    const playerListResult = imageUtils.drawPlayerList(ctx2d, result.players || [], y, width, height, playerParams)
    y = playerListResult.y

    y += 30

    const now = new Date()
    imageUtils.drawText(ctx2d, `查询时间: ${now.toLocaleString('zh-CN')}`, 80, height - 20, {
      fontSize: config.fontSize * 0.8,
      color: COLORS.timestamp
    })

    // 边框
    imageUtils.drawBorder(ctx2d, width, height)

    return canvas.toBuffer('image/png')
  }

  // 生成批量查询图片
  async function generateBatchImage(results: any[], serversToQuery: string[], queryTime: number): Promise<Buffer> {
    const successful = results.filter(r => r.status === 'fulfilled' && r.value.success).length
    const failed = results.length - successful

    // 计算图片高度
    const baseHeight = 200
    const serverHeight = 100
    const width = config.imageWidth
    const height = baseHeight + (results.length * serverHeight)

    const canvas = await ctx.canvas.createCanvas(width, height)
    const ctx2d = canvas.getContext('2d')

    // 绘制背景
    imageUtils.drawBackground(ctx2d, width, height)

    // 绘制标题
    imageUtils.drawTitle(ctx2d, '[服务器状态批量查询]', width / 2, 100, config.fontSize * 1.8, config.fontFamily, COLORS.title)

    // 绘制统计信息
    const now = new Date()
    imageUtils.drawText(ctx2d, `查询时间: ${now.toLocaleString('zh-CN')}`, 80, 150)
    imageUtils.drawText(ctx2d, `耗时: ${utils.formatTime(queryTime)}  成功: ${successful}/${results.length}`, width - 80, 150, { align: 'right' })

    // 绘制分隔线
    imageUtils.drawDivider(ctx2d, 80, 165, width - 80, 165, COLORS.gold, 2)

    let y = 200

    // 绘制每个服务器的信息
    results.forEach((result, index) => {
      const server = serversToQuery[index]

      if (result.status === 'fulfilled') {
        const { success, data, error } = result.value

        if (success && data) {
          const serverData = data.result
          const serverName = serverData.name ? utils.cleanName(serverData.name) : '未知'
          const playerCount = serverData.players?.length || 0
          const maxPlayers = serverData.maxplayers || 0

          // 服务器序号和名称
          imageUtils.drawText(ctx2d, `${index + 1}. ${serverName}`, 80, y, {
            color: COLORS.textWhite,
            bold: true,
            fontSize: config.fontSize * 1.1
          })

          // 服务器地址
          imageUtils.drawText(ctx2d, server, 80, y + 30, {
            fontSize: config.fontSize * 0.8,
            color: COLORS.textLight
          })

          // 玩家数量
          const playerText = `${playerCount}/${maxPlayers}`
          const playerColor = playerCount > 0 ? COLORS.success : COLORS.error
          imageUtils.drawText(ctx2d, playerText, width - 80, y, {
            align: 'right',
            color: playerColor,
            bold: true
          })

          // 地图和延迟
          if (serverData.map) {
            imageUtils.drawText(ctx2d, `地图: ${serverData.map}`, 80, y + 60, {
              fontSize: config.fontSize * 0.8,
              color: COLORS.textLight
            })
          }

          if (serverData.ping) {
            const pingColor = utils.getPingColor(serverData.ping)
            imageUtils.drawText(ctx2d, `延迟: ${serverData.ping}ms`, width - 80, y + 60, {
              align: 'right',
              fontSize: config.fontSize * 0.9,
              color: pingColor
            })
          }

        } else {
          // 查询失败的信息
          imageUtils.drawText(ctx2d, `${index + 1}. ${server}`, 80, y, { color: COLORS.textWhite, bold: true })
          imageUtils.drawText(ctx2d, `❌ 查询失败: ${error}`, 200, y + 35, { color: COLORS.error })
        }
      } else {
        // Promise rejected
        imageUtils.drawText(ctx2d, `${index + 1}. ${server}`, 80, y, { color: COLORS.textWhite, bold: true })
        imageUtils.drawText(ctx2d, '❌ 查询失败', 200, y + 35, { color: COLORS.error })
      }

      // 绘制分隔线
      if (index < results.length - 1) {
        imageUtils.drawDivider(ctx2d, 80, y + 70, width - 80, y + 70, COLORS.divider, 1)
      }
      y += 100
    })

    // 使用统一的边框绘制函数
    imageUtils.drawBorder(ctx2d, width, height)

    return canvas.toBuffer('image/png')
  }

  // 新增：定时任务管理命令
  ctx.command('cs.schedule', '定时任务管理')
    .alias('定时任务')
    .option('status', '-s 查看定时任务状态', { type: Boolean, fallback: false })
    .option('start', '-S 启动定时任务', { type: Boolean, fallback: false })
    .option('stop', '-T 停止定时任务', { type: Boolean, fallback: false })
    .option('test', '-t 测试定时任务', { type: Boolean, fallback: false })
    .option('addGroup', '-a <groupId> 添加群组到定时任务', { type: String })
    .option('removeGroup', '-r <groupId> 从定时任务移除群组', { type: String })
    .option('listGroups', '-l 列出定时任务群组', { type: Boolean, fallback: false })
    .option('run', '-R 立即执行一次定时任务', { type: Boolean, fallback: false })
    .option('testQQ', '-q 测试QQ适配器连接', { type: Boolean, fallback: false })
    .action(async ({ session, options }) => {
      if (options.status) {
        const status = config.scheduleEnabled ? '✅ 已启用' : '❌ 已禁用'
        const nextRun = scheduleTimer ? '运行中' : '未运行'
        const groups = config.scheduleGroups.length

        // 检查QQ适配器
        const qqBots = ctx.bots.filter(bot => bot.platform === config.qqAdapterName)
        const qqStatus = qqBots.length > 0 ? `✅ 可用 (${qqBots.length}个)` : '❌ 不可用'

        return `📅 定时任务状态\n` +
          `状态: ${status}\n` +
          `定时器: ${nextRun}\n` +
          `间隔: ${config.scheduleInterval}分钟\n` +
          `时间范围: ${config.scheduleStartTime} - ${config.scheduleEndTime}\n` +
          `输出格式: ${config.scheduleUseImage ? '图片' : '文本'}\n` +
          `监控服务器: ${config.serverList.length}个\n` +
          `目标群组: ${groups}个\n` +
          `QQ适配器: ${qqStatus} (名称: ${config.qqAdapterName})\n` +
          `群组ID格式: ${config.useFullChannelId ? '适配器:群号' : '群号'}\n\n` +
          `使用 cs.schedule -h 查看所有命令选项`
      }

      if (options.start) {
        config.scheduleEnabled = true
        startScheduleTask()
        return '✅ 定时任务已启动'
      }

      if (options.stop) {
        config.scheduleEnabled = false
        stopScheduleTask()
        return '✅ 定时任务已停止'
      }

      if (options.test) {
        await executeScheduleTask()
        return '✅ 定时任务测试执行完成'
      }

      if (options.run) {
        await executeScheduleTask()
        return '✅ 已立即执行一次定时任务'
      }

      if (options.testQQ) {
        const qqBots = ctx.bots.filter(bot => bot.platform === config.qqAdapterName)
        if (qqBots.length === 0) {
          return `❌ 找不到 ${config.qqAdapterName} 适配器的机器人\n请确保已正确配置QQ适配器`
        }

        let message = `✅ 找到 ${qqBots.length} 个 ${config.qqAdapterName} 适配器机器人:\n`
        qqBots.forEach((bot, index) => {
          message += `${index + 1}. ${bot.selfId} (在线: ${bot.status})\n`
        })

        // 测试发送消息到当前会话
        if (session) {
          try {
            await session.send('测试消息: QQ适配器连接正常 ✓')
            message += '\n✅ 当前会话消息发送测试成功'
          } catch (error) {
            message += `\n❌ 当前会话消息发送失败: ${error.message}`
          }
        }

        return message
      }

      if (options.addGroup) {
        // 检查群组ID格式
        let groupId = options.addGroup.trim()

        // 如果启用了完整频道ID格式但用户没有提供适配器前缀，自动添加
        if (config.useFullChannelId && !groupId.includes(':')) {
          groupId = `${config.qqAdapterName}:${groupId}`
        }

        if (!config.scheduleGroups.includes(groupId)) {
          config.scheduleGroups.push(groupId)
          return `✅ 已添加群组 ${groupId} 到定时任务\n当前列表: ${config.scheduleGroups.length} 个群组`
        } else {
          return `❌ 群组 ${groupId} 已在列表中`
        }
      }

      if (options.removeGroup) {
        const index = config.scheduleGroups.indexOf(options.removeGroup)
        if (index !== -1) {
          config.scheduleGroups.splice(index, 1)
          return `✅ 已从定时任务移除群组 ${options.removeGroup}`
        } else {
          return `❌ 群组 ${options.removeGroup} 不在列表中`
        }
      }

      if (options.listGroups) {
        if (config.scheduleGroups.length === 0) {
          return '📋 定时任务群组列表为空\n使用 cs.schedule -a <群组ID> 添加群组'
        }

        let message = '📋 定时任务群组列表:\n'
        config.scheduleGroups.forEach((groupId, index) => {
          message += `${index + 1}. ${groupId}\n`
        })
        return message
      }

      // 如果没有指定选项，显示帮助信息
      return `📅 定时任务管理命令\n\n` +
        `选项:\n` +
        `-s, -status      查看定时任务状态\n` +
        `-S, -start       启动定时任务\n` +
        `-T, -stop        停止定时任务\n` +
        `-t, -test        测试定时任务\n` +
        `-R, -run         立即执行一次定时任务\n` +
        `-q, -testQQ      测试QQ适配器连接\n` +
        `-a, -addGroup    添加群组到定时任务\n` +
        `-r, -removeGroup 从定时任务移除群组\n` +
        `-l, -listGroups  列出定时任务群组\n\n` +
        `示例:\n` +
        `cs.schedule -s          # 查看状态\n` +
        `cs.schedule -S          # 启动定时任务\n` +
        `cs.schedule -a 123456   # 添加群组123456\n` +
        `cs.schedule -t          # 测试执行\n` +
        `cs.schedule -q          # 测试QQ适配器连接`
    })

  // 主命令 - cs [ip:端口] 查询服务器状态
  ctx.command('cs <address>', '查询服务器状态')
    .alias('查询')
    .alias('server')
    .option('noPlayers', '-n 隐藏玩家列表', { type: Boolean, fallback: false })
    .option('image', '-i 生成图片横幅', { type: Boolean, fallback: false })
    .option('text', '-t 输出文本信息', { type: Boolean, fallback: false })
    .option('clear', '-c 清除缓存', { type: Boolean, fallback: false })
    .action(async ({ session, options }, address) => {
      if (!address) return '使用格式: cs [地址:端口]\n示例: cs 127.0.0.1:27015\n示例: cs edgebug.cn'

      if (options.clear) {
        const count = cache.size
        cache.clear()
        return `已清除 ${count} 条缓存记录`
      }

      try {
        const { host, port } = parseAddress(address)
        const data = await queryServer(host, port)

        // 确定是否生成图片：命令行选项优先 > 配置
        const shouldGenerateImage = options.image || (config.generateImage && !options.text)

        if (shouldGenerateImage) {
          try {
            const imageBuffer = await generateServerImage(data, host, port)
            return h.image(imageBuffer, 'image/png')
          } catch (imageError) {
            console.error('生成图片失败:', imageError)
            return `生成图片失败: ${imageError.message}`
          }
        }

        let message = formatServerInfo(data)
        message += '\n\n' + formatPlayers(data.result.players || [])
        return message

      } catch (error: any) {
        let errorMessage = `查询失败: ${error.message}\n\n`

        if (error.message.includes('无法加载 gamedig')) {
          errorMessage += '请确保已安装 koishi-plugin-gamedig：\n'
          errorMessage += '1. 在插件市场搜索并安装 koishi-plugin-gamedig\n'
          errorMessage += '2. 启用该插件后重启'
        } else if (error.message.includes('无效的地址格式')) {
          errorMessage += '地址格式应为: 地址:端口\n'
          errorMessage += '示例: 127.0.0.1:27015 或 edgebug.cn:27015\n'
          errorMessage += '如果不指定端口，默认使用 27015'
        } else {
          errorMessage += '请检查：\n'
          errorMessage += '1. 服务器地址和端口是否正确\n'
          errorMessage += '2. 服务器是否已开启并允许查询\n'
          errorMessage += '3. 防火墙是否允许访问\n'
          errorMessage += '4. 服务器是否为CS服务器'
        }

        return errorMessage
      }
    })

  // 检查插件状态和配置
  ctx.command('cs.status', '检查插件状态和配置')
    .action(async () => {
      try {
        // 检查插件依赖
        const gamedigStatus = ctx.gamedig ? '✅ 可用' : '❌ 不可用'
        let canvasStatus = '❌ 不可用'

        if (ctx.canvas) {
          try {
            // 测试 canvas 插件
            const canvas = await ctx.canvas.createCanvas(1, 1)
            const ctx2d = canvas.getContext('2d')
            canvasStatus = '✅ 可用'
          } catch (error) {
            canvasStatus = `❌ 不可用: ${error.message}`
          }
        }

        const cacheSize = cache.size

        const scheduleStatus = config.scheduleEnabled ? '✅ 已启用' : '❌ 已禁用'
        const scheduleTimerStatus = scheduleTimer ? '运行中' : '未运行'

        // 检查QQ适配器
        const qqBots = ctx.bots.filter(bot => bot.platform === config.qqAdapterName)
        const qqStatus = qqBots.length > 0 ? `✅ 可用 (${qqBots.length}个)` : '❌ 不可用'

        return `✅ CS服务器查询插件状态\n` +
          `💾 缓存数量: ${cacheSize} 条\n` +
          `🕹️ Gamedig插件: ${gamedigStatus}\n` +
          `🖼️ Canvas插件: ${canvasStatus}\n` +
          `📅 定时任务: ${scheduleStatus} (${scheduleTimerStatus})\n` +
          `🤖 QQ适配器: ${qqStatus} (名称: ${config.qqAdapterName})\n` +
          `⚙️ 配置参数:\n` +
          `   超时时间: ${config.timeout}ms\n` +
          `   缓存时间: ${config.cacheTime}ms\n` +
          `   重试次数: ${config.retryCount}\n` +
          `   最大显示玩家数: ${config.maxPlayers}\n` +
          `   显示VAC状态: ${config.showVAC ? '是' : '否'}\n` +
          `   显示密码保护: ${config.showPassword ? '是' : '否'}\n` +
          `   生成图片横幅: ${config.generateImage ? '是' : '否'}\n` +
          `   图片最小高度: ${config.imageHeight}px\n` +
          `   字体大小: ${config.fontSize}px\n` +
          `   群组ID格式: ${config.useFullChannelId ? '适配器:群号' : '群号'}\n\n` +
          `📝 使用: cs [地址:端口]\n` +
          `📝 选项: -i 生成图片, -t 输出文本, -c 清除缓存\n` +
          `📅 定时任务: cs.schedule 查看定时任务管理`
      } catch (error: any) {
        return `❌ 插件状态异常: ${error.message}\n请确保已安装并启用 koishi-plugin-gamedig 和 koishi-plugin-canvas 插件`
      }
    })

  // 帮助命令
  ctx.command('cs.help', '查看帮助')
    .action(() => {
      return `🔫 CS服务器查询插件帮助\n\n` +
        `📝 基本用法:\n` +
        `cs [地址:端口]\n` +
        `示例: cs 127.0.0.1:27015\n` +
        `示例: cs edgebug.cn\n\n` +
        `🔧 选项:\n` +
        `-i 生成图片横幅\n` +
        `-t 输出文本信息\n` +
        `-c 清除缓存\n\n` +
        `🎯 快捷命令:\n` +
        `csss - 批量查询服务器状态\n` +
        `cs.schedule - 定时任务管理\n\n` +
        `📋 其他命令:\n` +
        `cs.status - 检查插件状态和配置\n` +
        `cs.help - 显示此帮助\n\n` +
        `📅 定时任务:\n` +
        `定时自动向指定QQ群组发送服务器状态\n` +
        `配置: 插件配置面板中设置\n` +
        `管理: cs.schedule 命令\n` +
        `群组ID格式: ${config.useFullChannelId ? '适配器:群号 (如: qq:123456)' : '群号 (如: 123456)'}\n\n` +
        `💡 提示:\n` +
        `1. 如果不指定端口，默认使用27015\n` +
        `2. 只支持CS服务器查询\n` +
        `3. 查询结果缓存${config.cacheTime}ms，使用 -c 清除缓存\n` +
        `4. 需要安装 koishi-plugin-gamedig 和 koishi-plugin-canvas 插件`
    })

  // 批量查询服务器状态
  ctx.command('csss', '批量查询服务器状态')
    .alias('batch')
    .alias('multi')
    .alias('批量查询')
    .option('list', '-l 显示配置的服务器列表', { type: Boolean, fallback: false })
    .option('add', '-a <address> 添加服务器到列表', { type: String })
    .option('remove', '-r <index> 从列表中移除服务器', { type: Number })
    .option('clear', '-c 清空服务器列表', { type: Boolean, fallback: false })
    .option('image', '-i 生成图片横幅', { type: Boolean, fallback: false })
    .option('text', '-t 输出文本信息', { type: Boolean, fallback: false })
    .action(async ({ session, options }, ...addresses) => {
      // 显示配置的服务器列表
      if (options.list) {
        let listMessage = '📋 配置的服务器列表:\n'
        config.serverList.forEach((server, index) => {
          listMessage += `${index + 1}. ${server}\n`
        })
        return listMessage
      }

      // 添加服务器到列表
      if (options.add) {
        try {
          parseAddress(options.add)
          config.serverList.push(options.add)
          return `✅ 已添加服务器: ${options.add}\n当前列表: ${config.serverList.length} 个服务器`
        } catch (error) {
          return `❌ 添加失败: ${error.message}\n正确格式: 地址:端口 (例如: 127.0.0.1:27015)`
        }
      }

      // 从列表中移除服务器
      if (options.remove !== undefined) {
        const index = options.remove - 1
        if (index >= 0 && index < config.serverList.length) {
          const removed = config.serverList.splice(index, 1)[0]
          return `✅ 已移除服务器: ${removed}\n当前列表: ${config.serverList.length} 个服务器`
        } else {
          return `❌ 索引无效，请输入 1-${config.serverList.length} 之间的数字`
        }
      }

      // 清空服务器列表
      if (options.clear) {
        const count = config.serverList.length
        config.serverList.length = 0
        return `✅ 已清空服务器列表，共移除 ${count} 个服务器`
      }

      // 确定要查询的服务器列表
      let serversToQuery: string[]
      if (addresses.length > 0) {
        serversToQuery = addresses
      } else if (config.serverList.length > 0) {
        serversToQuery = config.serverList
      } else {
        return '❌ 没有可查询的服务器\n请使用: csss -a <地址:端口> 添加服务器\n或使用: csss <地址1> <地址2> ... 临时查询'
      }

      // 限制最大查询数量
      const maxServers = 10
      if (serversToQuery.length > maxServers) {
        serversToQuery = serversToQuery.slice(0, maxServers)
        session?.send(`⚠️ 服务器数量超过限制，仅查询前 ${maxServers} 个`)
      }

      try {
        const { results, queryTime } = await queryServers(serversToQuery)

        // 确定是否生成图片：命令行选项优先 > 配置
        const shouldGenerateImage = options.image || (config.generateImage && !options.text)

        if (shouldGenerateImage) {
          try {
            const imageBuffer = await generateBatchImage(results, serversToQuery, queryTime)
            return h.image(imageBuffer, 'image/png')
          } catch (imageError) {
            console.error('生成批量查询图片失败:', imageError)
            // 生成图片失败时返回文本信息
          }
        }

        let message = generateTextTable(results, serversToQuery, queryTime, '批量查询结果')
        message += '\n📋 输入 `cs <序号>` 查看服务器详情'
        message += '\n📋 输入 `cs <服务器地址>` 查询单个服务器'

        return message

      } catch (error: any) {
        return `❌ 批量查询失败: ${error.message}`
      }
    })

  // 插件启动时初始化定时任务
  if (config.scheduleEnabled) {
    startScheduleTask()
  }

  // 插件卸载时清理资源
  ctx.on('dispose', () => {
    cache.clear()
    stopScheduleTask()
  })
}

export const inject = ['canvas', 'gamedig', 'database']