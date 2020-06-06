
const xmlParse = require('./xml-parser')
const {Widget} = require('./widget')
const {Draw} = require('./draw')
const {compareVersion} = require('./utils')

const canvasId = 'weui-canvas'

Component({
  properties: {
    width: {
      type: Number,
      value: 400
    },
    height: {
      type: Number,
      value: 300
    }
  },
  data: {
    use2dCanvas: false, // 2.9.2 后可用canvas 2d 接口
  },
  lifetimes: {
    attached() {
      const {SDKVersion, pixelRatio: dpr} = wx.getSystemInfoSync()
      const use2dCanvas = compareVersion(SDKVersion, '2.9.2') >= 0
      this.dpr = dpr
      this.setData({use2dCanvas}, async () => {
        await this.getCanvasInfo(use2dCanvas, canvasId)
        this.triggerEvent('canvasReady', {}, {}) // canvas初始化完成的回调，可以开始绘制
      })
    }
  },
  methods: {
    // 获取canvas context等信息
    getCanvasInfo(use2dCanvas, canvasId) {
      return new Promise((resolve) => {
        if (use2dCanvas) {
          const dpr = this.dpr
          const query = this.createSelectorQuery()
          query.select(`#${canvasId}`)
              .fields({node: true, size: true})
              .exec(res => {
                const canvas = res[0].node
                const ctx = canvas.getContext('2d')
                canvas.width = res[0].width * dpr
                canvas.height = res[0].height * dpr
                ctx.scale(dpr, dpr)
                this.ctx = ctx
                this.canvas = canvas
                console.log('exec')
                resolve()
              })
        } else {
          this.ctx = wx.createCanvasContext(canvasId, this)
          resolve()
        }
      })
    },
    // 寻找text叶子节点
    findText(element, style) {
      const { name } = element
      if (name === 'text') {
        this.resetTextStyle(element, style)
      } else {
        const childs = Object.values(element.children)
        for (const child of childs) {
          this.findText(child, style)
        }
      }
    },

    getClassName(ele) {
      if(!ele.attributes || !ele.attributes.class) {
        console.log('getClassName error')
        return ''
      } else {
        return ele.attributes.class
      }
    },

    resetParentStyle(element, style) {
      if (!element.style.width) {
        return false
      }
      // console.log('parent: ', element.style)
      let parentStyle = element.style
      const childs = Object.values(element.children)
      let countWidth = 0 // 计算子元素的宽度
      childs.forEach(ele => {
        countWidth += style[this.getClassName(ele)].width
      })
      if (countWidth > parentStyle.width) { // 子元素宽度超过父元素，1.扩增父元素（有maxWidth），2.寻找兄弟元素中可以被压缩（有minWidth属性）的，进行压缩
        if (typeof parentStyle.maxWidth !== 'undefined') {
          style[this.getClassName(element)].width = Math.ceil(parentStyle.maxWidth)
          this.resetParentStyle(element.parent, style)
        } else {
          childs.forEach(ele => {
            const childClassName = this.getClassName(ele)
            if (ele.style.minWidth) { // 缩减兄弟元素宽度
              style[childClassName].width = Math.ceil(ele.style.minWidth)
              typeof ele.style.maxHeight !== 'undefined' ? style[childClassName].height = ele.style.maxHeight: ''
            }
          })
        }
      }
    },

    resetTextStyle(element, style) {
      let _this = this
      const getStyle = function(style, ele) {
        const className = _this.getClassName(ele)
        const textStyle = style[className]
        return textStyle
      }

      const textCtx = wx.createCanvasContext('measure-text')
      const elementStyle = getStyle(style, element)
      const elementClassName = this.getClassName(element)
      textCtx.draw(false)
      const font = `normal normal ${elementStyle.fontWeight || 400} normal ${elementStyle.fontSize}px / ${elementStyle.lineHeight || elementStyle.height}px "PingFang SC"`
      textCtx.font = font
      const metrics = textCtx.measureText(element.attributes.text)

      const canvasMeasureWidth = metrics.width
      if (canvasMeasureWidth > elementStyle.width) { // canvas 测量结果比给定的宽度值大
        // console.log(child)
        let width = canvasMeasureWidth
        if(typeof elementStyle.maxWidth !== 'undefined' && canvasMeasureWidth > elementStyle.maxWidth) {
          width = elementStyle.maxWidth
        }
        style[elementClassName].width = Math.ceil(width)
        // console.log(element.attributes.text + ' 增宽 width: ' + width)
        this.resetParentStyle(element.parent, style)
      } else if(canvasMeasureWidth < elementStyle.width) {
        let width = canvasMeasureWidth
        if (typeof elementStyle.minWidth !== 'undefined' && canvasMeasureWidth < elementStyle.minWidth) {
          width = elementStyle.minWidth
        }
        style[elementClassName].width = Math.ceil(width)
        // console.log(element.attributes.text + ' 缩减 width: ' + width)
      }
    },

    async renderToCanvas(args) {
      const data = await this.initCanvas(args)
      const { draw, container, ctx } = data
      await draw.drawNode(container)

      if (!this.data.use2dCanvas) {
        this.canvasDraw(ctx)
      }
      return Promise.resolve(container)
    },

    async drawToCanvas(args) {
      let data = await this.initCanvas(args)
      const { draw, container, ctx } = data
      const handler = await draw.drawNode(container)

      if (!this.data.use2dCanvas) {
        return this.canvasDraw(ctx)
      } else {
        return handler
      }
    },

    async initCanvas(args) {
      const {wxml, style} = args
      const ctx = this.ctx
      const canvas = this.canvas
      const use2dCanvas = this.data.use2dCanvas

      if (use2dCanvas && !canvas) {
        return Promise.reject(new Error('renderToCanvas: fail canvas has not been created'))
      }

      ctx.clearRect(0, 0, this.data.width, this.data.height)
      const {root: xom} = xmlParse(wxml)
      // console.log(xom)
      let widget = new Widget(xom, style)
      // console.log(widget)
      let container = widget.init()
      this.findText(widget.container, style)
      // style更新后重新初始化
      widget = new Widget(xom, style)
      container = widget.init()
      this.boundary = {
        top: container.layoutBox.top,
        left: container.layoutBox.left,
        width: container.computedStyle.width,
        height: container.computedStyle.height,
      }
      const draw = new Draw(ctx, canvas, use2dCanvas)
      return Promise.resolve({ draw, ctx, container })
    },

    // 低版本绘制方法
    canvasDraw(ctx, reserve) {
      return new Promise(resolve => {
        ctx.draw(reserve, () => {
          resolve()
        })
      })
    },

    // wxml=>canvas=>Img
    async wxmlToCanvasToImg(args) {
      await  this.drawToCanvas(args)
      return await this.canvasToTempFilePath()
    },

    canvasToTempFilePath(args = {}) {
      const use2dCanvas = this.data.use2dCanvas

      return new Promise((resolve, reject) => {
        const {
          top, left, width, height
        } = this.boundary

        const copyArgs = {
          x: left,
          y: top,
          width,
          height,
          destWidth: width * this.dpr,
          destHeight: height * this.dpr,
          canvasId,
          fileType: args.fileType || 'png',
          quality: args.quality || 1,
          success: res => {
            res.container = {
              layoutBox: this.boundary
            }
            resolve(res)
          },
          fail: reject
        }

        if (use2dCanvas) {
          delete copyArgs.canvasId
          copyArgs.canvas = this.canvas
        }
        wx.canvasToTempFilePath(copyArgs, this)
      })
    }
  }
})
