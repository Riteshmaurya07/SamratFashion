export interface IAIGenerationRequest {
  prompt: string;
  style?: string;
  aspectRatio?: string;
}

export interface IAIGenerationResult {
  success: boolean;
  imageUrl?: string;
  error?: string;
}

export interface IAIGeneratorProvider {
  generateImage(request: IAIGenerationRequest): Promise<IAIGenerationResult>;
}

// Mock Provider (Fallback / Testing)
class MockAIProvider implements IAIGeneratorProvider {
  async generateImage(request: IAIGenerationRequest): Promise<IAIGenerationResult> {
    return new Promise((resolve) => {
      setTimeout(() => {
        const seed = encodeURIComponent(request.prompt);
        resolve({
          success: true,
          imageUrl: `https://picsum.photos/seed/${seed}/800/800`, // Using picsum for mock generated images
        });
      }, 2000); // Simulate network latency
    });
  }
}

// DALL-E Provider Stub (Production)
class DalleProvider implements IAIGeneratorProvider {
  async generateImage(request: IAIGenerationRequest): Promise<IAIGenerationResult> {
    // In real implementation, call OpenAI API here
    throw new Error("DALL-E provider not fully implemented yet. Configure Mock for now.");
  }
}

export class AIDesignService {
  private static provider: IAIGeneratorProvider;

  public static initialize() {
    const providerConfig = process.env.AI_PROVIDER || 'MOCK';
    
    switch (providerConfig) {
      case 'DALLE':
        this.provider = new DalleProvider();
        break;
      case 'MOCK':
      default:
        this.provider = new MockAIProvider();
        break;
    }
    
    console.log(`[AI] Initialized AI Design Service with provider: ${providerConfig}`);
  }

  public static async generateImage(request: IAIGenerationRequest): Promise<IAIGenerationResult> {
    if (!this.provider) {
      this.initialize();
    }
    return this.provider.generateImage(request);
  }
}
