import { useEffect, useState } from 'react';
import { Link, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import Dashboard from './pages/Dashboard';
import ContractDetailPage from './pages/ContractDetailPage';
import UploadPage from './pages/UploadPage';
import ReferenceDataPage from './pages/ReferenceDataPage';
import DstTransferTaxPage from './pages/DstTransferTaxPage';
import LoginPage from './pages/LoginPage';
import { checkAuth, logout, setUnauthorizedHandler } from './api/client';

// Two separate modules, each with its own sub-nav — "DST & Transfer Tax
// Review" is a distinct tool from the CWT Portal (contracts/ledgers/zonal
// lookups), not just another page alongside it.
const DST_TRANSFER_TAX_PREFIX = '/dst-transfer-tax';

function App() {
  const [authState, setAuthState] = useState<'checking' | 'in' | 'out'>('checking');
  const location = useLocation();

  useEffect(() => {
    setUnauthorizedHandler(() => setAuthState('out'));
    checkAuth().then((ok) => setAuthState(ok ? 'in' : 'out'));
  }, []);

  async function handleLogout() {
    await logout();
    setAuthState('out');
  }

  if (authState === 'checking') return null;
  if (authState === 'out') return <LoginPage onSuccess={() => setAuthState('in')} />;

  const inDstModule = location.pathname.startsWith(DST_TRANSFER_TAX_PREFIX);

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-modules">
          <Link to="/" className={inDstModule ? undefined : 'active'}>
            CWT Portal
          </Link>
          <Link to={DST_TRANSFER_TAX_PREFIX} className={inDstModule ? 'active' : undefined}>
            DST &amp; Transfer Tax Review
          </Link>
        </div>
        <button className="btn btn-secondary" onClick={handleLogout} style={{ marginLeft: 'auto' }}>
          Log Out
        </button>
      </header>
      <div className="app-subheader">
        {inDstModule ? (
          <nav>
            <NavLink to={DST_TRANSFER_TAX_PREFIX} end>
              DST &amp; Transfer Tax Review
            </NavLink>
          </nav>
        ) : (
          <nav>
            <NavLink to="/" end>
              Dashboard
            </NavLink>
            <NavLink to="/upload">Upload Contracts</NavLink>
            <NavLink to="/reference">Reference Data</NavLink>
          </nav>
        )}
      </div>
      <main className="app-main">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/contracts/:contractNumber" element={<ContractDetailPage />} />
          <Route path="/upload" element={<UploadPage />} />
          <Route path="/reference" element={<ReferenceDataPage />} />
          <Route path={DST_TRANSFER_TAX_PREFIX} element={<DstTransferTaxPage />} />
        </Routes>
      </main>
    </div>
  );
}

export default App;
