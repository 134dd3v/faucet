import Redis from "ioredis"; // Redis
import { getSession } from "next-auth/client"; // Session management
import type { NextApiRequest, NextApiResponse } from "next"; // Types

// Setup redis client
const client = new Redis(process.env.REDIS_URL);

/**
 * Checks if a twitter id has claimed from faucet in last 24h
 * @param {string} twitter_id to check
 * @returns {Promise<boolean>} claim status
 */
export async function hasClaimed(twitter_id: string): Promise<boolean> {
  // Check if key exists
  const resp: string | null = await client.get(twitter_id);
  // If exists, return true, else return false
  return resp ? true : false;
}

export async function getTTL(twitter_id: string): Promise<number> {
  return await client.ttl(twitter_id);;
}

export default async (req: NextApiRequest, res: NextApiResponse) => {
  // Collect session (force any for extra twitter params)
  const session: any = await getSession({ req });

  if (session) {
    try {
      // Collect claim status
      const claimed: boolean = await hasClaimed(session.twitter_id);
      res.status(200).send({ claimed });
    } catch {
      // If failure, return error checking status
      res.status(500).send({ error: "Error checking claim status." });
    }
  } else {
    // Return unauthed status
    res.status(401).send({ error: "Not authenticated." });
  }
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