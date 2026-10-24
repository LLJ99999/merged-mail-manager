# Mail Manager · 多邮箱管理器（便携版）

本压缩包已自带 Node.js 运行时、编译好的后端（`server/dist`）、对应平台的原生依赖（better-sqlite3）与构建好的前端（`web/dist`），**无需安装 Node.js 或执行 npm install**。

项目主页 / 源码：https://github.com/LLJ99999/merged-mail-manager

## 启动

| 系统 | 操作 |
|---|---|
| Windows | 解压 zip 后双击 `启动.bat`（或 `start.bat`）。浏览器会自动打开 http://localhost:3000 |
| Linux | `tar -xzf merged-mail-manager-*.tar.gz && cd merged-mail-manager-*/ && ./start.sh` |
| macOS | 解压后双击 `start.command`（或在终端运行 `./start.sh`） |

关闭命令行窗口（或按 Ctrl+C）即停止服务。

### macOS Gatekeeper 提示「无法验证开发者 / 已损坏」

从浏览器下载的文件会带隔离属性，自带的 `node` 未经 Apple 公证。在终端执行一次（路径换成你的解压目录）即可：

```bash
xattr -dr com.apple.quarantine ~/Downloads/merged-mail-manager-v*-macos-*
```

之后再双击 `start.command`。也可以在「系统设置 → 隐私与安全性」中点「仍要打开」。

## 配置与数据

- 首次启动时会从 `.env.example` 自动生成 `.env`：可修改端口 `PORT`、访问密码 `ACCESS_PASSWORD`、超时等，改完重启生效。
- 所有数据（SQLite 数据库）保存在启动脚本旁边的 `data/` 文件夹（`DB_PATH=../data/outlook.db`，相对于 `server/`）。
- 端口被占用时，修改 `.env` 中的 `PORT` 后重新启动。

## 升级

1. 下载并解压新版本到一个**新文件夹**（不要解压到旧目录里面）。
2. 把旧目录中的 **`data/` 文件夹和 `.env` 文件**复制到新目录。
3. 启动新版本，数据库会自动迁移。确认无误后再删除旧目录。

从源码版升级到便携版：把源码目录的 `server/data/outlook.db` 复制到便携版的 `data/outlook.db`，并把旧 `.env` 中的 `DB_PATH` 改为 `../data/outlook.db`（或直接使用新生成的 `.env`）。

## 许可与致谢

MIT License，见 `LICENSE`。基于 [keh4l/outlook-mail-manager](https://github.com/keh4l/outlook-mail-manager)，取信逻辑移植自 [assast/outlookEmail](https://github.com/assast/outlookEmail)。
