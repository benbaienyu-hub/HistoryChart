import { useState } from 'react';
import { motion } from 'framer-motion';
import { isValidEmail } from '../lib/auth';
import { logIn, register } from '../lib/api';
import Logo from './Logo';
import ThemeToggle from './ThemeToggle';

const FIELD =
  'w-full rounded-xl border border-line2 bg-panel px-3 py-2.5 text-[14px] text-ink placeholder:text-subink/60 focus:border-accent/50 focus:outline-none focus:ring-2 focus:ring-accent/15';

export default function SignIn({ onSignedIn }) {
  // Two modes rather than two screens: the fields are almost identical, and a
  // separate page would mean losing what you had already typed to switch.
  const [mode, setMode] = useState('login');
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const registering = mode === 'register';

  async function submit(e) {
    e.preventDefault();
    if (!isValidEmail(email)) {
      setError('Enter a valid email address.');
      return;
    }
    if (registering && password.length < 8) {
      setError('Use at least 8 characters for your password.');
      return;
    }
    setError('');
    setBusy(true);
    try {
      const user = registering
        ? await register({ email, name, password })
        : await logIn({ email, password });
      onSignedIn(user);
    } catch (problem) {
      setError(problem.message);
      // The server distinguishes "no account" from "wrong password" internally but
      // deliberately answers the same for both; offering the switch is the useful
      // response either way.
      if (problem.status === 409) setMode('login');
      if (problem.status === 401) setMode('login');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-canvas px-6 py-10">
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
          {registering
            ? 'Create an account to sync your canvases and share them.'
            : 'Map what you know, then let AI fill the gaps.'}
        </p>

        <form onSubmit={submit} className="mt-7 space-y-3">
          <div>
            <label className="mb-1 block text-[12px] font-medium text-subink" htmlFor="email">
              Email
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className={FIELD}
            />
          </div>

          {registering && (
            <div>
              <label className="mb-1 block text-[12px] font-medium text-subink" htmlFor="name">
                Display name <span className="font-normal text-subink/70">(optional)</span>
              </label>
              <input
                id="name"
                autoComplete="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ada Lovelace"
                className={FIELD}
              />
            </div>
          )}

          <div>
            <label className="mb-1 block text-[12px] font-medium text-subink" htmlFor="password">
              Password
            </label>
            <input
              id="password"
              type="password"
              // Tells a password manager whether to offer a saved one or generate
              // a new one — the wrong value here is a real usability bug.
              autoComplete={registering ? 'new-password' : 'current-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={registering ? 'At least 8 characters' : '••••••••'}
              className={FIELD}
            />
          </div>

          {error && <p className="text-[12.5px] text-danger">{error}</p>}

          <motion.button
            type="submit"
            disabled={busy}
            whileHover={{ scale: busy ? 1 : 1.01 }}
            whileTap={{ scale: busy ? 1 : 0.985 }}
            className="w-full rounded-xl bg-accent py-2.5 text-[14px] font-medium text-white shadow-[0_2px_10px_rgba(0,113,227,0.35)] disabled:opacity-60"
          >
            {busy ? 'One moment…' : registering ? 'Create account' : 'Sign in'}
          </motion.button>
        </form>

        <p className="mt-4 text-center text-[12.5px] text-subink">
          {registering ? 'Already have an account?' : 'No account yet?'}{' '}
          <button
            type="button"
            onClick={() => {
              setMode(registering ? 'login' : 'register');
              setError('');
            }}
            className="font-medium text-accent hover:underline"
          >
            {registering ? 'Sign in' : 'Create one'}
          </button>
        </p>

        <p className="mt-6 border-t border-line pt-4 text-[11.5px] leading-snug text-subink/80">
          Your canvases are stored on the server this app is running on, so they follow
          you between browsers and can be shared with other people by email.
        </p>
      </motion.div>
    </div>
  );
}
