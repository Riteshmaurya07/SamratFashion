import { ILogisticsProvider } from './ILogisticsProvider';
import { MockLogisticsProvider } from './MockLogisticsProvider';
import { DelhiveryLogisticsProvider } from './DelhiveryLogisticsProvider';
import { AppError } from '../../utils/AppError';

class LogisticsServiceManager {
  private providers: Map<string, ILogisticsProvider> = new Map();
  private defaultProviderName: string = 'mock';

  constructor() {
    const mock = new MockLogisticsProvider();
    const delhivery = new DelhiveryLogisticsProvider();

    this.providers.set(mock.name, mock);
    this.providers.set(delhivery.name, delhivery);

    const envProvider = (process.env.LOGISTICS_PROVIDER || 'mock').toLowerCase();
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
          'Mock logistics provider is disabled in production/staging environments. Please configure a real logistics provider (LOGISTICS_PROVIDER=delhivery) or set ALLOW_LOGISTICS_MOCK=true for testing.',
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
}

export const logisticsService = new LogisticsServiceManager();
