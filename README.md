# 本地验证器 · Local Authenticator

独立实现的 Chrome Manifest V3 TOTP 扩展。全部功能开放，无许可证、服务器、遥测或远程代码；不是原商店扩展的修改版。

## 功能

- 不设账号数量上限；生成和复制 SHA1 / SHA256 / SHA512、6 / 8 位 TOTP；支持 5–300 秒周期。
- 增删改账号；搜索、文件夹、标签、置顶。
- 本地解析二维码图片、`otpauth://totp` 链接和 Google Authenticator protobuf 迁移二维码，支持多张迁移批次完整性检查与去重。
- 网页右键扫描可见区域中的二维码，包括 canvas 与跨域图片；导入前展示账号确认。不主动获取图片 URL。
- 按完整主机名和用户名自动匹配，识别动态表单和分格验证码；支持同源分步登录的临时用户名记忆。不自动提交、不覆盖手动输入。默认禁用无用户名匹配，可按账号开启。
- AES-256-GCM 加密备份、导入合并。PBKDF2-SHA256 / 600,000 次迭代，随机 16 字节盐及 12 字节 IV。
- 可选 Chrome Sync：口令加密、分块存储、手动快照上传和拉取合并；会话锁定；不上传明文账号或口令。

## 开发与安装

需要 Node.js 22+、npm 和 Chrome 120+。

```sh
npm ci
npm test
npm run check
npm run build
```

在 `chrome://extensions` 开启开发者模式，加载 `dist/`。执行 `npm run package` 生成 `artifacts/local-authenticator-1.0.0.zip`。安装说明见 [INSTALL.md](INSTALL.md)。

```sh
npx playwright install chromium
npm run test:e2e
npm run preview
```

E2E 在隔离的临时用户资料和无头 Chromium 中加载实际扩展，使用公开的 RFC 测试密钥及本地测试页面，不操作日常浏览器或真实账号。测试副本预授权本地站点，并以 `<all_urls>` 提供截图能力，代替无法在无头模式点击的原生右键菜单授权；正式包不包含这些固定权限。测试不覆盖真实权限对话框、原生菜单点击或真实跨设备传送。`preview` 只供内置浏览器视觉检查，不是扩展运行环境，演示代码不会打包进扩展。

## 自动填充与权限

默认没有任何站点读取权限。只有点击「启用填充」才申请当前站点的可选权限；可在设置中移除。站点精确匹配，不以服务名、邮箱域名、后缀或任意子域猜测网站。相同站点多个账号时，必须唯一匹配用户名。用户名只暂存在 `storage.session`，同源、同标签页有效期 10 分钟。跨源 iframe 不返回验证码。

不能访问 Chrome 内置页面、商店页面或封闭 Shadow DOM。网页控件没有统一标准，特殊自定义组件可能需要手动复制。无用户名时默认不自动填充；可对单个账号启用回退规则。只填写 TOTP，不支持 HOTP、短信接码、推送批准或 passkey。

`storage` / `unlimitedStorage` 用于本地账号库；`activeTab` 用于用户右键发起的截图；`scripting` 用于授权网站内容脚本；`contextMenus` 用于扫描入口；`clipboardWrite` 用于复制验证码。无固定全站访问权限，无外部网络请求代码。QR 解析库 jsQR 随包提供，许可证随包附带。

## 数据和同步边界

本地账号库以明文存于 Chrome 本地扩展存储，访问级别限制为 `TRUSTED_CONTEXTS`，内容脚本只能向 worker 申请当前匹配账号的一次性验证码。扩展本地页面可读账号库以生成列表。设备或浏览器资料已被控制时，本扩展不能保护本地密钥。不提供额外的本地保险库口令锁。

同步使用 Chrome 账号本身的同步设施，没有自建后端。解锁后的派生密钥只保存在受限的 `storage.session`，浏览器退出或扩展重载后丢失。`storage.sync` 只包含加密 envelope、分块和版本/时间元数据。**同步采用手动上传 / 拉取快照，不是后台自动双向实时同步**。拉取和备份恢复均保留本地数据、跳过相同用户名/密钥/算法/位数/周期的重复账号；既有账号元数据以本地为准，不传播删除。云端新快照会阻止基于旧版本上传，需先拉取核对。

Chrome Sync 总配额 102,400 字节，每项 8,192 字节；实现按 6,000 字符分块，并在 95 KB 前阻止上传。此限制只影响同步，本地账号不设产品数量上限，仍受设备空间限制。相同的公开 manifest key 固定扩展 ID，使不同路径安装可以使用同一同步命名空间；新设备仍需手动安装并开启 Chrome 的扩展同步。实际跨设备传送依赖 Google 服务及浏览器策略，自动化测试不连接真实同步账号。

所有导入先完成格式验证，再提交本地存储。Google 迁移不支持的算法、HOTP 或不完整批次会显示错误，不静默丢弃账号。加密备份只支持本项目公开的 v1 格式；不声称兼容原付费扩展的未公开加密格式。

## 参考

- [Chrome Storage API / 配额和访问级别](https://developer.chrome.com/docs/extensions/reference/api/storage)
- [Chrome Tabs API / activeTab 和截图](https://developer.chrome.com/docs/extensions/reference/api/tabs)
- [固定扩展 ID 的 manifest key](https://developer.chrome.com/docs/extensions/reference/manifest/key)
- [Google Authenticator Key URI](https://github.com/google/google-authenticator/wiki/Key-Uri-Format)
- [Google 迁移格式的公开 protobuf 描述](https://github.com/qistoph/otp_export/blob/master/OtpMigration.proto)
- [RFC 6238](https://www.rfc-editor.org/rfc/rfc6238)

## 验证

`npm test` 验证 RFC 6238 全部算法向量、密钥校验、迁移批次/损坏数据、加密往返/篡改/错误口令、精确主机与用户名匹配、同步配额和分块。`npm run test:e2e` 验证实际 MV3 worker、账号管理、扫码、备份恢复、同步加密存储和本地登录表单填充。测试仅使用公开测试数据，不记录真实密钥、口令、账号库或配置。
