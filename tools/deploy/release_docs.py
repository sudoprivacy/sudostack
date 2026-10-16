#!/usr/bin/env python3
"""Synchronize published release documentation without changing installation assets."""
import argparse
import json
from pathlib import Path
import re

from cos_bundle import checksum, descriptor
from release_notes import render

START = '<!-- release-index:start -->'
END = '<!-- release-index:end -->'
REPO = 'https://github.com/sudoprivacy/sudostack'


def update_index(text, version, architecture, qualification):
    if text.count(START) != 1 or text.count(END) != 1 or text.index(START) >= text.index(END):
        raise ValueError('DEPLOYMENT.md requires one release index region')
    before, rest = text.split(START)
    index, after = rest.split(END)
    tag = 'sudostack-v' + version
    row = (f'| [{version}](releases/{version}/README.md) | {architecture} | '
           f'[GitHub Release]({REPO}/releases/tag/{tag}) / COS 已发布 | {qualification} |')
    lines = index.splitlines()
    matches = [i for i, line in enumerate(lines) if line.startswith(f'| [{version}](')]
    if len(matches) > 1:
        raise ValueError('Duplicate version in deployment index')
    if matches:
        lines[matches[0]] = row
    else:
        separators = [i for i, line in enumerate(lines) if line.startswith('| ---')]
        if len(separators) != 1:
            raise ValueError('Release index must contain one table')
        lines.insert(separators[0] + 1, row)
    return before + START + '\n'.join(lines) + '\n' + END + after


def documentation(manifest_path, bundle_path, run_url, runtime_versions=None, acceptance=None):
    data = descriptor(bundle_path)
    manifest = json.loads(manifest_path.read_text())
    notes = render(manifest_path, bundle_path, run_url=run_url)
    version = manifest['sourceLock']['version']
    title, rest = notes.split('\n', 1)
    notes = title + '\n\n**GitHub Release 与 COS 固定包已发布。**\n' + rest
    if runtime_versions:
        cohost = runtime_versions['nexusd-cohost']
        if not isinstance(cohost, str) or not re.fullmatch(r'\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?', cohost):
            raise ValueError('Invalid cohost runtime version')
        architecture = 'x64' if data['architecture'] == 'amd64' else 'arm64'
        url = (f'https://github.com/sudoprivacy/sudocode/releases/download/nexusd-cohost-v{cohost}/'
               f'nexusd-cohost-linux-{architecture}.tar.gz')
        notes = notes.replace('| kubectl（随 Nexus 镜像）',
                              f'| nexusd-cohost（随 Moss Runtime） | `{cohost}` | [上游二进制]({url}) |\n| kubectl（随 Nexus 镜像）', 1)
    qualification = '原生 CI 安装、重复安装及重启恢复通过；实机验收待记录'
    if acceptance:
        if (acceptance.get('release') != data['release'] or not acceptance.get('passed')
                or acceptance.get('bundleSha256') != data['files'][data['bundle']]['sha256']
                or not acceptance.get('finalEnvironmentClean')
                or not all(acceptance.get('phases', {}).get(p, {}).get('passed') for p in ('first', 'reinstall'))):
            raise ValueError('Host acceptance must describe this exact published archive')
        qualification = '原生 CI、166 首装及清空重装通过；测试环境已清理'
        notes += ('\n## 166 实机验收\n\n该归档已完成从空缓存首装、清理后重新下载重装、'
                  '两轮同版本重复安装和原会话重启恢复；最终环境已清理。模型、既有备份及无关 Docker 应用保留。'
                  f'[验收记录]({REPO}/blob/main/releases/{version}/acceptance-166.json)。'
                  '会话测试使用临时模拟模型；真实模型调用仍需配置 Router 上游渠道。\n')
    notes += ('\n安装器支持访问摘要时，安装 / 验证成功会输出各组件地址、实际用户及密码位置，'
              '保存为 `/data/atlas/access-info.txt` / `access-info.json`；摘要不包含密码。'
              '管理员凭据位于 `admin-credentials.txt` / `router-admin-credentials.txt`。\n')
    return notes, qualification


def sync(root, manifest_path, bundle_path, run_url, publication, runtime_versions=None):
    data = descriptor(bundle_path)
    version = data['release'].removeprefix('sudostack-v')
    expected_url = REPO + '/releases/tag/' + data['release']
    if publication.get('tagName') != data['release'] or publication.get('url') != expected_url or publication.get('isDraft'):
        raise ValueError('Documentation requires the matching published GitHub Release')
    lock = json.loads((root / 'manifests/deployment' / (version + '.json')).read_text())
    if lock != json.loads(manifest_path.read_text())['sourceLock']:
        raise ValueError('Published metadata differs from the default branch version lock')
    destination = root / 'releases' / version
    acceptance_path = destination / 'acceptance-166.json'
    acceptance = json.loads(acceptance_path.read_text()) if acceptance_path.exists() else None
    notes, qualification = documentation(manifest_path, bundle_path, run_url, runtime_versions, acceptance)
    index_path = root / 'DEPLOYMENT.md'
    index = update_index(index_path.read_text(), version, data['architecture'], qualification)
    destination.mkdir(parents=True, exist_ok=True)
    (destination / 'README.md').write_text(notes)
    (destination / 'release.json').write_text(json.dumps({
        'release': data['release'], 'architecture': data['architecture'],
        'publishedAt': publication['publishedAt'], 'githubRelease': expected_url,
        'sourceRun': run_url, 'manifestSha256': checksum(manifest_path),
        'bundle': data['bundle'], 'bundleSha256': data['files'][data['bundle']]['sha256'],
    }, indent=2) + '\n')
    index_path.write_text(index)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, required=True)
    parser.add_argument('--manifest', type=Path, required=True)
    parser.add_argument('--bundle', type=Path, required=True)
    parser.add_argument('--publication', type=Path, required=True)
    parser.add_argument('--runtime-versions', type=Path)
    parser.add_argument('--run-url', required=True)
    args = parser.parse_args()
    sync(args.root, args.manifest, args.bundle, args.run_url, json.loads(args.publication.read_text()),
         json.loads(args.runtime_versions.read_text()) if args.runtime_versions else None)


if __name__ == '__main__':
    main()
