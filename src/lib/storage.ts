"use client";

import { nanoid } from "nanoid";

const DISPLAY_NAME_KEY = "agility:name";

export function adminTokenKey(code: string) {
  return `agility:admin:${code.toUpperCase()}`;
}

export function displayNameKey(code: string) {
  return `agility:displayName:${code.toUpperCase()}`;
}

export function clientIdKey(code: string) {
  return `agility:client:${code.toUpperCase()}`;
}

/**
 * A stable per-browser, per-room identity. Sent on every join so a refresh
 * or reconnect reactivates the same roster entry instead of appearing as a
 * new person — this is what lets the room show who has joined versus who is
 * currently connected.
 */
export function getOrCreateClientId(code: string): string {
  if (typeof window === "undefined") return "";
  const key = clientIdKey(code);
  let id = localStorage.getItem(key);
  if (!id) {
    // Not crypto.randomUUID(): that's gated behind a "secure context" (HTTPS,
    // or the localhost exemption), so it throws when the app is reached over
    // plain HTTP via a LAN IP (e.g. testing from a phone). nanoid uses
    // crypto.getRandomValues(), which has no such restriction.
    id = nanoid();
    localStorage.setItem(key, id);
  }
  return id;
}

export function getStoredAdminToken(code: string): string | undefined {
  if (typeof window === "undefined") return undefined;
  return localStorage.getItem(adminTokenKey(code)) || undefined;
}

export function setStoredAdminToken(code: string, token: string) {
  if (typeof window === "undefined") return;
  localStorage.setItem(adminTokenKey(code), token);
}

export function getSessionDisplayName(code: string): string | undefined {
  if (typeof window === "undefined") return undefined;
  return sessionStorage.getItem(displayNameKey(code)) || undefined;
}

export function setSessionDisplayName(code: string, name: string) {
  if (typeof window === "undefined") return;
  sessionStorage.setItem(displayNameKey(code), name);
  localStorage.setItem(DISPLAY_NAME_KEY, name);
}

export function getLastUsedDisplayName(): string {
  if (typeof window === "undefined") return "";
  return localStorage.getItem(DISPLAY_NAME_KEY) || "";
}
