import { useState } from 'react';

export default function Register({ onRegisterSuccess, onNavigateToLogin }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!name.trim() || !email.trim() || !password) {
      setError('Please fill in all fields.');
      return;
    }

    if (password.length < 6) {
      setError('Password must be at least 6 characters long.');
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setError('');
    setIsLoading(true);

    try {
      const res = await fetch('http://localhost:5000/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim(),
          password,
        }),
      });

      const data = await res.json();

      if (!data.success) {
        setError(data.error || 'Registration failed.');
        return;
      }

      // Successful registration
      localStorage.setItem('nl_sql_token', data.token);
      onRegisterSuccess(data.user, data.token);
    } catch (err) {
      console.error('Registration request error:', err);
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
        <h2 className="text-xl font-semibold text-slate-800">Create Account</h2>
        <p className="text-sm text-slate-500 mt-1">Get started with natural language database queries.</p>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-600 text-sm rounded-lg flex items-start gap-2">
          <span>⚠️</span>
          <p>{error}</p>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <label htmlFor="reg-name" className="block text-sm font-medium text-slate-700">Full Name</label>
          <input
            id="reg-name"
            type="text"
            placeholder="e.g. Bharath"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={isLoading}
            required
            className="w-full h-11 px-4 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="reg-email" className="block text-sm font-medium text-slate-700">Email Address</label>
          <input
            id="reg-email"
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
          <label htmlFor="reg-password" className="block text-sm font-medium text-slate-700">Password</label>
          <input
            id="reg-password"
            type="password"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={isLoading}
            required
            className="w-full h-11 px-4 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="reg-confirm-password" className="block text-sm font-medium text-slate-700">Confirm Password</label>
          <input
            id="reg-confirm-password"
            type="password"
            placeholder="••••••••"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            disabled={isLoading}
            required
            className="w-full h-11 px-4 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          />
        </div>

        <button
          type="submit"
          disabled={isLoading}
          className="w-full h-11 mt-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-70 disabled:cursor-not-allowed flex items-center justify-center"
        >
          {isLoading ? 'Creating Account...' : 'Sign Up'}
        </button>
      </form>

      <div className="mt-6 text-center text-sm text-slate-500">
        <p>
          Already have an account?{' '}
          <button
            type="button"
            className="text-blue-600 hover:text-blue-700 font-medium hover:underline transition-colors focus:outline-none"
            onClick={onNavigateToLogin}
          >
            Sign In
          </button>
        </p>
      </div>
    </div>
  );
}
