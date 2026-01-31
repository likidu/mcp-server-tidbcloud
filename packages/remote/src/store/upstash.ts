/**
 * Upstash Redis Store Implementation
 *
 * Uses Upstash Redis for storing OAuth state and authorization codes.
 * Works on Vercel, Cloudflare Workers, and other serverless platforms.
 */

import { Redis } from "@upstash/redis";
import type { OAuthStore, AuthorizationState, AuthorizationCode } from "./types.js";

const STATE_PREFIX = "oauth:state:";
const CODE_PREFIX = "oauth:code:";

export class UpstashStore implements OAuthStore {
  private redis: Redis;

  constructor() {
    // Upstash Redis uses these environment variables by default
    this.redis = Redis.fromEnv();
  }

  async setState(key: string, data: AuthorizationState, ttlSeconds: number): Promise<void> {
    await this.redis.set(`${STATE_PREFIX}${key}`, JSON.stringify(data), {
      ex: ttlSeconds,
    });
  }

  async getState(key: string): Promise<AuthorizationState | null> {
    const data = await this.redis.get<string>(`${STATE_PREFIX}${key}`);
    if (!data) return null;

    try {
      return typeof data === "string" ? JSON.parse(data) : data;
    } catch {
      return null;
    }
  }

  async deleteState(key: string): Promise<void> {
    await this.redis.del(`${STATE_PREFIX}${key}`);
  }

  async setCode(key: string, data: AuthorizationCode, ttlSeconds: number): Promise<void> {
    await this.redis.set(`${CODE_PREFIX}${key}`, JSON.stringify(data), {
      ex: ttlSeconds,
    });
  }

  async getAndDeleteCode(key: string): Promise<AuthorizationCode | null> {
    const fullKey = `${CODE_PREFIX}${key}`;

    // Get and delete atomically using a transaction
    const data = await this.redis.get<string>(fullKey);
    if (!data) return null;

    // Delete the code (one-time use)
    await this.redis.del(fullKey);

    try {
      return typeof data === "string" ? JSON.parse(data) : data;
    } catch {
      return null;
    }
  }
}

// Singleton instance
let storeInstance: UpstashStore | null = null;

export function getStore(): OAuthStore {
  if (!storeInstance) {
    storeInstance = new UpstashStore();
  }
  return storeInstance;
}
