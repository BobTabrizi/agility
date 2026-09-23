"use client";

import { useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Modal } from "@/components/Modal";

export function InviteModal({ url, onClose }: { url: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard unavailable — no-op
    }
  }

  return (
    <Modal title="Invite to room" onClose={onClose}>
      <div className="flex flex-col items-center gap-4">
        <div className="rounded-xl border border-neutral-200 bg-white p-3 dark:border-neutral-800">
          <QRCodeSVG value={url} size={180} marginSize={0} />
        </div>
        <p className="w-full truncate rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-center text-sm text-neutral-600 dark:border-neutral-800 dark:bg-neutral-800 dark:text-neutral-300">
          {url}
        </p>
        <button
          onClick={copyLink}
          className="w-full rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500"
        >
          {copied ? "Copied!" : "Copy link"}
        </button>
      </div>
    </Modal>
  );
}
