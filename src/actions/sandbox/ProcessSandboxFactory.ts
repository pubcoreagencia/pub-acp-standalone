import { ProcessSandboxAdapter, SandboxProviderType } from './types.js';
import { NodeProcessSandbox } from './NodeProcessSandbox.js';
import {
  MacOSSandboxAdapter,
  WindowsSandboxAdapter,
  LinuxSandboxAdapter
} from './PlatformSandboxAdapters.js';

export class ProcessSandboxFactory {
  static create(provider?: SandboxProviderType): ProcessSandboxAdapter {
    switch (provider) {
      case 'macos-sandbox':
        return new MacOSSandboxAdapter();
      case 'windows-sandbox':
        return new WindowsSandboxAdapter();
      case 'linux-sandbox':
        return new LinuxSandboxAdapter();
      case 'node-permission':
      default:
        return new NodeProcessSandbox();
    }
  }

  static getPlatformDefault(): ProcessSandboxAdapter {
    // Default to NodeProcessSandbox which leverages Node modern Permission Model
    return new NodeProcessSandbox();
  }
}
