import { keyDerivation } from "@starkware-industries/starkware-crypto-utils";
import { CallData, hash } from "starknet";

import type { ParadexConfig } from "./config";

/**
 * Returns the typed data that needs to be signed by an Ethereum
 * wallet in order to generate a Paradex account.
 * @returns The typed data object.
 */
export function buildStarkKeyTypedData(config: ParadexConfig) {
  return {
    domain: {
      name: "Paradex",
      chainId: config.l1_chain_id,
      version: "1",
    },
    primaryType: "Constant",
    types: {
      EIP712Domain: [
        { name: "name", type: "string" },
        { name: "version", type: "string" },
        { name: "chainId", type: "uint256" },
      ],
      Constant: [{ name: "action", type: "string" }],
    },
    message: {
      action: "STARK Key",
    },
  } as const;
}

/**
 * Generates a Paradex account from an Ethereum signature.
 * In order to generate a valid account, the signature must be done
 * on the typed data expected by Paradex with {@link ParadexAccount.getStarkKeyTypedData}.
 * @param signature The Ethereum signature.
 * @returns The generated Paradex account.
 */
export function fromEthSignature(config: ParadexConfig, signature: string) {
  const privateKey = keyDerivation.getPrivateKeyFromEthSignature(signature);
  const publicKey = keyDerivation.privateToStarkKey(privateKey);
  const address = generateAccountAddress({
    publicKey: `0x${publicKey}`,
    accountClassHash: config.paraclear_account_hash,
    accountProxyClassHash: config.paraclear_account_proxy_hash,
  });
  return { address };
}

interface GenerateAccountAddressParams {
  /** The hash of the account contract in hex format */
  readonly accountClassHash: string;
  /** The hash of the account proxy contract in hex format */
  readonly accountProxyClassHash: string;
  /** The public key of the account in hex format */
  readonly publicKey: string;
}

/**
 * Generates an account address based on the account contract and public key.
 */
function generateAccountAddress({
  accountClassHash,
  accountProxyClassHash,
  publicKey,
}: GenerateAccountAddressParams) {
  const callData = CallData.compile({
    implementation: accountClassHash,
    selector: hash.getSelectorFromName("initialize"),
    calldata: CallData.compile({
      signer: publicKey,
      guardian: "0",
    }),
  });

  const address = hash.calculateContractAddressFromHash(
    publicKey,
    accountProxyClassHash,
    callData,
    0
  );

  return address;
}
