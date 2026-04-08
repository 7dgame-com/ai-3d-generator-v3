import { computed, ref } from 'vue'
import { getCreditStatus, type ProviderCreditStatus } from '../api'
import { usePermissions } from './usePermissions'

export function isAllCreditsZero(statuses: ProviderCreditStatus[]): boolean {
  return statuses.length > 0 && statuses.every((status) => status.wallet_balance + status.pool_balance <= 0)
}

export function useCreditCheck() {
  const { can } = usePermissions()
  const showCreditDialog = ref(false)
  const isAdmin = computed(() => can('admin-config'))

  async function checkCredits(): Promise<void> {
    try {
      const response = await getCreditStatus()
      const statuses = response.data.data ?? []
      const shouldShowDialog = isAllCreditsZero(statuses)
      console.info('[useCreditCheck] /credits/status result', {
        statuses,
        shouldShowDialog,
      })
      showCreditDialog.value = shouldShowDialog
    } catch (error) {
      console.error('[useCreditCheck] /credits/status request failed', error)
      // Keep generation available when the credit check cannot complete.
    }
  }

  function triggerDialog(): void {
    showCreditDialog.value = true
  }

  function closeDialog(): void {
    showCreditDialog.value = false
  }

  return {
    showCreditDialog,
    isAdmin,
    checkCredits,
    triggerDialog,
    closeDialog,
  }
}
