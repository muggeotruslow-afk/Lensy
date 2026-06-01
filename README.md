# OCR 翻译

> 框选屏幕任意区域 → 自动 OCR → AI 翻译 → 点词查释义 + 收藏到生词本

按一个热键框选屏幕任何文字，立即识别 + 翻译，每个词都能点击查询音标、释义、词根、例句、近义词，并一键收藏到生词本，导出 Anki 卡片系统复习。

**适用场景**：看英文视频/动画字幕、读英文 PDF、浏览国外网页、阅读截图英文文档时遇到不认识的单词或想快速翻译整段。

![主界面](docs/screenshot-main.png)

---

## ✨ 特性

| 功能 | 说明 |
|------|------|
| 🎯 **全局热键框选** | `Alt+Shift+T` 唤起，截图冻结后框选，避开视频黑屏问题 |
| 🌐 **AI 翻译** | 接 DeepSeek API（性价比极高，新用户免费额度），自动翻译框选内容 |
| 📖 **逐词查询** | 点任意单词 → 音标、词性、中英文释义、例句、近义词、词根词缀、词频标签（CET4/CET6/GRE…） |
| 🔊 **发音** | 浏览器原生 TTS，离线可用 |
| ⭐ **生词本** | 收藏单词，本地 JSON 存储，可一键导出 Anki CSV 系统复习 |
| 📋 **剪贴板翻译模式** | 复制文字后按热键，弹出翻译窗口，无需截图 |
| 🎨 **多 OCR 引擎可切换** | Tesseract.js / Umi-OCR / Windows 系统 OCR |
| 🪟 **系统托盘常驻** | 关闭主窗口不退出，热键随时唤起 |
| 🛠 **手动修正** | OCR 识别错了？翻译面板顶部直接改原文，点「重新翻译」 |
| 💾 **缓存 + 本地优先** | 同一个单词 1 小时内不重复请求 LLM，离线情况下生词本依然可读 |

![词义弹窗](docs/screenshot-word.png) ![生词本](docs/screenshot-vocab.png)

---

## 📦 安装（从源码运行）

> 暂未提供 .exe 安装包，v0.2 通过 CI 发布。当前从源码运行：

### 前置要求

| 软件 | 版本 | 必需性 |
|------|------|--------|
| [Node.js](https://nodejs.org) | 18+ | 必需 |
| [Git](https://git-scm.com) | 任意 | 必需 |
| [Umi-OCR](https://github.com/hiroi-sora/Umi-OCR/releases) | 任意 | 可选（强烈推荐，准确度大幅提升） |
| [Anki](https://apps.ankiweb.net) | 任意 | 可选（如果你用 Anki 复习单词） |

### 步骤

```bash
# 1. 克隆项目
git clone https://github.com/muggeotruslow-afk/ocr-translator.git
cd ocr-translator

# 2. 国内用户先配镜像（可跳过，但 electron 下载会很慢）
echo electron_mirror=https://npmmirror.com/mirrors/electron/ > .npmrc

# 3. 安装依赖
npm install

# 4. 下载 OCR 训练数据（约 23MB）
# Windows PowerShell:
mkdir assets\tessdata -Force
Invoke-WebRequest "https://github.com/tesseract-ocr/tessdata/raw/main/eng.traineddata" -OutFile "assets\tessdata\eng.traineddata"

# macOS / Linux:
# mkdir -p assets/tessdata
# curl -L https://github.com/tesseract-ocr/tessdata/raw/main/eng.traineddata -o assets/tessdata/eng.traineddata

# 5. 启动
npm start
```

启动后会在系统托盘出现一个**橙色小方块图标**。Windows 11 默认会把新托盘图标藏在「∧」溢出菜单里，建议拖出来固定显示。

---

## ⚙ 首次使用：3 步配置

### 第 1 步：注册 DeepSeek 拿 API Key

1. 打开 [platform.deepseek.com](https://platform.deepseek.com) 注册账号
2. 进入 **API Keys** → **Create new API key**
3. 复制 `sk-` 开头的字符串保存好（页面关掉看不到第二次）

> **为什么不用免费的？** DeepSeek 充值 10 元够用几个月，比 OpenAI 便宜 95%，中文翻译质量好。新账号有免费试用额度。

### 第 2 步：在工具里填 API Key

1. 右键系统托盘的橙色图标 → **设置**
2. **DeepSeek API Key** 粘贴你的 key
3. 点 **测试连接**，看到 ✓ 即成功
4. **保存**

### 第 3 步（可选但强推）：装 Umi-OCR 提升识别准确度

Tesseract 对漫画字幕、艺术字识别一般。Umi-OCR（基于 PaddleOCR）准确度逼近百度云 OCR：

1. 下载 [Umi-OCR Paddle 版](https://github.com/hiroi-sora/Umi-OCR/releases)（约 128MB，选 `Umi-OCR_Paddle_xxx.7z.exe`）
2. 双击自解压到任意目录
3. 启动 Umi-OCR.exe → 左下角齿轮 → **全局设置** → **HTTP/命令行** → **启用 HTTP 服务**（默认端口 1224）
4. 回我们的工具：托盘 → 设置 → **OCR 引擎**选 **Umi-OCR** → **测试连接** → **保存**

之后保持 Umi-OCR 在后台运行即可。

---

## 🎹 日常使用

| 操作 | 方式 |
|------|------|
| **框选翻译** | `Alt+Shift+T` → 鼠标拖框选 → 自动 OCR + 翻译 |
| **点词查释义** | 在结果窗口下方的词条上点击 |
| **收藏单词** | 词义弹窗右上角 ☆ |
| **朗读单词** | 词义弹窗的 🔊 |
| **剪贴板翻译** | Ctrl+C 复制文字 → `Alt+Shift+D`（需在设置启用） |
| **取消框选** | `Esc` |
| **打开生词本** | 托盘右键 / 结果窗口右上角 📖 |
| **打开设置** | 托盘右键 / 结果窗口右上角 ⚙ |
| **导出 Anki** | 生词本 → **导出 Anki CSV** → 在 Anki 中「文件 → 导入」 |
| **退出程序** | 托盘右键 → 退出 |

### 开机自启（可选）

把 `autorun.vbs` 的快捷方式放进 Windows Startup 文件夹：

```powershell
$startup = [Environment]::GetFolderPath('Startup')
$src = "$PWD\autorun.vbs"
$ws = New-Object -ComObject WScript.Shell
$sc = $ws.CreateShortcut("$startup\OCR-Translator.lnk")
$sc.TargetPath = "wscript.exe"
$sc.Arguments = "`"$src`""
$sc.WorkingDirectory = $PWD
$sc.Save()
```

下次开机自动后台运行。

---

## ❓ FAQ

**Q: 按热键没反应？**
- A: 检查托盘图标是否在（可能被 Windows 11 藏在「∧」里），托盘没图标说明程序没启动 → 双击桌面快捷方式
- A: 单实例锁机制，如果你按了多次启动，只有第一个生效

**Q: OCR 识别结果很烂怎么办？**
- A: 切换 OCR 引擎到 Umi-OCR（第 3 步），效果远好于本地 Tesseract
- A: 识别错了可以直接在结果窗口顶部的「原文（可编辑）」框里改正，点「重新翻译」

**Q: 翻译/查词不工作？**
- A: 设置面板填了 DeepSeek API Key 吗？点「测试连接」确认
- A: 账号余额不足时会失败，去 [platform.deepseek.com](https://platform.deepseek.com) 充值

**Q: 框选时屏幕黑了一下，B 站视频也黑屏？**
- A: 我们用「冻结截屏」方式避开了这个问题。如果还有黑屏，确认 main.js 顶部有 `app.disableHardwareAcceleration()`

**Q: API Key 安全吗？**
- A: 存储在本地 `%APPDATA%\ocr-translator\config.json`，不上传任何服务器
- A: `.gitignore` 已排除该文件，不会误传到 GitHub

**Q: Anki CSV 怎么导入？**
- A: 打开 Anki → File → Import → 选 CSV → 字段分隔符选「Comma」→ 编码 UTF-8 → 确认

---

## 🛠 技术栈

- **Electron** + Node.js — 跨平台桌面框架
- **Tesseract.js** / Umi-OCR (PaddleOCR) / Windows.Media.Ocr — 三引擎可切换
- **DeepSeek Chat API**（OpenAI 兼容） — LLM 翻译 + 词义
- **Jimp** — 图像预处理（灰度、二值化、上采样）

---

## 📝 路线图

- [ ] 划词翻译模式（鼠标选中即翻，不用截图）
- [ ] 多显示器适配（鼠标所在屏触发）
- [ ] 自定义翻译 Prompt（专业领域风格）
- [ ] 历史记录持久化 + 时间线
- [ ] electron-builder CI 自动发 exe
- [ ] 自动更新（electron-updater）
- [ ] macOS / Linux 支持
- [ ] 图标 + 启动画面美化

---

## 🤝 致谢

- [Umi-OCR](https://github.com/hiroi-sora/Umi-OCR) — 神级开源 OCR 工具
- [Tesseract.js](https://github.com/naptha/tesseract.js) — 浏览器/Node OCR
- [DeepSeek](https://www.deepseek.com) — 高性价比中文友好 LLM
- 设计灵感：Claude 的暖色 UI 风格

---

## 📄 License

[MIT](LICENSE)
