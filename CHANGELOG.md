# Changelog

## v0.2.0 — Secure Runtime & Managed Umi-OCR

### Changes

- 所有渲染窗口启用 `contextIsolation` 与沙箱，关闭 Node.js 集成
- 新增 preload 白名单接口和 Content Security Policy
- 设置写入改为字段白名单，Umi 服务仅允许本机环回地址
- 自动发现、一键启动并检测 Umi-OCR，可随 Lensy 自动拉起
- 新增小高度框选自动扩边和热键注册失败提示
- 增加安全结构、Umi 管理和框选逻辑回归测试

## v0.1.1 — Branding (Lensy)

### Changes

- 🎨 项目正式更名 **OCR 翻译 → Lensy**
- 🖼 加入官方 Logo / 图标（橙色 [A] + 放大镜）
- 🪟 所有窗口标题统一带 "Lensy" 前缀
- 🔔 系统托盘图标改用真 PNG（取代之前的像素方块）
- 📦 `package.json` 加 `productName`、`build.win.icon`、关键词
- 💾 自动迁移：v0.1.0 旧 `%APPDATA%\ocr-translator\` 数据自动迁移到新 `%APPDATA%\Lensy\`
- 📝 README 加 Lensy logo header、徽章、和有道词典的差异化对比段落

## v0.1.0 — Initial Release

### Features

- 全局热键框选截图翻译（Alt+Shift+T）
- 三种 OCR 引擎可切换：Tesseract.js / Umi-OCR / Windows OCR
- DeepSeek API 自动翻译
- 单词点击查询：音标、词性、释义、例句、近义词、词根、词频
- 浏览器原生 TTS 发音
- 生词本 + Anki CSV 导出
- 剪贴板翻译模式（Alt+Shift+D）
- 系统托盘常驻
- 设置面板（API Key、热键、引擎切换）
- Claude 风格暖色 UI
