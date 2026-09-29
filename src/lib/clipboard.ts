"use client";

/**
 * Copies `text` to the clipboard; resolves to whether it worked. Call it
 * straight from a click handler — browsers only allow clipboard writes in
 * response to one.
 *
 * Tries the old synchronous execCommand("copy") first, on purpose: it runs
 * while the click still counts, whereas after a refused (async) Clipboard API
 * call a browser may no longer treat a follow-up as part of the click — seen
 * in testing, where that order sometimes copied nothing. It also works over
 * plain HTTP (e.g. the dev server opened from a phone via this machine's LAN
 * address), where the Clipboard API doesn't exist. The Clipboard API is the
 * backup, for a browser that has dropped execCommand.
 */
export async function copyText(text: string): Promise<boolean> {
  if (copyWithExecCommand(text)) return true;
  if (!navigator.clipboard) return false;
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function copyWithExecCommand(text: string): boolean {
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  // Off-screen, and not font-size < 16px, so iOS doesn't zoom to it.
  Object.assign(textarea.style, { position: "fixed", top: "-1000px", fontSize: "16px" });
  document.body.appendChild(textarea);
  const previousFocus = document.activeElement as HTMLElement | null;
  textarea.select();
  let copied = false;
  try {
    copied = document.execCommand("copy");
  } catch {
    copied = false;
  }
  textarea.remove();
  previousFocus?.focus?.();
  return copied;
}
