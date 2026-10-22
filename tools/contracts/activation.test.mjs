import assert from 'node:assert/strict'
import { test } from 'node:test'

import { runHistoricalTest } from './history-0.2.0.mjs'

// 历史 checkout 的行尾钉死在 LF（blob 口径）：临时 clone 无 local override，
// 会继承系统级 core.autocrlf=true（Windows）——LF blob 检出为 CRLF 工作区，
// 字节锚断言在锚未漂移时失败。history-0.2.0.mjs 的当前字节被 C 锚钉死
// （activation-0.2.1 protected paths），不能改文件本身——经 git 的
// GIT_CONFIG_* 环境配置（git >= 2.31）随 spawn 链注入 clone/checkout。
process.env.GIT_CONFIG_COUNT = '1'
process.env.GIT_CONFIG_KEY_0 = 'core.autocrlf'
process.env.GIT_CONFIG_VALUE_0 = 'false'

test('immutable 0.2.0 activation mutation suite passes in its historical checkout', () => {
  const output = runHistoricalTest('tools/contracts/activation.test.mjs')
  assert.match(output, /tests 7/)
  assert.match(output, /pass 7/)
  assert.match(output, /fail 0/)
})
