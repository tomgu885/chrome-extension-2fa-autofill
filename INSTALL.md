# 本地验证器：安装

**[下载最新正式版安装包（无需登录 GitHub）](https://github.com/tomgu885/chrome-extension-2fa-autofill/releases/latest/download/local-authenticator.zip)**，或查看 [最新正式版](https://github.com/tomgu885/chrome-extension-2fa-autofill/releases/latest)。此直链会随版本 tag 自动发布新正式版而更新。安装无需 Node.js。请选择 Releases 的「Assets」中的 `local-authenticator.zip` 或带版本号的安装包；「Source code」和仓库「Code → Download ZIP」提供的是源码，需按 [README.md](README.md) 构建后才能加载。

1. 解压 `local-authenticator.zip` 到一个准备长期保留的文件夹。
2. 在 Chrome 地址栏打开 `chrome://extensions`。
3. 打开右上角「开发者模式」，点击「加载已解压的扩展程序」。
4. 选择包含 `manifest.json` 的文件夹，将「本地验证器」固定到工具栏。

无需 Chrome Web Store、注册、购买或许可证。不要删除扩展所在文件夹。

首次使用：添加账号；也可在「导入」粘贴二维码图片（⌘V / Ctrl+V），或选择本地 PNG/JPEG/WebP 文件，核对账号后点击「确认导入」。图片只在本机解析，每张最多 20 MB，可选择多张；Google 迁移需读齐全部二维码。也可粘贴完整的 `otpauth://totp/…` 设置链接，点击「读取链接」并确认导入。要自动填充，在账号中填写准确的登录网站主机名，然后到该网站打开扩展，点击「启用填充」。默认同时匹配网站和用户名；无用户名的第二步页面可显式启用该账号的单账号匹配。

备份：在「本地备份」设置至少 12 字符的口令，导出加密 JSON。恢复会合并账号，不覆盖本地已有账号。忘记口令无法恢复备份。卸载扩展前请备份。

设备迁移：在原设备导出本地加密备份，自行传输文件，在新设备输入备份口令恢复。扩展不提供云同步，不上传 seed、备份密文或口令。

v1.0.2 起已移除旧版的 Chrome 云同步代码与入口。本地账号和原有加密备份仍可使用；历史已上传的云端副本不会因升级自动删除，其他设备上的旧版也应升级。

本地密钥保存在当前 Chrome 用户资料的本地扩展存储中，不另设口令锁。只有导出的本地备份文件经过口令加密。请妥善保管电脑及浏览器用户资料。
