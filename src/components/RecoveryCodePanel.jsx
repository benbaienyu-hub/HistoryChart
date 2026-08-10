import { useState } from 'react';

// The one screen in the app that shows a secret. It exists because there is no
// email out of here: if this code is not written down now, a forgotten password
// means asking whoever runs the server to edit a JSON file by hand.
//
// So it is deliberately hard to skip past — the button says what it is agreeing
// to, and copying is one click rather than a careful selection.
export default function RecoveryCodePanel({ code, onDone, doneLabel = 'I’ve saved it' }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Denied clipboard permission, or an insecure origin. The code is on screen
      // and selectable, so this is a small loss and not worth an error message.
    }
  }

  return (
    <div className="rounded-2xl border border-warn-line bg-warn-bg p-4">
      <p className="text-[13px] font-semibold text-ink">Your recovery code</p>
      <p className="mt-1 text-[12.5px] leading-snug text-subink">
        Write this down or save it in a password manager. It is the only way back into your
        account if you forget your password — nobody can email you a reset link.
      </p>

      {/* Its own full-width row, and nowrap: a code broken across two lines is
          harder to read back, and reading it back is the whole job. */}
      <code className="mt-3 block select-all overflow-x-auto whitespace-nowrap rounded-xl border border-line2 bg-panel px-3 py-2.5 text-center text-[14px] font-semibold tracking-[0.06em] text-ink">
        {code}
      </code>

      <div className="mt-2 flex gap-2">
        <button
          type="button"
          onClick={copy}
          className="shrink-0 rounded-xl border border-line2 px-3 py-2.5 text-[12.5px] text-subink hover:bg-hover hover:text-ink"
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
        {onDone && (
          <button
            type="button"
            onClick={onDone}
            className="flex-1 rounded-xl bg-accent py-2.5 text-[13.5px] font-medium text-white"
          >
            {doneLabel}
          </button>
        )}
      </div>
    </div>
  );
}
