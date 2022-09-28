import Redis from "ioredis"; // Redis
import { ethers } from "ethers"; // Ethers
import { WebClient } from "@slack/web-api"; // Slack
import { isValidInput } from "pages/index"; // Address check
import parseTwitterDate from "utils/dates"; // Parse Twitter dates
import { getSession } from "next-auth/client"; // Session management
import { hasClaimed } from "pages/api/claim/status"; // Claim status
import type { NextApiRequest, NextApiResponse } from "next"; // Types
import {
  ERC20PresetMinterPauser__factory,
  // core,
  // tricryptoVault,
  tokens,
  parseUsdc,
  formatUsdc,
} from "@ragetrade/sdk";
import { formatEther, parseEther, parseUnits } from "ethers/lib/utils";

// Setup whitelist (Anish)
const whitelist: string[] = ["1466805048709578755"];

// Setup redis client
const client = new Redis(process.env.REDIS_URL);

// Setup slack client
const slack = new WebClient(process.env.SLACK_ACCESS_TOKEN);
const slackChannel: string = process.env.SLACK_CHANNEL ?? "";
/**
 * Post message to slack channel
 * @param {string} message to post
 */
async function postSlackMessage(message: string): Promise<void> {
  // Temporarily disabled posting of slack messages
  // await slack.chat.postMessage({
  //   channel: slackChannel,
  //   text: message,
  //   // Ping user on error
  //   link_names: true,
  // });
}

/**
 * Generate Alchemy RPC endpoint url from partials
 * @param {string} partial of network
 * @returns {string} full rpc url
 */
function generateAlchemy(partial: string): string {
  // Combine partial + API key
  return `https://${partial}/v2/${process.env.ALCHEMY_API_KEY}`;
}

// Setup networks
const ARBITRUM: number = 421611;
const mainRpcNetworks: Record<number, string | string[]> = {
  3: generateAlchemy("eth-ropsten.alchemyapi.io"),
  4: generateAlchemy("eth-rinkeby.alchemyapi.io"),
  5: generateAlchemy("eth-goerli.alchemyapi.io"),
  2: generateAlchemy("eth-kovan.alchemyapi.io"),
};
const secondaryRpcNetworks: Record<number, string | string[]> = {
  69: generateAlchemy("opt-kovan.g.alchemy.com"),
  1287: "https://rpc.api.moonbase.moonbeam.network",
  80001: generateAlchemy("polygon-mumbai.g.alchemy.com"),
  421611: [
    generateAlchemy("arb-rinkeby.g.alchemy.com"),
    "https://rinkeby.arbitrum.io/rpc",
  ],
  421613: [
    generateAlchemy("arb-goerli.g.alchemy.com"),
    "https://goerli-rollup.arbitrum.io/rpc",
  ],
  //43113: "https://api.avax-test.network/ext/bc/C/rpc",
};

// Setup faucet interface
const iface = new ethers.utils.Interface([
  "function drip(address _recipient) external",
]);

/**
 * Generates tx input data for drip claim
 * @param {string} recipient address
 * @returns {string} encoded input data
 */
function generateTxData(recipient: string): string {
  // Encode address for drip function
  return iface.encodeFunctionData("drip", [recipient]);
}

/**
 * Collects StaticJsonRpcProvider by network
 * @param {number} network id
 * @returns {ethers.providers.StaticJsonRpcProvider} provider
 */
function getProviderByNetwork(network: number): ethers.providers.Provider {
  // Collect all RPC URLs
  const rpcNetworks = { ...mainRpcNetworks, ...secondaryRpcNetworks };
  // Collect alchemy RPC URL
  const rpcUrl = rpcNetworks[network];
  if (Array.isArray(rpcUrl)) {
    return new ethers.providers.FallbackProvider(
      rpcUrl.map((r) => new ethers.providers.StaticJsonRpcProvider(r))
    );
  } else {
    // Return static provider
    return new ethers.providers.StaticJsonRpcProvider(rpcUrl);
  }
}

/**
 * Collects nonce by network (cache first)
 * @param {number} network id
 * @returns {Promise<number>} network account nonce
 */
async function getNonceByNetwork(network: number): Promise<number> {
  // Collect nonce from redis
  const redisNonce: string | null = await client.get(`nonce-${network}`);

  // If no redis nonce
  if (redisNonce == null) {
    // Update to last network nonce
    const provider = getProviderByNetwork(network);
    return await provider.getTransactionCount(
      // Collect nonce for operator
      process.env.NEXT_PUBLIC_OPERATOR_ADDRESS ?? ""
    );
  } else {
    // Else, return cached nonce
    return Number(redisNonce);
  }
}

/**
 * Returns populated drip transaction for a network
 * @param {ethers.Wallet} wallet without RPC network connected
 * @param {number} network id
 * @param {string} data input for tx
 */
async function processDrip(
  wallet: ethers.Wallet,
  network: number,
  data: string,
  addr: string
): Promise<void> {
  // Collect provider
  const provider = getProviderByNetwork(network);

  // Connect wallet to network
  const rpcWallet = wallet.connect(provider);
  // Collect nonce for network
  const nonce = await getNonceByNetwork(network);
  // Collect gas price * 2 for network
  const gasPrice = (await provider.getGasPrice()).mul(2);

  const gasLimit = network === ARBITRUM ? 5_000_000 : 500_000;

  // Update nonce for network in redis w/ 5m ttl
  await client.set(`nonce-${network}`, nonce + 6, "EX", 300);

  // Return populated transaction
  let stage = ''
  try {
    const { usdc, wbtc, usdt, weth, crv3, sGLP } = await tokens.getContracts(rpcWallet);
    
    stage = 'usdc'
    await usdc.transfer(addr, parseUsdc("1000000"), {
      nonce: nonce + 0,
      gasPrice,
    });
    
    stage = 'usdt'
    await usdt.transfer(addr, parseUsdc("1000000"), {
      nonce: nonce + 1,
      gasPrice,
    });
    
    stage = 'weth'
    await usdc.attach(weth.address).transfer(addr, parseEther("300"), {
      nonce: nonce + 2,
      gasPrice,
    });

    stage = 'wbtc'
    await wbtc.transfer(addr, parseUnits("25", 8), {
      nonce: nonce + 3,
      gasPrice,
    });

    stage = 'crv3'
    await crv3.transfer(addr, parseUnits("10000", 18), {
      nonce: nonce + 4,
      gasPrice,
    });

    stage = 'sGLP'
    await sGLP.transfer(addr, parseUnits("1000", 18), {
      nonce: nonce + 5,
      gasPrice,
    });

    stage = 'ETH'
    await rpcWallet.sendTransaction({
      to: addr,
      value: parseEther("0.0005"),
      gasPrice,
      gasLimit,
      nonce: nonce + 6,
    });
  } catch (e) {
    console.log(e);
    // await postSlackMessage(
    //   `@anish Error dripping for ${provider.network.chainId}, ${String(
    //     (e as any).reason
    //   )}`
    // );
    const err = new Error(`Error when processing drip for network ${network}. Stage: ${stage} transfer failed.`);
    // @ts-ignore
    err.actualError = e;
    throw err;
  }
}

export default async (req: NextApiRequest, res: NextApiResponse) => {
  // Collect session (force any for extra twitter params)
  const session: any = await getSession({ req });
  // Collect address
  const { address, others }: { address: string; others: boolean } = req.body;

  if (!session) {
    // Return unauthed status
    return res.status(401).send({ error: "Not authenticated." });
  }

  // Basic anti-bot measures
  const ONE_MONTH_SECONDS = 2629746;
  if (
    // Less than 1 tweet
    session.twitter_num_tweets == 0 ||
    // Less than 15 followers
    session.twitter_num_followers < 15 ||
    // Less than 1 month old
    new Date().getTime() -
      parseTwitterDate(session.twitter_created_at).getTime() <
      ONE_MONTH_SECONDS
  ) {
    // Return invalid Twitter account status
    return res
      .status(400)
      .send({ error: "Twitter account does not pass anti-bot checks." });
  }

  if (!address || !isValidInput(address)) {
    // Return invalid address status
    return res.status(400).send({ error: "Invalid address." });
  }

  // Collect address
  let addr: string = address;
  // If address is ENS name
  if (~address.toLowerCase().indexOf(".eth")) {
    // Setup custom mainnet provider
    const provider = new ethers.providers.StaticJsonRpcProvider(
      `https://eth-mainnet.alchemyapi.io/v2/${process.env.ALCHEMY_API_KEY}`
    );

    // Collect 0x address from ENS
    const resolvedAddress = await provider.resolveName(address);

    // If no resolver set
    if (!resolvedAddress) {
      // Return invalid ENS status
      return res
        .status(400)
        .send({ error: "Invalid ENS name. No reverse record." });
    }

    // Else, set address
    addr = resolvedAddress;
  }

  const claimed: boolean = await hasClaimed(session.twitter_id);  
  if (claimed) {
    // Return already claimed status
    const time = await client.ttl(session.twitter_id);
    return res.status(400).send({ error: `Please try after ${showSecondsRemaining(time)}` });
  }

  // Setup wallet w/o RPC provider
  const wallet = new ethers.Wallet(process.env.OPERATOR_PRIVATE_KEY ?? "");

  // Generate transaction data
  const data: string = generateTxData(addr);

  // Networks to claim on (based on others toggle)
  const otherNetworks: Record<number, string | string[]> = others
    ? secondaryRpcNetworks
    : {};
  const claimNetworks: Record<number, string | string[]> = {
    ...mainRpcNetworks,
    ...otherNetworks,
  };

  // For each main network
  // for (const networkId of Object.keys(claimNetworks)) {
  try {
    // Process faucet claims for Arbitrum Testnet
    await processDrip(wallet, 421613, data, addr);
  } catch (e) {
    // If not whitelisted, force user to wait 15 minutes
    if (!whitelist.includes(session.twitter_id)) {
      // Update 24h claim status
      await client.set(session.twitter_id, "true", "EX", 2 * 60);
    }

    // If error in process, revert
    return res.status(500).send({
      error: "Error fully claiming, try again in 2 minutes." + (e as any).message,
      actualError: (e as any).actualError.message,
    });
  }
  // }

  // If not whitelisted
  if (!whitelist.includes(session.twitter_id)) {
    // Update 24h claim status
    await client.set(session.twitter_id, "true", "EX", 86400);
  }

  return res.status(200).send({ claimed: address });
};

export function showSecondsRemaining(input: number): string {
  const days = Math.floor(input / 60 / 60 / 24);
  const hours = Math.floor((input - days * 60 * 60 * 24) / 60 / 60);
  const minutes = Math.floor((input - days * 60 * 60 * 24 - hours * 60 * 60) / 60);
  const seconds = input - days * 60 * 60 * 24 - hours * 60 * 60 - minutes * 60;

  return `${days !== 0 ? `${days} days, ` : ''}${hours !== 0 ? `${hours} hours, ` : ''}${
    minutes !== 0 ? `${minutes} minutes and ` : ''
  }${seconds} seconds`;
}