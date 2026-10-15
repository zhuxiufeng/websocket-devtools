# 产品需求文档 (PRD)：WebSocket 高级分析与遥测调试扩展 (WS Analyzer)

## 1. 产品定位与核心场景
针对高频 WebSocket 通信场景（如 Klipper/Moonraker 3D 打印机 JSON-RPC 状态流 `notify_status_update`、IoT 遥测、实时控制指令），解决 Chrome 原生 DevTools 的三大核心痛点：
1. **高频刷屏干扰**：大量周期性状态包和心跳包掩盖关键指令。
2. **查看深层字段极其繁琐**：像 `live_position`、`gcode_move.position` 等嵌套在 `params` 数组深处的字段，原生工具必须逐条点击才能在底部小窗查看，无法直观对比连续帧的数据变化。
3. **缺乏多维高亮与趋势感知**：无法同时对多个关键词染色，也无法直观看到坐标、温度、速度等数值的连续波动曲线。

## 2. 界面布局 (Master-Detail + Telemetry)
- **顶部工具栏 (Toolbar)**：
  - 第 1 行：录制/暂停开关 (`Attach/Detach`)、清空 (`Clear`)、一键屏蔽噪音胶囊栏 (`Exclude Chips`)、复合搜索输入框 (`Filter Input`)、`+ Add Custom Column` 按钮、`Visual Tracker` 显隐开关。
  - 第 2 行：多色高亮规则栏（最多 5 个独立颜色的高亮标签，支持整行染色 `Row Tinting`）。
- **左侧栏 (Connections, 180px)**：当前 Tab 捕获到的所有 WebSocket 连接列表及状态。
- **中间主表 (Frame Stream Table, 虚拟滚动)**：
  - 基础列：`Index (#)`、`Dir (↑/↓)`、`Time (HH:mm:ss.SSS)`、`Len`。
  - **动态提取列 (Custom Columns)**：用户通过 JSONPath 或键名提取的专属列（如 `[X, Y, Z] (live_position)`），直接在表格行内展示提取出的值，无需点击展开详情即可纵向对比整个序列。
  - 尾部列：`Payload Preview`（单行预览，若已添加动态列则自动排在动态列之后）。
- **右侧栏上区 (JSON Inspector)**：格式化 JSON 树形视图。**支持右键任意字段节点弹出菜单**：
  - `📌 Show as Column`（将该字段路径提取为中间表格的独立列）
  - `📊 Track on Graph`（将该数值或数值数组加入右下角实时折线图追踪）
  - `🔍 Filter by Value` / `🚫 Exclude Value`
- **右侧栏下区 (Telemetry Tracker 实时追踪面板)**：
  - 轻量级实时折线图，当被追踪的字段（如 `position: [95.47, 133.27, 0.22]` 或 `temperature: 220.5`）随新帧到达时，自动按数组索引（如 `X`, `Y`, `Z` 多条曲线）或单值绘制实时变化曲线。

## 3. 高级搜索与过滤语法
支持空格分隔的多条件 `AND` 组合过滤：
- `dir:in` / `dir:out`：按收发方向过滤。
- `-keyword` 或 `!/regex/`：排除包含指定词或匹配正则的帧（用于过滤无关状态刷屏）。
- `json:path=val` 或 `has:live_position`：精准匹配 JSON 内部字段，或仅筛选包含某深层字段名（如 `live_position`）的帧。
- 普通文本或 `/regex/i`：全文或正则匹配。
