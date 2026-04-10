import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

function readViewSource(fileName: string): string {
  return fs.readFileSync(path.resolve(__dirname, '..', fileName), 'utf8')
}

describe('view i18n source wiring', () => {
  it('uses i18n-backed admin messages and locale-aware date formatting', () => {
    const source = readViewSource('AdminView.vue')

    expect(source).toContain("t('common.saveFailed')")
    expect(source).toContain("t('admin.queryFailed')")
    expect(source).toContain("t('admin.rechargeFailed')")
    expect(source).not.toContain("t('common.required', { field: t('admin.userId') })")
    expect(source).toContain("t('admin.compatRechargeValidationPercent')")
    expect(source).toContain("t('admin.compatRechargeValidationDuration')")
    expect(source).not.toContain("t('common.required', { field: t('admin.provider') })")
    expect(source).toContain('locale.value')

    expect(source).not.toContain("'保存失败'")
    expect(source).not.toContain("'查询额度失败'")
    expect(source).not.toContain("'充值失败'")
    expect(source).not.toContain("'钱包百分比与池塘百分比之和必须为 100%'")
    expect(source).not.toContain("toLocaleString('zh-CN')")
  })

  it('uses i18n labels for history table columns', () => {
    const source = readViewSource('HistoryView.vue')

    expect(source).toContain(":label=\"t('history.colTaskId')\"")
    expect(source).toContain(":label=\"t('history.colType')\"")
    expect(source).toContain(":label=\"t('history.colPower')\"")
    expect(source).toContain(":label=\"t('history.colStatus')\"")

    expect(source).not.toContain('label="Task ID"')
    expect(source).not.toContain('label="Type"')
    expect(source).not.toContain('label="Credits"')
    expect(source).not.toContain('label="Status"')
  })

  it('uses power i18n keys for generator metadata', () => {
    const source = readViewSource('GeneratorView.vue')

    expect(source).toContain('displayPower(task.powerCost, task.creditCost, task.providerId) > 0')
    expect(source).toContain("t('generator.power'")
    expect(source).not.toContain("t('generator.credits'")
  })

  it('uses i18n for generator upload failure feedback', () => {
    const source = readViewSource('GeneratorView.vue')

    expect(source).toContain("t('generator.uploadFailed')")
    expect(source).not.toContain("'上传失败'")
  })
})
