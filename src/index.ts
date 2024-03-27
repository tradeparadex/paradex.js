import { fetchConfig } from "./config";
import { buildStarkKeyTypedData, fromEthSignature } from "./account";

export {
  fetchConfig,
  buildStarkKeyTypedData as getStarkKeyTypedData,
  fromEthSignature,
};
