import * as Starknet from 'starknet';

export function createMockProvider(): Starknet.RpcProvider {
  return new Starknet.RpcProvider({ nodeUrl: 'mock-provider' });
}
