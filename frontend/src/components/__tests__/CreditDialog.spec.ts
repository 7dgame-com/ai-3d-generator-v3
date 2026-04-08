import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it } from 'vitest'
import i18n from '../../i18n'
import CreditDialog from '../CreditDialog.vue'

const stubs = {
  ElDialog: {
    props: ['modelValue', 'title'],
    template: `
      <div v-if="modelValue" data-test="dialog">
        <h2>{{ title }}</h2>
        <div><slot /></div>
        <div><slot name="footer" /></div>
      </div>
    `,
  },
  ElButton: {
    emits: ['click'],
    template: '<button type="button" @click="$emit(\'click\')"><slot /></button>',
  },
}

describe('CreditDialog', () => {
  beforeEach(() => {
    i18n.global.locale.value = 'en-US'
  })

  it('renders the admin message and emits go-admin for admin users', async () => {
    const wrapper = mount(CreditDialog, {
      props: {
        visible: true,
        isAdmin: true,
      },
      global: {
        plugins: [i18n],
        stubs,
      },
    })

    expect(wrapper.text()).toContain('Insufficient Credits')
    expect(wrapper.text()).toContain('All providers have zero credits.')
    expect(wrapper.text()).toContain('Go to Recharge')
    expect(wrapper.text()).not.toContain('OK')

    await wrapper.get('button').trigger('click')

    expect(wrapper.emitted('go-admin')).toHaveLength(1)
  })

  it('renders the regular-user message and closes itself without showing admin navigation', async () => {
    const wrapper = mount(CreditDialog, {
      props: {
        visible: true,
        isAdmin: false,
      },
      global: {
        plugins: [i18n],
        stubs,
      },
    })

    expect(wrapper.text()).toContain('Insufficient credits to generate 3D models.')
    expect(wrapper.text()).toContain('OK')
    expect(wrapper.text()).not.toContain('Go to Recharge')

    await wrapper.get('button').trigger('click')

    expect(wrapper.emitted('update:visible')).toEqual([[false]])
    expect(wrapper.emitted('go-admin')).toBeUndefined()
  })
})
