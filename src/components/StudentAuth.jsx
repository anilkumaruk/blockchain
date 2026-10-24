import { useState } from 'react';
import { GraduationCap, Lock, UserPlus } from 'lucide-react';
import Spinner from './Spinner';
import { useToast } from '../context/ToastContext';
import { registerStudent, studentLogin } from '../lib/api';

const INPUT =
  'w-full rounded-md border border-border bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-teal/30 focus:border-teal';

/**
 * Student sign-in and sign-up with a personal email. Sign-up only works for
 * an email the student's institution has on record, so nobody can create an
 * account that shows someone else's credentials.
 */
export default function StudentAuth({ onSignedIn }) {
  const { notify } = useToast();
  const [mode, setMode] = useState('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const switchMode = (next) => {
    setMode(next);
    setError('');
    setConfirm('');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!email.trim() || !password) return setError('Enter your email and password.');
    if (mode === 'signup') {
      if (password.length < 8) return setError('Use at least 8 characters for your password.');
      if (password !== confirm) return setError('The two passwords do not match.');
    }
    setLoading(true);
    try {
      if (mode === 'signup') {
        const res = await registerStudent(email.trim(), password);
        notify(`Account created for ${res.fullName}.`, 'success');
      }
      const session = await studentLogin(email.trim(), password);
      onSignedIn(session);
    } catch (err) {
      setError(err.message || 'Something went wrong.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-[calc(100vh-8rem)] flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm bg-card border border-border rounded-lg card-shadow p-7">
        <div className="w-11 h-11 rounded-lg bg-teal-soft flex items-center justify-center mb-4">
          <GraduationCap size={22} className="text-teal" />
        </div>
        <h1 className="text-lg font-semibold mb-1">Student portal</h1>
        <p className="text-sm text-ink-soft mb-5">
          {mode === 'signin'
            ? 'Sign in with your personal email to view and share your verified credentials.'
            : 'Use the personal email your institution has on record for you.'}
        </p>

        <div className="flex gap-1 bg-bg rounded-md p-1 mb-5" role="tablist">
          {[
            ['signin', 'Sign in'],
            ['signup', 'Create account'],
          ].map(([key, label]) => (
            <button
              key={key}
              role="tab"
              aria-selected={mode === key}
              onClick={() => switchMode(key)}
              className={`flex-1 text-sm font-medium rounded py-1.5 ${
                mode === key ? 'bg-white text-ink card-shadow' : 'text-ink-soft hover:text-ink'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit} className="space-y-3.5">
          <div>
            <label htmlFor="student-email" className="block text-xs font-medium text-ink-soft mb-1.5">
              Personal email
            </label>
            <input
              id="student-email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@gmail.com"
              className={INPUT}
            />
          </div>
          <div>
            <label htmlFor="student-password" className="block text-xs font-medium text-ink-soft mb-1.5">
              Password
            </label>
            <input
              id="student-password"
              type="password"
              autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={mode === 'signup' ? 'At least 8 characters' : '••••••••'}
              className={INPUT}
            />
          </div>
          {mode === 'signup' && (
            <div>
              <label htmlFor="student-confirm" className="block text-xs font-medium text-ink-soft mb-1.5">
                Confirm password
              </label>
              <input
                id="student-confirm"
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className={INPUT}
              />
            </div>
          )}
          {error && <p className="text-xs text-invalid">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full flex items-center justify-center gap-2 bg-teal text-white text-sm font-medium rounded-md py-2.5 hover:bg-teal/90 disabled:opacity-60"
          >
            {loading ? <Spinner size={15} /> : mode === 'signin' ? <Lock size={15} /> : <UserPlus size={15} />}
            {loading ? 'Please wait…' : mode === 'signin' ? 'Sign in' : 'Create account'}
          </button>
        </form>
      </div>
    </div>
  );
}
