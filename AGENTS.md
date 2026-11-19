# Workspace Rules & Preferences

## Host Browser Automation Preferences
- **虚拟桌面 2 专用浏览器**：Windows 宿主机的虚拟「桌面 2」是用户专用于浏览器自动化操作的工作区，通过 CDP 9222 端口（`http://localhost:9222`）与 AI 联动。
- **静默复用原则**：当需要执行任何网页操作、自动化测试、信息查验或点击时，必须优先探测 9222 端口；只要桌面 2 上的该 Chrome 已经打开，**直接静默接管并复用该现有窗口与已有登录会话**，严禁重复弹出新窗口或重新启动浏览器。
