import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { isValidEmail } from '../lib/auth';
import { shareCanvas, unshareCanvas } from '../lib/canvasStore';
import { sendShareInvite } from '../lib/share';

const REASONS = {
  self: 'That’s your own account.',
  'already-shared': 'Already shared with that address.',
  'not-found': 'That canvas no longer exists.',
};

export default function ShareDialog({ canvas, currentUser, onClose, onChanged }) {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [status, setStatus] = useState(null);
  const [sending, setSending] = useState(false);

  const sharedWith = canvas.sharedWith ?? [];

  async function submit(e) {
    e.preventDefault();
    if (!isValidEmail(email)) {
      setError('Enter a valid email address.');
      return;
    }
    setError('');

    const result = shareCanvas(canvas.id, email);
    if (!result.ok) {
      setError(REASONS[result.reason] ?? 'Could not share.');
      return;
    }

    onChanged();
    setSending(true);
    await sendShareInvite({
      canvasTitle: canvas.title,
      recipientEmail: email,
      fromEmail: currentUser.email,
    });
    setSending(false);
    setStatus({ email: email.trim().toLowerCase() });
    setEmail('');
  }

  function remove(recipient) {
    unshareCanvas(canvas.id, recipient);
    onChanged();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 px-6 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, y: 12, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: 'spring', stiffness: 240, damping: 24 }}
        className="w-full max-w-[420px] rounded-3xl border border-black/5 bg-white p-6 shadow-[0_24px_64px_-16px_rgba(0,0,0,0.3)]"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-[17px] font-semibold tracking-tight text-ink">Share canvas</h2>
            <p className="mt-0.5 truncate text-[12.5px] text-subink">{canvas.title}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="-mr-1 -mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-subink hover:bg-black/5 hover:text-ink"
          >
            ×
          </button>
        </div>

        <form onSubmit={submit} className="mt-5 flex gap-2">
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="teammate@example.com"
            className="min-w-0 flex-1 rounded-xl border border-black/10 bg-white px-3 py-2 text-[13.5px] text-ink placeholder:text-subink/60 focus:border-accent/50 focus:outline-none focus:ring-2 focus:ring-accent/15"
          />
          <button
            type="submit"
            disabled={sending}
            className="shrink-0 rounded-xl bg-accent px-4 py-2 text-[13px] font-medium text-white shadow-[0_2px_8px_rgba(0,113,227,0.3)] disabled:opacity-50"
          >
            {sending ? 'Sharing…' : 'Share'}
          </button>
        </form>

        {error && <p className="mt-2 text-[12.5px] text-red-600">{error}</p>}

        <AnimatePresence>
          {status && (
            <motion.p
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="mt-2 overflow-hidden text-[12.5px] text-accent"
            >
              ✓ {status.email} now has access.
            </motion.p>
          )}
        </AnimatePresence>

        <div className="mt-5">
          <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-subink/80">
            People with access
          </p>
          <div className="space-y-1.5">
            <div className="flex items-center gap-2.5 rounded-xl bg-black/[0.02] px-3 py-2">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent/10 text-[11px] font-semibold text-accent">
                {currentUser.name.charAt(0).toUpperCase()}
              </span>
              <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink">
                {currentUser.email}
              </span>
              <span className="shrink-0 text-[11.5px] text-subink">Owner</span>
            </div>

            {sharedWith.map((recipient) => (
              <div
                key={recipient}
                className="group flex items-center gap-2.5 rounded-xl bg-black/[0.02] px-3 py-2"
              >
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-black/5 text-[11px] font-semibold text-subink">
                  {recipient.charAt(0).toUpperCase()}
                </span>
                <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink">{recipient}</span>
                <button
                  type="button"
                  onClick={() => remove(recipient)}
                  className="shrink-0 text-[11.5px] text-subink hover:text-red-600"
                >
                  Remove
                </button>
              </div>
            ))}

            {sharedWith.length === 0 && (
              <p className="px-1 text-[12.5px] text-subink">Not shared with anyone yet.</p>
            )}
          </div>
        </div>

        <p className="mt-5 border-t border-black/5 pt-3 text-[11px] leading-snug text-subink/70">
          Access is saved in this browser — no invite email is sent yet.
        </p>
      </motion.div>
    </div>
  );
}
