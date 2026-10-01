import { useState } from 'react';

export default function Login({ onLoginSuccess, onNavigateToRegister, initialNotice }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState(initialNotice || '');
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!email.trim() || !password.trim()) {
      setError('Please enter both email and password.');
      return;
    }

    setError('');
    setNotice('');
    setIsLoading(true);

    try {
      const res = await fetch('http://localhost:5000/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password }),
      });

      const data = await res.json();

      if (!data.success) {
        setError(data.error || 'Login failed.');
        return;
      }

      // Successful login
      localStorage.setItem('nl_sql_token', data.token);
      onLoginSuccess(data.user, data.token);
    } catch (err) {
      console.error('Login request error:', err);
      setError('Unable to connect to the authentication server.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="w-full max-w-[420px] bg-white border border-slate-200 rounded-2xl shadow-sm p-8 mx-auto">
      <div className="text-center mb-8">
        <h1 className="text-2xl font-bold text-slate-900">Intella</h1>
        <p className="text-sm font-medium text-blue-600 mb-6">AI Database Copilot</p>
        <h2 className="text-xl font-semibold text-slate-800">Welcome back</h2>
        <p className="text-sm text-slate-500 mt-1">Sign in to query and manage your databases.</p>
      </div>

      {notice && !error && (
        <div className="mb-4 p-3 bg-amber-50 border border-amber-200 text-amber-600 text-sm rounded-lg">
          <p>{notice}</p>
        </div>
      )}

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-600 text-sm rounded-lg flex items-start gap-2">
          <span>⚠️</span>
          <p>{error}</p>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="space-y-1.5">
          <label htmlFor="login-email" className="block text-sm font-medium text-slate-700">Email Address</label>
          <input
            id="login-email"
            type="email"
            placeholder="e.g. bharath@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={isLoading}
            required
            className="w-full h-11 px-4 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="login-password" className="block text-sm font-medium text-slate-700">Password</label>
          <input
            id="login-password"
            type="password"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={isLoading}
            required
            className="w-full h-11 px-4 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          />
        </div>

        <button
          type="submit"
          disabled={isLoading}
          className="w-full h-11 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-70 disabled:cursor-not-allowed flex items-center justify-center"
        >
          {isLoading ? 'Signing in...' : 'Sign In'}
        </button>
      </form>

      <div className="mt-6 text-center text-sm text-slate-500">
        <p>
          Don't have an account?{' '}
          <button
            type="button"
            className="text-blue-600 hover:text-blue-700 font-medium hover:underline transition-colors focus:outline-none"
            onClick={onNavigateToRegister}
          >
            Create account
          </button>
        </p>
      </div>
    </div>
  );
}
