import type { IFrontendProviderAdapter } from './IFrontendProviderAdapter'
import { Hyper3DFrontendAdapter } from './Hyper3DFrontendAdapter'
import { Tripo3DFrontendAdapter } from './Tripo3DFrontendAdapter'

export class FrontendProviderRegistry {
  private adapters = new Map<string, IFrontendProviderAdapter>()

  register(adapter: IFrontendProviderAdapter): void {
    this.adapters.set(adapter.providerId, adapter)
  }

  get(providerId: string): IFrontendProviderAdapter | undefined {
    return this.adapters.get(providerId)
  }
}

export const frontendProviderRegistry = new FrontendProviderRegistry()
frontendProviderRegistry.register(new Tripo3DFrontendAdapter())
frontendProviderRegistry.register(new Hyper3DFrontendAdapter())
