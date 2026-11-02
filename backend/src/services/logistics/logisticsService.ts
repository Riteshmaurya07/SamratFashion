import { ILogisticsProvider } from './ILogisticsProvider';
import { MockLogisticsProvider } from './MockLogisticsProvider';
import { DelhiveryLogisticsProvider } from './DelhiveryLogisticsProvider';
import { NimbusPostLogisticsProvider } from './NimbusPostLogisticsProvider';
import { IMultiCourierProvider } from './IMultiCourierProvider';
import { AppError } from '../../utils/AppError';
class LogisticsServiceManager {
  private providers: Map<string, ILogisticsProvider> = new Map();
  private defaultProviderName: string = 'mock';

  constructor() {
    const mock = new MockLogisticsProvider();
    const delhivery = new DelhiveryLogisticsProvider();
    const nimbuspost = new NimbusPostLogisticsProvider();

    this.providers.set(mock.name, mock);
    this.providers.set(delhivery.name, delhivery);
    this.providers.set(nimbuspost.name, nimbuspost);
    const envProvider = (process.env.LOGISTICS_PROVIDER || 'nimbuspost').toLowerCase();
    if (this.providers.has(envProvider)) {
      this.defaultProviderName = envProvider;
    }
  }

  public getProvider(name?: string): ILogisticsProvider {
    const providerName = (name || this.defaultProviderName).toLowerCase();
    const isProductionOrStaging = ['production', 'staging'].includes(process.env.NODE_ENV || '');

    // 1. Mock Provider Safety Check
    if (providerName === 'mock') {
      const isMockAllowed = process.env.ALLOW_LOGISTICS_MOCK === 'true';
      if (isProductionOrStaging && !isMockAllowed) {
        throw new AppError(
          'Mock logistics provider is disabled in production/staging environments. Please configure a real logistics provider (LOGISTICS_PROVIDER=nimbuspost) or set ALLOW_LOGISTICS_MOCK=true for testing.',
          500,
          'LOGISTICS_CONFIG_ERROR'
        );
      }
    }

    // 2. Delhivery Credentials Check
    if (providerName === 'delhivery') {
      if (!process.env.DELHIVERY_API_TOKEN) {
        throw new AppError(
          'Delhivery API token (DELHIVERY_API_TOKEN) is required in server environment when LOGISTICS_PROVIDER=delhivery.',
          500,
          'LOGISTICS_CONFIG_ERROR'
        );
      }
    }
    // 3. NimbusPost Credentials Check
    if (providerName === 'nimbuspost') {
      if (!process.env.NIMBUSPOST_API_KEY || !process.env.NIMBUSPOST_API_SECRET) {
        throw new AppError(
          'NimbusPost API credentials (NIMBUSPOST_API_KEY, NIMBUSPOST_API_SECRET) are required in server environment when using NimbusPost provider.',
          500,
          'LOGISTICS_CONFIG_ERROR'
        );
      }
    }
    const provider = this.providers.get(providerName);
    if (!provider) {
      throw new AppError(
        `Requested logistics provider '${providerName}' is not registered or supported.`,
        500,
        'LOGISTICS_CONFIG_ERROR'
      );
    }
    return provider;
  }

  public getMultiCourierProvider(name: string = 'nimbuspost'): IMultiCourierProvider {
    const provider = this.getProvider(name);
    if (!('getMultiCourierRates' in provider)) {
      throw new AppError(
        `Logistics provider '${name}' does not implement multi-courier rate quotes.`,
        400,
        'MULTI_COURIER_UNSUPPORTED'
      );
    }
    return provider as IMultiCourierProvider;
  }
}

export const logisticsService = new LogisticsServiceManager();
