import {
  cre,
  Runner,
  type Runtime,
  type HTTPPayload,
  decodeJson,
  HTTPSendRequester,
} from "@chainlink/cre-sdk";
import type {
  Config,
  AlchemyWebhookPayload,
  Transaction,
  TransactionStore,
} from "./types/types";

function createTransactionStore(addresses: string[]): TransactionStore {
  return {
    watchedAddresses: new Set(addresses.map((addr) => addr.toLowerCase())),
    transactions: new Map(),
  };
}

function isWatchedAddress(
  store: TransactionStore,
  address: string | null,
): boolean {
  if (!address) return false;
  return store.watchedAddresses.has(address.toLowerCase());
}

function saveTransaction(store: TransactionStore, tx: Transaction): void {
  store.transactions.set(tx.hash, tx);
}

const onHttpTrigger = (
  runtime: Runtime<Config>,
  payload: HTTPPayload,
): string => {
  const blockData = decodeJson(payload.input) as AlchemyWebhookPayload;

  if (!blockData.event?.data?.block) {
    runtime.log("Invalid webhook payload: missing block data");
    throw new Error("Error: Invalid webhook payload structure");
  }

  const block = blockData.event.data.block;
  runtime.log(`Processing block ${block.number} | hash=${block.hash}`);

  const store = createTransactionStore(runtime.config.watchedAddresses);

  const processedHashes = new Set<string>();
  const matchedTransactions: Transaction[] = [];

  for (const log of block.logs) {
    const tx = log.transaction;

    if (processedHashes.has(tx.hash)) {
      continue;
    }
    processedHashes.add(tx.hash);

    const toAddress = tx.to?.address || null;
    if (isWatchedAddress(store, toAddress)) {
      runtime.log(
        `Match found! Transaction ${tx.hash} to watched address ${toAddress}`,
      );

      const transaction: Transaction = {
        hash: tx.hash,
        nonce: tx.nonce,
        index: tx.index,
        from: tx.from.address,
        to: toAddress,
        value: tx.value,
        gasPrice: tx.gasPrice,
        gas: tx.gas,
        status: tx.status,
        gasUsed: tx.gasUsed,
        blockNumber: block.number,
        blockHash: block.hash,
        timestamp: block.timestamp,
      };

      saveTransaction(store, transaction);
      matchedTransactions.push(transaction);
    }
  }

  runtime.log(
    `Block processing complete | ` +
      `block=${block.number} | ` +
      `totalLogs=${block.logs.length} | ` +
      `uniqueTransactions=${processedHashes.size} | ` +
      `matchedTransactions=${matchedTransactions.length}`,
  );

  const result = {
    blockNumber: block.number,
    blockHash: block.hash,
    timestamp: block.timestamp,
    totalLogs: block.logs.length,
    uniqueTransactions: processedHashes.size,
    matchedTransactions: matchedTransactions.length,
    transactions: matchedTransactions,
  };

  return JSON.stringify(result, null, 2);
};

const initWorkflow = (config: Config) => {
  const http = new cre.capabilities.HTTPCapability();

  return [cre.handler(http.trigger({}), onHttpTrigger)];
};

export async function main() {
  const runner = await Runner.newRunner<Config>();
  await runner.run(initWorkflow);
}

main();

const fetchAndParse = (
  sendRequester: HTTPSendRequester,
  config: Config,
): PriceData => {
  // 1. Construct the request
  const req = {
    url: config.apiUrl,
    method: "GET" as const,
  };

  // 2. Send the request using the provided sendRequester
  const resp = sendRequester.sendRequest(req).result();

  if (resp.statusCode !== 200) {
    throw new Error(`API returned status ${resp.statusCode}`);
  }

  // 3. Parse the raw JSON into our ExternalApiResponse type
  const bodyText = new TextDecoder().decode(resp.body);
  const externalResp = JSON.parse(bodyText) as ExternalApiResponse;

  // 4. Transform into our internal PriceData type and return
  return {
    price: externalResp.ethereum.usd,
    lastUpdated: new Date(externalResp.ethereum.last_updated_at * 1000),
  };
};
