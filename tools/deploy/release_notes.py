#!/usr/bin/env python3
"""Render the human release inventory from the manifest and COS descriptor."""
import argparse
import json
from pathlib import Path
import re
from urllib.parse import quote

from cos_bundle import checksum, descriptor, https_base

COS_BASE = 'https://sudowork-release-1309794936.cos.accelerate.myqcloud.com/sudostack'
GUIDE = 'https://github.com/sudoprivacy/sudostack/blob/main/docs/deployment/releasing.md'
OVERVIEW = 'https://github.com/sudoprivacy/sudostack/blob/main/DEPLOYMENT.md'
LABELS = {'moss': 'Moss Server / Runtime / 部署助手', 'webui': 'SudoWork WebUI',
          'router': 'SudoRouter', 'sudocode': 'Sudocode', 'nexus': 'Nexus cluster',
          'vault': 'Nexus Vault', 'k3s': 'k3s', 'gvisor': 'gVisor', 'helm': 'Helm',
          'caddy': 'Caddy', 'postgres': 'PostgreSQL', 'nexusBase': 'Nexus 基础镜像（Node.js）'}


def link(label, url):
    return '[' + label + '](' + url + ')'


def maintenance_sections(version, architecture, cleanup_url=None, cos_base=COS_BASE):
    lines = ['## 清理环境', '',
             '**仅用于已确认可清空的专用测试环境。** 清理会删除整个本机 k3s 集群、Atlas 数据、'
             '凭据、默认下载缓存、Helm 和 gVisor；先保存需要的备份及验收报告。', '', '```bash']
    if cleanup_url:
        lines += [f'curl -fL "{cleanup_url}" -o cleanup-atlas.sh',
                  'bash cleanup-atlas.sh --dry-run', 'sudo bash cleanup-atlas.sh']
    else:
        lines += ['# 候选包成功安装后，使用它自带的清理脚本',
                  'sudo bash /data/atlas/cleanup-atlas.sh --dry-run',
                  'sudo bash /data/atlas/cleanup-atlas.sh']
    lines += ['```', '',
              '旧 worker 退出集群应先备份并执行 `sudo sh /usr/local/bin/k3s-agent-uninstall.sh`；'
              '此步骤与 Atlas 整体清理不同，详见 '
              + link('agent 与端口冲突处理', GUIDE.replace('releasing.md', 'arm64.md')) + '。', '',
              '## 更新到新的完整包', '',
              '**当前支持同版本重试，不支持通用跨版本原地升级。** 保留业务数据的实例先制定备份、数据迁移和恢复方案；'
              '以下跨版本命令用于已完成备份和上述清理的测试机。必须先选择一个已发布的 '
              + architecture + ' 版本，不使用规划版本或其他架构。', '',
              '同版本重试：修复环境问题后重跑原来的安装命令，会复用校验通过的缓存并继续验证。', '',
              '```bash',
              '# 在保存该版安装入口的目录运行；离线安装使用解包后的 install-atlas.sh',
              'sudo bash ./install-cos.sh --host "你的服务器IP或域名" --root /data/atlas --manage-k3s',
              '```', '',
              '清理后安装新版（将变量替换为实际已发布版本和目标地址）：', '', '```bash',
              'ATLAS_NEXT_VERSION="替换为已发布的同架构版本"',
              'ATLAS_HOST="你的服务器IP或域名"',
              f'ATLAS_NEXT_BASE="{cos_base}/releases/sudostack-v$ATLAS_NEXT_VERSION"',
              'curl -fL "$ATLAS_NEXT_BASE/install-cos.sh" -o "install-$ATLAS_NEXT_VERSION.sh"',
              'sudo bash "install-$ATLAS_NEXT_VERSION.sh" --host "$ATLAS_HOST" --root /data/atlas --manage-k3s',
              '```', '',
              '更新后执行 `sudo /data/atlas/verify.sh`，核对 `/data/atlas/release-manifest.json` 中的版本。'
              '新安装器还会输出入口、用户名和密码文件位置，保存到 `access-info.txt` / `access-info.json`。', '',
              '组件变更、版本锁和 tag 发布命令见 ' + link('发版操作手册', GUIDE) + '。', '']
    return '\n'.join(lines)


def format_notes(text):
    labels = {'moss-server-image-': 'Server 镜像', 'moss-runtime-': 'Runtime 镜像', 'moss-deploy-': '部署助手',
              'sudowork-webui-': 'WebUI + PostgreSQL', 'nexusd-cluster-': 'Nexus 原始包',
              'nexus-vault-': 'Vault 插件', 'atlas-nexus-': '套件 Nexus 镜像', 'sudorouter-': 'Router 镜像',
              'scode-linux-': 'Sudocode 二进制'}
    for prefix, label in labels.items():
        text = re.sub(r'\[' + re.escape(prefix) + r'[^\]]+\]\(([^)]+)\)',
                      lambda match: link(label, match[1]), text)
    start, end = text.index('## 下载与安装'), text.index('## 清理环境')
    install = text[start:end]
    text = text[:start] + text[end:]
    before = text.index('## 组件版本与下载')
    return text[:before] + install + text[before:]


def render(manifest_path, bundle_path, cos_base=COS_BASE, run_url=None):
    data = descriptor(bundle_path)
    if checksum(manifest_path) != data['manifestSha256']:
        raise ValueError('Release notes manifest differs from the qualified bundle')
    manifest = json.loads(manifest_path.read_text())
    lock = manifest['sourceLock']
    if (manifest['release'] != data['release'] or manifest['architecture'] != data['architecture']
            or manifest['release'] != 'sudostack-v' + lock['version']
            or lock['architecture'] != data['architecture'] or manifest['components'] != lock['components']):
        raise ValueError('Release notes version, architecture or components disagree')
    sources, components = manifest['sources'], manifest['components']
    for name, digest in manifest['archives'].items():
        if sources[name]['sha256'] != digest:
            raise ValueError('Release notes source checksum disagrees: ' + name)
    base = https_base(cos_base) + '/releases/' + data['release']
    bundle = data['bundle']
    info = data['files'][bundle]

    def source_links(prefix):
        matches = [(name, item) for name, item in sources.items() if name.startswith(prefix)]
        if not matches:
            raise ValueError('Missing release notes source: ' + prefix)
        return ' / '.join(link(name, item['url']) for name, item in matches)

    def inputs(name):
        return ' / '.join(link(filename, item['url'])
                          for filename, item in manifest['buildInputs'][name].items())

    lines = [f'# Sudostack {lock["version"]}', '',
             link('部署与发布总览', OVERVIEW) + ' · ' + link('全部版本', OVERVIEW + '#选择版本')
             + ' · ' + link('快速发布', OVERVIEW + '#修改组件并发布新整包'), '',
             f'平台：**Linux {data["architecture"]}**。完整包：**{info["size"]:,} 字节**'
             f'（约 {info["size"] / 1024**3:.2f} GiB）。', '',
             '## 整包与交付文件', '', '| 文件 | 下载地址 |', '| --- | --- |']
    for label, name in [('完整离线包', bundle), ('整包 SHA256', bundle + '.sha256'),
                        ('一键安装入口', 'install-cos.sh'), ('清理脚本', 'cleanup-atlas.sh'),
                        ('组件版本锁', 'components.lock.json'), ('完整发布清单', 'atlas-release.json'),
                        ('COS 文件大小与摘要', 'bundle.json'), ('COS 交付文件校验表', 'SHA256SUMS'),
                        ('离线下载与解包助手', 'cos_bundle.py')]:
        lines.append(f'| {label} | {link(name, base + "/" + quote(name))} |')
    lines += ['', '整包 SHA256：', '', '```text', info['sha256'], '```', '',
              '完整包包含全部运行镜像、离线工具与安装文件；目标机仍须预装 Python、curl、openssl 等系统依赖。',
              'GitHub Release 附件用于清单和分项下载，完整 `.tar.gz` 从上述 COS 地址下载。', '',
              '## 组件版本与下载', '', '| 组件 | 锁定版本 | 分项下载 / 包含关系 |', '| --- | --- | --- |']
    for name, c in components.items():
        version = '`' + c['version'] + '`'
        if 'repository' in c:
            version = link(version, f'https://github.com/{c["repository"]}/releases/tag/{quote(c["tag"], safe="")}')
        if name == 'moss':
            urls = ' / '.join(source_links(p) for p in ('moss-server-image-', 'moss-runtime-', 'moss-deploy-'))
        elif name == 'webui':
            urls = source_links('sudowork-webui-')
        elif name == 'router':
            urls = source_links('sudorouter-')
        elif name == 'nexus':
            urls = inputs(name) + '；整包使用 ' + source_links('atlas-nexus-')
            if 'pluginABI' in c:
                urls += f'；plugin ABI {c["pluginABI"]}'
        elif name in ('vault', 'sudocode', 'k3s', 'gvisor'):
            urls = inputs(name)
            if name == 'vault':
                urls += '；集成于 Nexus 镜像'
            if name == 'sudocode':
                urls += '；集成于 Moss Runtime'
        elif name == 'helm':
            urls = source_links(manifest['helm']['archive'])
        elif name == 'caddy':
            urls = source_links('caddy-') + '；`' + c['image'] + '`'
        elif name == 'postgres':
            urls = '`' + c['image'] + '`；随 ' + source_links('sudowork-webui-') + ' 交付'
        elif name == 'nexusBase':
            urls = '`' + c['image'] + '`；集成于 ' + source_links('atlas-nexus-')
        else:
            raise ValueError('Add the new component to the release inventory: ' + name)
        lines.append(f'| {LABELS[name]} | {version} | {urls} |')
    kubectl = components['k3s']['version'].split('+')[0]
    lines += [f'| kubectl（随 Nexus 镜像） | `{kubectl}` | '
              + link('上游二进制', f'https://dl.k8s.io/release/{kubectl}/bin/linux/{data["architecture"]}/kubectl') + ' |',
              f'| Atlas Helm Chart | `{manifest["chartVersion"]}` | {source_links(manifest["chart"])} |',
              f'| 安装器与运维脚本 | `{manifest["installerVersion"]}` | {source_links("install-atlas.sh")}；详见下方文件清单 |', '',
              'Moss Runtime 内嵌依赖（含 nexusd-cohost）由 Moss 固定；详见 '
              + link('该 Moss tag 的 runtime-versions.json',
                     f'https://github.com/{components["moss"]["repository"]}/blob/'
                     + quote(components['moss']['tag'], safe='') + '/src/server/nexus/runtime-versions.json') + '。',
              'PostgreSQL 的锁为 `16-alpine` 一类镜像标签，未单独记录补丁版；实际交付内容由 WebUI 归档 SHA256 固定。',
              'Nexus 基础镜像和 Caddy 的 registry digest 见 `atlas-release.json.registryInputs`；其余上游附件摘要见 `buildInputs`。', '',
              '## 下载与安装', '', '```bash', f'ATLAS_COS_RELEASE="{base}"',
              'curl -fL "$ATLAS_COS_RELEASE/install-cos.sh" -o install-cos.sh',
              '# 先下载、解包并校验全部文件', 'bash install-cos.sh --download-only',
              '# 在满足要求的目标机安装，替换为实际 IP 或域名',
              'sudo bash install-cos.sh --host "你的服务器IP或域名" --root /data/atlas --manage-k3s', '```', '',
              '清理脚本会删除整个 k3s 集群及安装数据。仅在已确认清空范围的专用测试机执行；详见 '
              + link('安装与清理边界', GUIDE) + '。', '']
    if data['architecture'] == 'arm64':
        lines += ['ARM64 要求 Linux、root、systemd 和 4 KB 页大小；企微会话存档 SDK 暂不支持 ARM64。', '']
    lines += [maintenance_sections(lock['version'], data['architecture'], base + '/cleanup-atlas.sh', https_base(cos_base))]
    lines += ['## 验收与后续发布', '',
              'GitHub Release 在原生 CI 安装、同版本重复安装和会话重启恢复验收通过后创建；'
              '上述 COS 地址在该次 `publish-cos` 成功后可用。']
    if run_url:
        lines += [link('本次 CI 与验收记录', https_base(run_url)) + '。']
    lines += ['目标机首装、清空重装及 `latest` 推广须单独记录；tag 发布默认只写固定版本目录。',
              '修改组件版本后：先发布上游组件 → 新增套件版本锁 → PR 原生验收 → 合并并推送新 tag → '
              '发布固定 COS 整包 → 目标机首装 / 清空重装 → 复用同一包推广 `latest`。',
              link('逐步发版操作手册', GUIDE) + '。', '', '<details>',
              f'<summary>完整包内文件：atlas-release.json + {len(manifest["archives"])} 项资源（下载与 SHA256）</summary>', '',
              f'`atlas-release.json` 自身 SHA256：`{data["manifestSha256"]}`。', '',
              '| 包内路径 | 原始下载地址 | SHA256 |', '| --- | --- | --- |']
    for name, digest in sorted(manifest['archives'].items()):
        lines.append(f'| `{name}` | {link("下载", sources[name]["url"])} | `{digest}` |')
    lines += ['', '包内路径保留 `offline/`；GitHub 附件名可能以 `--` 代替 `/`，请使用清单中的实际 URL。', '', '</details>', '']
    return format_notes('\n'.join(lines))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--manifest', type=Path, required=True)
    parser.add_argument('--bundle', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--cos-base', default=COS_BASE)
    parser.add_argument('--run-url')
    args = parser.parse_args()
    notes = render(args.manifest, args.bundle, args.cos_base, args.run_url)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(notes)


if __name__ == '__main__':
    main()
