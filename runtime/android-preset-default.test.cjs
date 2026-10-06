const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const YAML = require('yaml')
const { seedAndroidPreset } = require('./mobile-bootstrap.cjs')

test('Android default is editable and existing user settings survive startup', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'android-preset-'))
  const patch = path.join(home, 'profiles/web/cordis.patch.yml')
  try {
    seedAndroidPreset(home)
    assert.equal(YAML.parse(fs.readFileSync(patch, 'utf8'))[0].config.default, 'android')
    const user = '- id: agent-preset-registry\n  config:\n    default: ptc\n    selectedDefault: minimal\n- id: other\n  config:\n    enabled: true\n'
    fs.writeFileSync(patch, user)
    seedAndroidPreset(home)
    assert.equal(fs.readFileSync(patch, 'utf8'), user)
    const legacy = '- id: agent-preset-registry\n  config:\n    selectedDefault: standard\n- id: other\n  config:\n    value: 42\n'
    fs.writeFileSync(patch, legacy)
    seedAndroidPreset(home)
    const migrated = YAML.parse(fs.readFileSync(patch, 'utf8'))
    assert.equal(migrated[0].config.selectedDefault, 'standard')
    assert.equal(migrated[1].config.value, 42)
    assert.equal(migrated[2].config.default, 'android')
    const once = fs.readFileSync(patch, 'utf8')
    seedAndroidPreset(home)
    assert.equal(fs.readFileSync(patch, 'utf8'), once)
    const overlay = YAML.parse(fs.readFileSync(path.join(__dirname, 'android.patch.template.yml'), 'utf8'))
    assert.equal(overlay.some(row => row.id === 'agent-preset-registry'), false)
  } finally {
    fs.rmSync(home, { recursive: true, force: true })
  }
})
