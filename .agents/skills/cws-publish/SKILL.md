---
name: cws-publish
description: 自动化执行 Chrome 扩展（Chrome Extension / DevTools 插件）代码测试、版本号递增、生产编译打包（.zip）、复制到 Windows 桌面、生成符合「--- \n What's new in vX.Y.Z: \n - ...」规范的更新日志，并执行 Git 提交与 Tag 推送。当用户要求上传更新到 Chrome 市场、发布新版本、打包扩展、生成 CWS 发布日志时使用此技能。
---

# Chrome 网上应用店自动发版与构建技能 (cws-publish)

本技能用于在对 Chrome 扩展 / DevTools 插件完成功能迭代、缺陷修复或性能优化后，自动化完成全流程质量保障（运行单元与集成测试）、生产环境编译、ZIP 安装包封包、自动复制至 Windows 桌面便于网页直传，并自动生成符合应用店严格规范的标准更新日志（`What's new in vX.Y.Z:`），实现一站式发布流。

---

# 核心职责与触发时机

**1. 触发时机**
- **发布更新闭环**：当用户要求“上传更新到 chrome 市场”、“发布到 Chrome Web Store”、“发版”、“发布新版本”时执行。
- **打包与安装包准备**：当用户要求“打包扩展”、“生成 zip”、“导出发布包”、“准备商店更新包”时执行。
- **生成应用店更新日志**：当用户要求生成符合格式的“更新日志”、“What's new”、“Release Notes”时执行。

**2. 核心执行流程**
1. **自动化前置单测校验**：运行 `pnpm test`，确保全部测试用例 100% 通过，防止带病打包。
2. **版本号管理**：
   - 支持自动自增 Patch 位（如 `1.0.16` -> `1.0.17`）或显式指定版本号。
   - 同步更新 [package.json](file:///home/zxf/workspace/code/agy/chrome_extension/dev_tool/package.json)、[wxt.config.ts](file:///home/zxf/workspace/code/agy/chrome_extension/dev_tool/wxt.config.ts) 与 [CHROMEWEBSTORE.md](file:///home/zxf/workspace/code/agy/chrome_extension/dev_tool/CHROMEWEBSTORE.md)。
3. **生产环境编译与 ZIP 封包**：调用 `pnpm build && pnpm zip`，在 `.output/` 目录下生成合规的标准扩展 zip 包。
4. **一键同步至 Windows 桌面**：
   - 自动将生成的 `.zip` 发布包拷贝到宿主机桌面：`/mnt/c/Users/sageb/Desktop/<package-name>-<version>-chrome.zip`（`C:\Users\sageb\Desktop\`）。
   - 用户打开 Chrome 开发者控制台时，可直接在桌面通过文件选择器一键拖拽上传，无需穿越 WSL 路径。
5. **生成标准化应用店更新日志**：
   - 严格遵循用户指定的标准格式（以 `---` 开头，首行为 `What's new in v<version>:`，每条更新独立以 `- ` 引导）。
   - 自动解析 Git 提交（Conventional Commits），或接收自定义条目，并同时保存至 `.output/release-notes.txt`。
6. **Git 版本沉淀与同步**：
   - 自动执行 `git commit` 与 `git tag v<version>`。
   - 推送至 GitHub 远端仓库及 Tag，保持代码库与应用店版本严格一致。

---

# 应用店更新日志标准格式规范

生成更新日志时，**必须且严格**采用以下文本格式输出，以便用户一键复制粘贴至 Chrome 开发者后台描述框：

````text
---
What's new in v<version>:
- Added <feature description in past tense>.
- Fixed <bug description or issue resolved>.
- Improved <performance or reliability enhancement>.
````

**格式关键要求：**
- **必须以 `---` 分割线首行开启**。
- **版本号标题行格式**：`What's new in vX.Y.Z:`（注意首字母大写与末尾英文冒号）。
- **条目引导符**：每个要点使用 `- ` 开头，动词建议大写过去分词（如 `Added`、`Fixed`、`Improved`、`Enabled`）。
- **严禁包含开发实现细节**：面向最终用户编写，阐述功能收益而非代码细节（如不说“使用 setTimeout 替代 RAF”，而说“Improved stream ingestion reliability when DevTools is unfocused”）。

---

# 维护说明与软链接源文件映射

根据团队全局规范要求，Skill 内部脚本采用符号软链接（Symlink）实时同步工作区源文件，切勿使用普通文件覆盖软链接。

**软链接映射关系表**

| Skill 内部路径 | 软链接指向的工作区源文件绝对路径 | 作用说明 |
| :--- | :--- | :--- |
| `scripts/publish_cws.py` | `/home/zxf/workspace/code/agy/chrome_extension/dev_tool/scripts/publish_cws.py` | Chrome 应用店全流程编译、打包、桌面同步与更新日志生成脚本 |

> [!IMPORTANT]
> 如需修改打包或日志生成逻辑，请直接编辑工作区源文件 `/home/zxf/workspace/code/agy/chrome_extension/dev_tool/scripts/publish_cws.py`，Skill 内部脚本将实时自动同步更新。

---

# 命令行使用说明

**1. 常用命令**

````bash
# 1. 标准流程：运行测试 -> 编译打包 -> 拷贝至桌面 -> 生成更新日志（保持当前版本）
python3 scripts/publish_cws.py

# 2. 版本号自动递增（Patch 位 +1）并全自动发布打包
python3 scripts/publish_cws.py --bump

# 3. 指定版本号并构建发布
python3 scripts/publish_cws.py --version 1.0.17

# 4. 指定自定义更新条目（避免自动提取 Git 日志）
python3 scripts/publish_cws.py --bump --notes "Added new filter presets" "Fixed table rendering stall"
````
