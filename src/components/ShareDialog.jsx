import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { isValidEmail } from '../lib/auth';
import { shareCanvas, unshareCanvas } from '../lib/api';

export default function ShareDialog({ canvas, currentUser, onClose, onChanged }) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('edit');
  const [error, setError] = useState('');
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);

  const grants = canvas.grants ?? [];
  const isOwner = canvas.role === 'owner';

  async function submit(e) {
    e.preventDefault();
    if (!isValidEmail(email)) {
      setError('Enter a valid email address.');
      return;
    }
    setError('');
    setBusy(true);
    try {
      const result = await shareCanvas(canvas.id, { email, role });
      onChanged(result.canvas);
      setStatus({
        email: email.trim().toLowerCase(),
        // Sharing with an address that has no account yet is allowed — the grant
        // waits for them. But they have to sign up with *that* address, and if we
        // don't say so they'll create an account with a different one and see
        // nothing.
        pending: !result.recipientHasAccount,
      });
      setEmail('');
    } catch (problem) {
      setError(problem.message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(recipient) {
    setBusy(true);
    try {
      onChanged(await unshareCanvas(canvas.id, recipient));
    } catch (problem) {
      setError(problem.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 px-6 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, y: 12, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: 'spring', stiffness: 240, damping: 24 }}
        className="w-full max-w-[440px] rounded-3xl border border-line bg-panel p-6 shadow-[0_24px_64px_-16px_rgba(0,0,0,0.3)]"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-[17px] font-semibold tracking-tight text-ink">Share canvas</h2>
            <p className="mt-0.5 truncate text-[12.5px] text-subink">{canvas.title}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="-mr-1 -mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-subink hover:bg-hover hover:text-ink"
          >
            ×
          </button>
        </div>

        {isOwner ? (
          <form onSubmit={submit} className="mt-5 flex gap-2">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="them@example.com"
              className="min-w-0 flex-1 rounded-xl border border-line2 bg-panel px-3 py-2 text-[13.5px] text-ink placeholder:text-subink/60 focus:border-accent/50 focus:outline-none focus:ring-2 focus:ring-accent/15"
            />
            <select
              value={role}
              onChange={(e) => setRole(e.target.value)}
              aria-label="Access level"
              className="shrink-0 rounded-xl border border-line2 bg-panel px-2 py-2 text-[13px] text-ink focus:border-accent/50 focus:outline-none"
            >
              <option value="edit">Can edit</option>
              <option value="view">Can view</option>
            </select>
            <button
              type="submit"
              disabled={busy}
              className="shrink-0 rounded-xl bg-accent px-4 py-2 text-[13px] font-medium text-white shadow-[0_2px_8px_rgba(0,113,227,0.3)] disabled:opacity-50"
            >
              {busy ? '…' : 'Share'}
            </button>
          </form>
        ) : (
          <p className="mt-5 rounded-xl bg-sunken px-3 py-2.5 text-[12.5px] text-subink">
            {canvas.ownerEmail} owns this canvas. Only they can change who has access.
          </p>
        )}

        {error && <p className="mt-2 text-[12.5px] text-danger">{error}</p>}

        <AnimatePresence>
          {status && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="mt-2 overflow-hidden"
            >
              <p className="text-[12.5px] text-accent">✓ {status.email} now has access.</p>
              {status.pending && (
                <p className="mt-0.5 text-[12px] leading-snug text-subink">
                  They don’t have a Lacuna account yet. It’s waiting for them — they just
                  need to sign up with that exact address.
                </p>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        <div className="mt-5">
          <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-subink/80">
            People with access
          </p>
          <div className="space-y-1.5">
            <div className="flex items-center gap-2.5 rounded-xl bg-sunken px-3 py-2">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent/10 text-[11px] font-semibold text-accent">
                {canvas.ownerEmail.charAt(0).toUpperCase()}
              </span>
              <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink">
                {canvas.ownerEmail}
                {canvas.ownerEmail === currentUser.email && ' (you)'}
              </span>
              <span className="shrink-0 text-[11.5px] text-subink">Owner</span>
            </div>

            {grants.map((grant) => (
              <div
                key={grant.email}
                className="flex items-center gap-2.5 rounded-xl bg-sunken px-3 py-2"
              >
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-black/5 text-[11px] font-semibold text-subink">
                  {grant.email.charAt(0).toUpperCase()}
                </span>
                <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink">
                  {grant.email}
                  {grant.email === currentUser.email && ' (you)'}
                </span>
                <span className="shrink-0 text-[11.5px] text-subink">
                  {grant.role === 'edit' ? 'Can edit' : 'Can view'}
                </span>
                {isOwner && (
                  <button
                    type="button"
                    onClick={() => remove(grant.email)}
                    disabled={busy}
                    className="shrink-0 text-[11.5px] text-subink hover:text-danger disabled:opacity-50"
                  >
                    Remove
                  </button>
                )}
              </div>
            ))}

            {grants.length === 0 && (
              <p className="px-1 text-[12.5px] text-subink">Not shared with anyone yet.</p>
            )}
          </div>
        </div>

        <p className="mt-5 border-t border-line pt-3 text-[11px] leading-snug text-subink/70">
          Access is stored on the server, so it works from any browser. No invite email is
          sent — tell them yourself, and they’ll find it under “Shared with me”.
        </p>
      </motion.div>
    </div>
  );
}
