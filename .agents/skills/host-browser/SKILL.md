---
name: host-browser
description: 静默接管并操控 Windows 宿主机虚拟「桌面 2」上运行的 Google Chrome 浏览器（通过 CDP 9222 端口）。支持复用用户已登录的真实 Cookie/会话，执行静默打开网页、DOM 查询、元素点击、输入填表、页面截屏与 JavaScript 执行。当任务需要操作宿主机真实浏览器、复用已登录会话或在桌面 2 执行 Web 自动化时使用此技能。
---

# 宿主机桌面 2 浏览器静默接管与控制技能 (host-browser)

本技能用于在任何 Antigravity CLI 项目中，直接静默接管 Windows 宿主机虚拟「桌面 2」上运行的真实 Google Chrome 浏览器（端口 9222），复用用户已登录的完整会话（Google 账号、GitHub、知乎、后台等），执行无感网页自动化。

---

# 核心规范与原则

**1. 静默复用原则**
- Windows 宿主机虚拟「桌面 2」是用户专用于浏览器自动化操作的工作区，通过 CDP 9222 端口（`http://localhost:9222`）提供调试协议。
- 当需要进行任何网页操作、页面截屏、表单填写或状态查验时，**必须优先检测 9222 端口**；只要桌面 2 上的该 Chrome 已经打开，**直接静默接管并复用该现有窗口与已有登录会话**，严禁重复弹出新窗口或重新启动浏览器。

---

# 常用命令

可以使用内置的 `cdp_client.py` 脚本执行各类自动化操作：

````bash
# 1. 检查宿主机 Chrome 连接状态与已打开的标签页
python3 scripts/cdp_client.py status

# 2. 在宿主机 Chrome 打开指定网址
python3 scripts/cdp_client.py open "https://chrome.google.com/webstore/devconsole"

# 3. 提取当前激活网页的全部文本内容 (innerText)
python3 scripts/cdp_client.py text

# 4. 在当前网页执行任意 JavaScript 表达式并返回结果
python3 scripts/cdp_client.py eval "document.title"

# 5. 点击匹配 CSS 选择器的页面元素
python3 scripts/cdp_client.py click "button#submit-button"

# 6. 向指定输入框填入文本
python3 scripts/cdp_client.py fill "input[name=keyword]" "hello world"

# 7. 对当前宿主机网页进行无感高清截屏
python3 scripts/cdp_client.py screenshot "/tmp/page_preview.png"
````

---

# 维护说明与软链接源文件映射

根据团队全局规范要求，Skill 内部脚本采用符号软链接（Symlink）实时同步工作区源文件，切勿使用普通文件覆盖软链接。

**软链接映射关系表**

| Skill 内部路径 | 软链接指向的工作区源文件绝对路径 | 作用说明 |
| :--- | :--- | :--- |
| `scripts/cdp_client.py` | `/home/zxf/workspace/code/agy/chrome_extension/dev_tool/scripts/cdp_client.py` | 宿主机 Chrome CDP 自动化核心控制客户端 |
| `scripts/start_chrome_ai.bat` | `/mnt/c/Users/sageb/Desktop/start_chrome_ai.bat` | Windows 宿主机桌面启动脚本 |
| `scripts/start_chrome_debug.ps1` | `/mnt/c/Users/sageb/Desktop/start_chrome_debug.ps1` | Windows 宿主机底层 PowerShell 调度器 |

> [!IMPORTANT]
> 如需修改自动化控制逻辑，请直接编辑源文件 `/home/zxf/workspace/code/agy/chrome_extension/dev_tool/scripts/cdp_client.py`，Skill 内部脚本将实时自动同步更新。
