import { readFile, copyFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

const [version, directory] = process.argv.slice(2);
const filename = `local-authenticator-${version}.zip`;
const digest = createHash('sha256').update(await readFile(join(directory, filename))).digest('hex');
if (!process.env.EXPECTED_DIGEST || digest !== process.env.EXPECTED_DIGEST.replace(/^sha256:/, '')) {
  throw new Error('Downloaded ZIP does not match the tested build digest; release preparation stopped.');
}
await copyFile(join(directory, filename), join(directory, 'local-authenticator.zip'));
await writeFile(join(directory, 'SHA256SUMS.txt'), `${digest}  ${filename}\n${digest}  local-authenticator.zip\n`);
await writeFile(join(directory, 'release-notes.md'), `本地验证器 v${version}

下载 Assets 中的 \`local-authenticator.zip\` 或 \`${filename}\`，解压后在 Chrome 的 \`chrome://extensions\` 开启开发者模式，选择「加载已解压的扩展程序」并选中包含 \`manifest.json\` 的目录。无需登录 GitHub，无需 Chrome Web Store 或 Node.js。

安装包来自此 tag 对应提交通过核心测试、类型检查和 Chromium 端到端测试的构建。两个 ZIP 内容相同，附带 \`SHA256SUMS.txt\` 供校验。

[完整安装与使用说明](https://github.com/tomgu885/chrome-extension-2fa-autofill/blob/v${version}/README.md)
`);
console.log('Verified release ZIP, stable download alias, checksums, and notes prepared.');
