# 本地验证器：安装

**[下载 v1.0.0 安装包（无需登录 GitHub）](https://github.com/tomgu885/chrome-extension-2fa-autofill/releases/download/v1.0.0/local-authenticator-1.0.0.zip)**，或查看 [最新正式版](https://github.com/tomgu885/chrome-extension-2fa-autofill/releases/latest)。安装无需 Node.js。请选择 Releases 的「Assets」中的 `local-authenticator-1.0.0.zip`；「Source code」和仓库「Code → Download ZIP」提供的是源码，需按 [README.md](README.md) 构建后才能加载。

1. 解压 `local-authenticator-1.0.0.zip` 到一个准备长期保留的文件夹。
2. 在 Chrome 地址栏打开 `chrome://extensions`。
3. 打开右上角「开发者模式」，点击「加载已解压的扩展程序」。
4. 选择包含 `manifest.json` 的文件夹，将「本地验证器」固定到工具栏。

无需 Chrome Web Store、注册、购买或许可证。不要删除扩展所在文件夹。

首次使用：添加账号，或在「导入」上传 TOTP / Google Authenticator 二维码。要自动填充，在账号中填写准确的登录网站主机名，然后到该网站打开扩展，点击「启用填充」。默认同时匹配网站和用户名；无用户名的第二步页面可显式启用该账号的单账号匹配。

备份：在「备份与同步」设置至少 12 字符的口令，导出加密 JSON。恢复会合并账号，不覆盖本地已有账号。忘记口令无法恢复备份。卸载扩展前请备份。

同步：在两台设备以相同 Chrome 账号开启扩展同步，并安装本扩展的相同版本。输入相同的独立同步口令，手动上传 / 拉取加密快照。重启浏览器需重新解锁。云端约 100 KB；较大账号库使用备份文件。Google 可能按浏览器或企业策略限制扩展同步。

本地密钥保存在当前 Chrome 用户资料的本地扩展存储中，不另设口令锁。只有备份 / 同步内容经过口令加密。请妥善保管电脑及浏览器用户资料。
