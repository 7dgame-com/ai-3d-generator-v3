import { computed, ref } from 'vue'
import { getCreditStatus, type QuotaStatus } from '../api'
import { useAuthSession } from './useAuthSession'

export function isAllCreditsZero(status: QuotaStatus | null | undefined): boolean {
  return !!status && status.remaining_power <= 0
}

export function useCreditCheck() {
  const { isRootUser } = useAuthSession()
  const showCreditDialog = ref(false)
  const quotaStatus = ref<QuotaStatus | null>(null)
  const isCheckingCredits = ref(false)
  const isAdmin = computed(() => isRootUser.value)

  async function checkCredits(): Promise<void> {
    isCheckingCredits.value = true
    try {
      // `/credits/status` reflects the current user's quota under the active quota tool.
      const response = await getCreditStatus()
      const status = response.data.data ?? null
      quotaStatus.value = status
      const shouldShowDialog = isAllCreditsZero(status)
      console.info('[useCreditCheck] /credits/status result', {
        status,
        shouldShowDialog,
      })
      showCreditDialog.value = shouldShowDialog
    } catch (error) {
      console.error('[useCreditCheck] /credits/status request failed', error)
      // Keep generation available when the credit check cannot complete.
    } finally {
      isCheckingCredits.value = false
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
    quotaStatus,
    isCheckingCredits,
    isAdmin,
    checkCredits,
    triggerDialog,
    closeDialog,
  }
}
