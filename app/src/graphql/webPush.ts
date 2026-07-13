/**
 * Web-push registration operations (D-#296) — the browser half of push.
 * Write-only surface: subscriptions are never readable back.
 */
import { gql } from "urql";

export const WEB_PUSH_PUBLIC_KEY = gql<{ webPushPublicKey: string | null }, Record<string, never>>`
  query WebPushPublicKey {
    webPushPublicKey
  }
`;

export const REGISTER_WEB_PUSH = gql<
  { registerWebPush: boolean },
  { endpoint: string; p256dh: string; auth: string; userAgent?: string | null }
>`
  mutation RegisterWebPush($endpoint: String!, $p256dh: String!, $auth: String!, $userAgent: String) {
    registerWebPush(endpoint: $endpoint, p256dh: $p256dh, auth: $auth, userAgent: $userAgent)
  }
`;

export const UNREGISTER_WEB_PUSH = gql<{ unregisterWebPush: boolean }, { endpoint: string }>`
  mutation UnregisterWebPush($endpoint: String!) {
    unregisterWebPush(endpoint: $endpoint)
  }
`;
