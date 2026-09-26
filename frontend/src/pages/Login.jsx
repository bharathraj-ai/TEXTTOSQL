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
    <div className="auth-container">
      <div className="auth-card">
        <div className="auth-header">
          <div className="auth-icon">🔐</div>
          <h2>Welcome Back</h2>
          <p>Sign in to query and manage your PostgreSQL databases</p>
        </div>

        {notice && !error && (
          <div className="auth-error-alert" style={{ background: 'rgba(243, 156, 18, 0.15)', borderColor: 'rgba(243, 156, 18, 0.5)', color: '#f39c12' }}>
            <span>ℹ️</span>
            <p>{notice}</p>
          </div>
        )}

        {error && (
          <div className="auth-error-alert">
            <span>⚠️</span>
            <p>{error}</p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="auth-form">
          <div className="form-group">
            <label htmlFor="login-email">Email Address</label>
            <input
              id="login-email"
              type="email"
              placeholder="e.g. bharath@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={isLoading}
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="login-password">Password</label>
            <input
              id="login-password"
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={isLoading}
              required
            />
          </div>

          <button
            type="submit"
            className="btn-auth-submit"
            disabled={isLoading}
          >
            {isLoading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>

        <div className="auth-footer">
          <p>
            Don't have an account?{' '}
            <button
              className="text-link-btn"
              onClick={onNavigateToRegister}
            >
              Create Account
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}
