import { useState } from 'react';
import { motion } from 'framer-motion';
import { isValidEmail, listUsers, signIn } from '../lib/auth';
import Logo from './Logo';
import ThemeToggle from './ThemeToggle';

export default function SignIn({ onSignedIn }) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const recent = listUsers().slice(-3).reverse();

  function submit(e) {
    e.preventDefault();
    if (!isValidEmail(email)) {
      setError('Enter a valid email address.');
      return;
    }
    setError('');
    onSignedIn(signIn({ email, name }));
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-canvas px-6">
      <div className="absolute right-5 top-5">
        <ThemeToggle />
      </div>
      <motion.div
        initial={{ opacity: 0, y: 16, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: 'spring', stiffness: 220, damping: 24 }}
        className="w-full max-w-[380px] rounded-3xl border border-line bg-surface p-8 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_24px_48px_-16px_rgba(0,0,0,0.18)] backdrop-blur-xl"
      >
        <div className="flex flex-col items-center gap-2.5">
          <Logo size={40} className="text-accent" label="Lacuna" />
          <h1 className="text-[26px] font-semibold tracking-tight text-ink">Lacuna</h1>
        </div>
        <p className="mt-1.5 text-center text-[13.5px] leading-snug text-subink">
          Map what you know, then let AI fill the gaps.
        </p>

        <form onSubmit={submit} className="mt-7 space-y-3">
          <div>
            <label className="mb-1 block text-[12px] font-medium text-subink" htmlFor="email">
              Email
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-full rounded-xl border border-line2 bg-panel px-3 py-2.5 text-[14px] text-ink placeholder:text-subink/60 focus:border-accent/50 focus:outline-none focus:ring-2 focus:ring-accent/15"
            />
          </div>

          <div>
            <label className="mb-1 block text-[12px] font-medium text-subink" htmlFor="name">
              Display name <span className="font-normal text-subink/70">(optional)</span>
            </label>
            <input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ada Lovelace"
              className="w-full rounded-xl border border-line2 bg-panel px-3 py-2.5 text-[14px] text-ink placeholder:text-subink/60 focus:border-accent/50 focus:outline-none focus:ring-2 focus:ring-accent/15"
            />
          </div>

          {error && <p className="text-[12.5px] text-danger">{error}</p>}

          <motion.button
            type="submit"
            whileHover={{ scale: 1.01 }}
            whileTap={{ scale: 0.985 }}
            className="w-full rounded-xl bg-accent py-2.5 text-[14px] font-medium text-white shadow-[0_2px_10px_rgba(0,113,227,0.35)]"
          >
            Continue
          </motion.button>
        </form>

        {recent.length > 0 && (
          <div className="mt-5">
            <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-subink/80">
              Recent on this device
            </p>
            <div className="space-y-1.5">
              {recent.map((u) => (
                <button
                  key={u.email}
                  type="button"
                  onClick={() => onSignedIn(signIn({ email: u.email }))}
                  className="flex w-full items-center gap-2.5 rounded-xl border border-line bg-sunken px-3 py-2 text-left hover:bg-hover"
                >
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent/10 text-[12px] font-semibold text-accent">
                    {u.name.charAt(0).toUpperCase()}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium text-ink">{u.name}</span>
                    <span className="block truncate text-[11.5px] text-subink">{u.email}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        <p className="mt-6 border-t border-line pt-4 text-[11.5px] leading-snug text-subink/80">
          Local profile only — no password, no server. Your canvases are stored in this
          browser, so they aren’t synced across devices.
        </p>
      </motion.div>
    </div>
  );
}
