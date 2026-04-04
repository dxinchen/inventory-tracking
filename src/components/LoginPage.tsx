export default function LoginPage({ onSignIn }: { onSignIn: () => void }) {
  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-brand">
          <span className="nav-brand-name">Inventory</span>
          <span className="nav-brand-tag">Tracker</span>
        </div>
        <p className="login-subtitle">Sign in with your Microsoft 365 account</p>
        <button className="btn btn-primary login-btn" onClick={onSignIn}>
          Sign In
        </button>
      </div>
    </div>
  );
}
