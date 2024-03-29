import * as _Config from './config';
import * as _Account from './account';
import * as _Signer from './ethereum-signer';

export const Config = { fetchConfig: _Config.fetchConfig };

export const Account = { fromEthSigner: _Account.fromEthSigner };

export const Signer = { ethersSignerAdapter: _Signer.ethersSignerAdapter };
