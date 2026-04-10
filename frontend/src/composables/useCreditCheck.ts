import { computed, ref } from 'vue'
import { getCreditStatus, type PowerAccountStatus } from '../api'
import { usePermissions } from './usePermissions'

export function isAllCreditsZero(status: PowerAccountStatus | null | undefined): boolean {
  return !!status && status.wallet_balance + status.pool_balance <= 0
}

export function useCreditCheck() {
  const { can, isRootUser } = usePermissions()
  const showCreditDialog = ref(false)
  const isAdmin = computed(() => can('admin-config') && isRootUser.value)

  async function checkCredits(): Promise<void> {
    try {
      // `/credits/status` now reflects the shared site power account.
      const response = await getCreditStatus()
      const status = response.data.data ?? null
      const shouldShowDialog = isAllCreditsZero(status)
      console.info('[useCreditCheck] /credits/status result', {
        status,
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
