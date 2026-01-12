import { Context, Schema, h } from 'koishi'
import { createCanvas } from 'canvas'

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
    .default(true)  // 修改为默认true，默认输出图片
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
    .default('Microsoft YaHei, sans-serif')
    .description('字体家族'),

  serverList: Schema.array(Schema.string())
    .role('table')
    .description('批量查询服务器列表（格式: 地址:端口，每行一个）')
    .default([
      'edgebug.cn:27015',
      'edgebug.cn:27016',
      'edgebug.cn:27017',
      'edgebug.cn:27018',      
    ]),

  batchTimeout: Schema.number()
    .min(1000)
    .max(60000)
    .default(15000)
    .description('批量查询总超时时间(毫秒)'),

  // 新增定时任务配置
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
})

interface CacheEntry {
  timestamp: number
  data: any
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
    if (ping < 50) return '#4CAF50'
    if (ping < 100) return '#FFC107'
    if (ping < 200) return '#FF9800'
    return '#c03f36'
  },

  getPlayerColor(count: number): string {
    return count > 0 ? '#4CAF50' : '#c03f36'
  },
  
  // 新增：格式化时间
  formatTime(ms: number): string {
    if (ms < 1000) return `${ms}ms`
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}秒`
    return `${(ms / 1000).toFixed(0)}秒`
  },

  // 新增：解析时间字符串为分钟数
  parseTimeToMinutes(timeStr: string): number {
    const [hours, minutes] = timeStr.split(':').map(Number)
    return hours * 60 + minutes
  },

  // 新增：检查当前时间是否在定时任务时间范围内
  isWithinScheduleTime(startTime: string, endTime: string): boolean {
    const now = new Date()
    const currentMinutes = now.getHours() * 60 + now.getMinutes()
    const startMinutes = this.parseTimeToMinutes(startTime)
    const endMinutes = this.parseTimeToMinutes(endTime)
    
    return currentMinutes >= startMinutes && currentMinutes <= endMinutes
  },
}

export function apply(ctx: Context, config: Config) {
  const cache = new Map<string, CacheEntry>()
  let scheduleTimer: NodeJS.Timeout = null

  // 定时任务执行函数
  async function executeScheduleTask() {
    if (!config.scheduleEnabled || config.scheduleGroups.length === 0 || config.serverList.length === 0) {
      return
    }

    // 检查是否在时间范围内
    if (!utils.isWithinScheduleTime(config.scheduleStartTime, config.scheduleEndTime)) {
      return
    }

    try {
      const startTime = Date.now()
      const results = await Promise.allSettled(
        config.serverList.map(async (server, index) => {
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
      const now = new Date()
      const timeStr = now.toLocaleString('zh-CN')

      // 生成输出内容
      let outputContent: string | h

      if (config.scheduleUseImage) {
        // 生成图片
        try {
          const imageBuffer = await generateBatchImage(results, config.serverList, queryTime)
          outputContent = h.image(imageBuffer, 'image/png')
        } catch (imageError) {
          console.error('定时任务生成图片失败:', imageError)
          outputContent = `🕒 ${timeStr} 服务器状态更新\n生成图片失败，使用文本格式：\n\n`
        }
      }

      // 如果图片生成失败或配置为文本格式，生成文本
      if (typeof outputContent === 'string' || !config.scheduleUseImage) {
        const successful = results.filter(r => r.status === 'fulfilled' && r.value.success).length
        const failed = results.length - successful
        
        let textMessage = `🕒 ${timeStr} 服务器状态更新 (耗时: ${utils.formatTime(queryTime)})\n`
        textMessage += `✅ 成功: ${successful} 个 | ❌ 失败: ${failed} 个\n\n`

        // 表格标题
        textMessage += '序号 服务器名称    在线人数\n'
        textMessage += '──────────────────────────────\n'

        results.forEach((result, index) => {
          const serverInfo = config.serverList[index]
          if (result.status === 'fulfilled') {
            const { success, data, error } = result.value

            if (success && data) {
              const { result: serverData } = data
              const serverName = serverData.name ? utils.cleanName(serverData.name) : '未知'
              const playerCount = serverData.players?.length || 0
              const maxPlayers = serverData.maxplayers || 0

              // 截断服务器名称，保持表格对齐
              const truncatedName = utils.truncateText(serverName, 20)
              const paddedName = truncatedName.padEnd(20, ' ')

              textMessage += `${(index + 1).toString().padStart(2, ' ')}  ${paddedName} ${playerCount}/${maxPlayers}\n`
            } else {
              textMessage += `${(index + 1).toString().padStart(2, ' ')}  ${serverInfo} ❌ 查询失败: ${error}\n`
            }
          } else {
            textMessage += `${(index + 1).toString().padStart(2, ' ')}  ${serverInfo} ❌ 查询失败\n`
          }
        })

        outputContent = typeof outputContent === 'string' ? outputContent + textMessage : textMessage
      }

      // 向配置的群组发送消息
      for (const groupId of config.scheduleGroups) {
        try {
          // 使用 ctx.broadcast 向指定群组发送消息
          // 注意：这里的 groupId 应该是 QQ 群号（字符串形式）
          await ctx.broadcast([`onebot:${groupId}`], outputContent)
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
      const intervalMs = config.scheduleInterval * 60 * 1000 // 转换为毫秒
      
      // 立即执行一次
      executeScheduleTask()
      
      // 设置定时器
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

  async function loadGamedig() {
    try {
      const gamedigModule = await import('gamedig')
      return gamedigModule.default || gamedigModule.GameDig || gamedigModule
    } catch (error) {
      throw new Error(`无法加载 gamedig 模块：${error.message}\n请确保已安装 gamedig：npm install gamedig`)
    }
  }

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

    const Gamedig = await loadGamedig()
    let lastError: Error

    for (let i = 0; i <= config.retryCount; i++) {
      try {
        const result = await Gamedig.query({
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
      let fontSize = baseFontSize * 1.5

      while (fontSize > baseFontSize * 0.8) {
        ctx.font = `bold ${fontSize}px ${config.fontFamily}`
        if (ctx.measureText(name).width <= maxWidth) break
        fontSize -= 1
      }

      return fontSize
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

    drawBackground(ctx: any, width: number, height: number) {
      const gradient = ctx.createLinearGradient(0, 0, width, height)
      gradient.addColorStop(0, '#1a1a2e')
      gradient.addColorStop(1, '#16213e')
      ctx.fillStyle = gradient
      ctx.fillRect(0, 0, width, height)
    },

    drawTitle(ctx: any, text: string, x: number, y: number, fontSize: number, fontFamily: string, color = '#ffffff') {
      ctx.fillStyle = color
      ctx.font = `bold ${fontSize}px ${fontFamily}`
      ctx.textAlign = 'center'
      ctx.fillText(text, x, y)
    },

    drawDivider(ctx: any, x1: number, y1: number, x2: number, y2: number, color: string, width = 2) {
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
        color = '#cccccc',
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
        this.drawText(ctx, '服务器当前无在线玩家', 80, y, { italic: true, color: '#aaaaaa' })
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
            color: '#dddddd'
          })
          currentY += params.rowHeight
          displayedCount++
        })

        currentY = y
        rightPlayers.forEach(player => {
          const name = utils.truncateText(utils.cleanName(player.name), params.nameMaxLength)
          this.drawText(ctx, name, rightColumnX, currentY, {
            fontSize: config.fontSize * params.fontSizeMultiplier,
            color: '#dddddd'
          })
          currentY += params.rowHeight
          displayedCount++
        })

        y = Math.max(currentY + 15, y)

        const totalDisplayed = leftPlayers.length + rightPlayers.length
        if (players.length > totalDisplayed) {
          this.drawText(ctx, `... 还有 ${players.length - totalDisplayed} 位玩家未显示`, leftColumnX, y, {
            fontSize: config.fontSize * 0.8,
            color: '#aaaaaa',
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
            color: '#dddddd'
          })
          y += params.rowHeight
        })

        return { y, displayedCount: displayPlayers.length }
      }
    },
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

    const canvas = createCanvas(width, height)
    const ctx = canvas.getContext('2d')

    imageUtils.drawBackground(ctx, width, height)

    const titleY = 80
    imageUtils.drawTitle(ctx, '服务器状态', width / 2, titleY, config.fontSize * 2.0, config.fontFamily)

    if (result.name) {
      const cleanName = utils.cleanName(result.name)
      const fontSize = imageUtils.calculateServerNameFontSize(ctx, cleanName, width - 160, config.fontSize)
      imageUtils.drawTitle(ctx, cleanName, width / 2, titleY + 50, fontSize, config.fontFamily, '#FFD700')
    }

    imageUtils.drawDivider(ctx, 80, titleY + 80, width - 80, titleY + 80, '#FFD700', 3)

    let y = titleY + 120

    if (result.map) {
      imageUtils.drawText(ctx, `地图: ${result.map}`, 80, y)
    }
    imageUtils.drawText(ctx, `IP: ${host}:${port}`, width - 80, y, { align: 'right', color: '#bbbbbb' })

    y += 40

    const playerCount = result.players?.length || 0
    const botCount = result.bots?.length || 0
    const maxPlayers = result.maxplayers || 0
    const playerText = `人数: ${playerCount}/${maxPlayers}${botCount > 0 ? ` (${botCount} Bot)` : ''}`
    imageUtils.drawText(ctx, playerText, 80, y, { color: utils.getPlayerColor(playerCount) })

    if (result.ping) {
      imageUtils.drawText(ctx, `Ping: ${result.ping}ms`, width - 80, y, {
        align: 'right',
        color: utils.getPingColor(result.ping)
      })
    }

    y += 50

    const playerParams = imageUtils.calculatePlayerListParams(playerCount)

    imageUtils.drawText(ctx, '在线玩家', 80, y, { color: '#ffffff', bold: true, fontSize: config.fontSize * 1.2 })
    y += 40

    imageUtils.drawDivider(ctx, 80, y - 15, width - 80, y - 15, '#555555', 1.5)

    y += 25
    const playerListResult = imageUtils.drawPlayerList(ctx, result.players || [], y, width, height, playerParams)
    y = playerListResult.y

    y += 30

    const now = new Date()
    imageUtils.drawText(ctx, `查询时间: ${now.toLocaleString('zh-CN')}`, 80, height - 20, {
      fontSize: config.fontSize * 0.8,
      color: '#666666'
    })

    imageUtils.drawDivider(ctx, 8, 8, width - 8, 8, '#7D8B92', 4)
    imageUtils.drawDivider(ctx, width - 8, 8, width - 8, height - 8, '#7D8B92', 4)
    imageUtils.drawDivider(ctx, width - 8, height - 8, 8, height - 8, '#7D8B92', 4)
    imageUtils.drawDivider(ctx, 8, height - 8, 8, 8, '#7D8B92', 4)

    return canvas.toBuffer('image/png')
  }

  // 生成批量查询图片
  async function generateBatchImage(results: any[], serversToQuery: string[], queryTime: number): Promise<Buffer> {
    const successful = results.filter(r => r.status === 'fulfilled' && r.value.success).length
    const failed = results.length - successful
    
    // 计算图片高度
    const baseHeight = 200
    const serverHeight = 100
    const height = baseHeight + (results.length * serverHeight)
    const width = 1200
    
    const canvas = createCanvas(width, height)
    const ctx = canvas.getContext('2d')
    
    // 绘制背景
    imageUtils.drawBackground(ctx, width, height)
    
    // 绘制标题
    imageUtils.drawTitle(ctx, '服务器状态批量查询', width / 2, 100, config.fontSize * 2.0, config.fontFamily)
    
    // 绘制统计信息
    const now = new Date()
    imageUtils.drawText(ctx, `查询时间: ${now.toLocaleString('zh-CN')}`, 80, 150)
    imageUtils.drawText(ctx, `耗时: ${utils.formatTime(queryTime)}  成功: ${successful}/${results.length}`, width - 80, 150, { align: 'right' })
    
    // 绘制分隔线
    imageUtils.drawDivider(ctx, 80, 165, width - 80, 165, '#FFD700', 3)
    
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
          const botCount = serverData.bots?.length || 0
          
          // 服务器序号和名称
          imageUtils.drawText(ctx, `${index + 1}. ${serverName}`, 80, y, { 
            color: '#ffffff', 
            bold: true,
            fontSize: config.fontSize * 1.1
          })
          
          // 服务器地址
          imageUtils.drawText(ctx, server, 80, y + 30, {
            fontSize: config.fontSize * 0.8,
            color: '#aaaaaa'
          })
          
          // 玩家数量
          const playerText = `${playerCount}/${maxPlayers}`
          const playerColor = playerCount > 0 ? '#4CAF50' : '#c03f36'
          imageUtils.drawText(ctx, playerText, width - 80, y, { 
            align: 'right', 
            color: playerColor,
            bold: true
          })
          
          // 地图和延迟
          if (serverData.map) {
            imageUtils.drawText(ctx, `地图: ${serverData.map}`, 80, y + 60, { 
              fontSize: config.fontSize * 0.8,
              color: '#aaaaaa'
            })
          }
          
          if (serverData.ping) {
            const pingColor = utils.getPingColor(serverData.ping)
            imageUtils.drawText(ctx, `延迟: ${serverData.ping}ms`, width - 80, y + 60, { 
              align: 'right',
              fontSize: config.fontSize * 0.9,
              color: pingColor
            })
          }
          
        } else {
          // 查询失败的信息
          imageUtils.drawText(ctx, `${index + 1}. ${server}`, 80, y, { color: '#ffffff', bold: true })
          imageUtils.drawText(ctx, `❌ 查询失败: ${error}`, 200, y + 35, { color: '#c03f36' })
        }
      } else {
        // Promise rejected
        imageUtils.drawText(ctx, `${index + 1}. ${server}`, 80, y, { color: '#ffffff', bold: true })
        imageUtils.drawText(ctx, '❌ 查询失败', 200, y + 35, { color: '#c03f36' })
      }
      
      // 绘制分隔线
      if (index < results.length - 1) {
        imageUtils.drawDivider(ctx, 80, y + 70, width - 80, y + 70, '#555555', 1)
      }
      y += 100
    })
    
    // 绘制边框
    imageUtils.drawDivider(ctx, 8, 8, width - 8, 8, '#7D8B92', 4)
    imageUtils.drawDivider(ctx, width - 8, 8, width - 8, height - 8, '#7D8B92', 4)
    imageUtils.drawDivider(ctx, width - 8, height - 8, 8, height - 8, '#7D8B92', 4)
    imageUtils.drawDivider(ctx, 8, height - 8, 8, 8, '#7D8B92', 4)
    
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
    .action(async ({ session, options }) => {
      if (options.status) {
        const status = config.scheduleEnabled ? '✅ 已启用' : '❌ 已禁用'
        const nextRun = scheduleTimer ? '运行中' : '未运行'
        const groups = config.scheduleGroups.length
        
        return `📅 定时任务状态\n` +
               `状态: ${status}\n` +
               `定时器: ${nextRun}\n` +
               `间隔: ${config.scheduleInterval}分钟\n` +
               `时间范围: ${config.scheduleStartTime} - ${config.scheduleEndTime}\n` +
               `输出格式: ${config.scheduleUseImage ? '图片' : '文本'}\n` +
               `监控服务器: ${config.serverList.length}个\n` +
               `目标群组: ${groups}个\n\n` +
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

      if (options.addGroup) {
        if (!config.scheduleGroups.includes(options.addGroup)) {
          config.scheduleGroups.push(options.addGroup)
          return `✅ 已添加群组 ${options.addGroup} 到定时任务`
        } else {
          return `❌ 群组 ${options.addGroup} 已在列表中`
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
             `-a, -addGroup    添加群组到定时任务\n` +
             `-r, -removeGroup 从定时任务移除群组\n` +
             `-l, -listGroups  列出定时任务群组\n\n` +
             `示例:\n` +
             `cs.schedule -s          # 查看状态\n` +
             `cs.schedule -S          # 启动定时任务\n` +
             `cs.schedule -a 123456   # 添加群组123456\n` +
             `cs.schedule -t          # 测试执行`
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
            return `生成图片失败: ${imageError.message}\n将返回文本信息。`
          }
        }
        
        let message = formatServerInfo(data)
        message += '\n\n' + formatPlayers(data.result.players || [])
        return message

      } catch (error: any) {
        let errorMessage = `查询失败: ${error.message}\n\n`

        if (error.message.includes('无法加载 gamedig')) {
          errorMessage += '请确保已安装 gamedig：\n'
          errorMessage += '1. 在插件目录运行：npm install gamedig\n'
          errorMessage += '2. 重启 Koishi'
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
        await loadGamedig()
        const cacheSize = cache.size

        let canvasStatus = '❌ 不可用'
        try {
          createCanvas(1, 1)
          canvasStatus = '✅ 可用'
        } catch (error) {
          canvasStatus = `❌ 不可用: ${error.message}`
        }

        const scheduleStatus = config.scheduleEnabled ? '✅ 已启用' : '❌ 已禁用'
        const scheduleTimerStatus = scheduleTimer ? '运行中' : '未运行'

        return `✅ CS服务器查询插件状态\n` +
          `💾 缓存数量: ${cacheSize} 条\n` +
          `🖼️ 图片生成: ${canvasStatus}\n` +
          `📅 定时任务: ${scheduleStatus} (${scheduleTimerStatus})\n` +
          `⚙️ 配置参数:\n` +
          `   超时时间: ${config.timeout}ms\n` +
          `   缓存时间: ${config.cacheTime}ms\n` +
          `   重试次数: ${config.retryCount}\n` +
          `   最大显示玩家数: ${config.maxPlayers}\n` +
          `   显示VAC状态: ${config.showVAC ? '是' : '否'}\n` +
          `   显示密码保护: ${config.showPassword ? '是' : '否'}\n` +
          `   生成图片横幅: ${config.generateImage ? '是' : '否'}\n` +
          `   图片宽度: ${config.imageWidth}px\n` +
          `   图片最小高度: ${config.imageHeight}px\n` +
          `   字体大小: ${config.fontSize}px\n\n` +
          `📝 使用: cs [地址:端口]\n` +
          `📝 选项: -i 生成图片, -t 输出文本, -c 清除缓存\n` +
          `📅 定时任务: cs.schedule 查看定时任务管理`
      } catch (error: any) {
        return `❌ 插件状态异常: ${error.message}\n请运行: npm install gamedig`
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
        `群组ID: 填写QQ群号即可\n\n` +
        `💡 提示:\n` +
        `1. 如果不指定端口，默认使用27015\n` +
        `2. 只支持CS服务器查询\n` +
        `3. 查询结果缓存${config.cacheTime}ms，使用 -c 清除缓存`
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
          parseAddress(options.add) // 验证地址格式
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
        // 使用命令行参数指定的服务器
        serversToQuery = addresses
      } else if (config.serverList.length > 0) {
        // 使用配置的服务器列表
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

        // 统计成功和失败的数量
        const successful = results.filter(r => r.status === 'fulfilled' && r.value.success).length
        const failed = serversToQuery.length - successful

        let message = `📊 批量查询结果 (${utils.formatTime(queryTime)})\n`
        message += `✅ 成功: ${successful} 个 | ❌ 失败: ${failed} 个\n\n`

        // 表格标题
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

              // 截断服务器名称，保持表格对齐
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

        // 添加详细信息选项
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