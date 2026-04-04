import { BrowserRouter, Routes, Route, NavLink, Navigate } from 'react-router-dom';
import { InventoryProvider } from './context/InventoryContext';
import ErrorBoundary from './components/ErrorBoundary';
// import LoginPage from './components/LoginPage';
// TODO: When MSAL is configured, import useAuth and gate the app:
//   import { useAuth } from './auth/useAuth';
//   const { isAuthenticated, login } = useAuth();
//   if (!isAuthenticated) return <LoginPage onSignIn={login} />;
import Dashboard from './pages/Dashboard';
import InventoryList from './pages/InventoryList';
import NewItem from './pages/NewItem';
import ItemDetail from './pages/ItemDetail';
import StockForm from './pages/StockForm';
import Export from './pages/Export';
import Import from './pages/Import';

function NavBar() {
  return (
    <nav className="nav-bar">
      <NavLink to="/" className="nav-brand">
        <span className="nav-brand-name">Inventory</span>
        <span className="nav-brand-tag">Tracker</span>
      </NavLink>

      <ul className="nav-links">
        <li>
          <NavLink to="/" end className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
            Dashboard
          </NavLink>
        </li>
        <li>
          <NavLink to="/inventory" className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
            Inventory
          </NavLink>
        </li>
        <li>
          <NavLink to="/stock" className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
            Stock In/Out
          </NavLink>
        </li>
        <li>
          <NavLink to="/import" className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
            Import
          </NavLink>
        </li>
        <li>
          <NavLink to="/export" className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
            Export
          </NavLink>
        </li>
      </ul>

      <div className="nav-user">
        <span className="nav-user-name">d.chen@biolabs.com</span>
        <div className="nav-user-avatar">DC</div>
      </div>
    </nav>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <ErrorBoundary>
        <InventoryProvider>
          <NavBar />
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/inventory" element={<InventoryList />} />
            <Route path="/inventory/new" element={<NewItem />} />
            <Route path="/inventory/:id" element={<ItemDetail />} />
            <Route path="/stock" element={<StockForm />} />
            <Route path="/import" element={<Import />} />
            <Route path="/export" element={<Export />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </InventoryProvider>
      </ErrorBoundary>
    </BrowserRouter>
  );
}
