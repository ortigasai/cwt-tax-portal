import { useEffect, useState } from 'react';
import { Link, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import Dashboard from './pages/Dashboard';
import ContractDetailPage from './pages/ContractDetailPage';
import UploadPage from './pages/UploadPage';
import EtbCalculatorPage from './pages/EtbCalculatorPage';
import EtbDashboardPage from './pages/EtbDashboardPage';
import OnettDashboardPage from './pages/OnettDashboardPage';
import OnettUploadPage from './pages/OnettUploadPage';
import ReferenceDataPage from './pages/ReferenceDataPage';
import DstTransferTaxPage from './pages/DstTransferTaxPage';
import LoginPage from './pages/LoginPage';
import Icon from './components/Icon';
import { checkAuth, logout, setUnauthorizedHandler } from './api/client';

// Four separate modules, each with its own sub-nav — "DST & Transfer Tax
// Review" and the "ETB Calculator" are distinct tools from the CWT Portal
// (contracts/ledgers/zonal lookups), not just more pages alongside it.
const DST_TRANSFER_TAX_PREFIX = '/dst-transfer-tax';
const ETB_PREFIX = '/etb';
const ONETT_PREFIX = '/onett';

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

  if (authState === 'checking') {
    return (
      <div className="loading" style={{ minHeight: '100vh' }}>
        <span className="spinner" /> Loading…
      </div>
    );
  }
  if (authState === 'out') return <LoginPage onSuccess={() => setAuthState('in')} />;

  const inDstModule = location.pathname.startsWith(DST_TRANSFER_TAX_PREFIX);
  const inEtbModule = location.pathname.startsWith(ETB_PREFIX);
  const inOnettModule = location.pathname.startsWith(ONETT_PREFIX);
  const inCwtModule = !inDstModule && !inEtbModule && !inOnettModule;

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-brand">
          <span className="app-brand-mark">PO</span>
          <span>Pre-ONETT</span>
        </div>
        <div className="app-modules">
          <Link to="/" className={inCwtModule ? 'active' : undefined}>
            Pre-ONETT
          </Link>
          <Link to={ETB_PREFIX} className={inEtbModule ? 'active' : undefined}>
            ETB Calculator
          </Link>
          <Link to={ONETT_PREFIX} className={inOnettModule ? 'active' : undefined}>
            ONETT Summary
          </Link>
          {/* Always the last button in this row. */}
          <Link to={DST_TRANSFER_TAX_PREFIX} className={inDstModule ? 'active' : undefined}>
            DST &amp; Transfer Tax Review
          </Link>
        </div>
        <div className="app-header-actions">
          <button className="btn btn-ghost-light btn-sm" onClick={handleLogout}>
            <Icon name="logout" /> Log out
          </button>
        </div>
      </header>
      <div className="app-subheader">
        {inDstModule ? (
          <nav>
            <NavLink to={DST_TRANSFER_TAX_PREFIX} end>
              DST &amp; Transfer Tax Review
            </NavLink>
          </nav>
        ) : inOnettModule ? (
          <nav>
            <NavLink to={ONETT_PREFIX} end>
              ONETT Dashboard
            </NavLink>
            <NavLink to={`${ONETT_PREFIX}/upload`}>New Summary</NavLink>
          </nav>
        ) : inEtbModule ? (
          <nav>
            <NavLink to={ETB_PREFIX} end>
              ETB Dashboard
            </NavLink>
            <NavLink to={`${ETB_PREFIX}/calculator`}>New Calculation</NavLink>
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
          <Route path={ETB_PREFIX} element={<EtbDashboardPage />} />
          <Route path={`${ETB_PREFIX}/calculator`} element={<EtbCalculatorPage />} />
          <Route path={ONETT_PREFIX} element={<OnettDashboardPage />} />
          <Route path={`${ONETT_PREFIX}/upload`} element={<OnettUploadPage />} />
          <Route path="/reference" element={<ReferenceDataPage />} />
          <Route path={DST_TRANSFER_TAX_PREFIX} element={<DstTransferTaxPage />} />
        </Routes>
      </main>
    </div>
  );
}

export default App;
