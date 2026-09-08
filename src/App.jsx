import { Navigate, Route, Routes } from 'react-router-dom';
import TopNav from './components/TopNav';
import PrototypeBanner from './components/PrototypeBanner';
import AdminConsole from './pages/AdminConsole';
import StudentPortal from './pages/StudentPortal';
import VerificationUI from './pages/VerificationUI';
import PublicProfile from './pages/PublicProfile';
import { AuthProvider } from './context/AuthContext';
import { ToastProvider } from './context/ToastContext';

export default function App() {
  return (
    <AuthProvider>
      <ToastProvider>
        <div className="min-h-screen flex flex-col">
          <TopNav />
          <main className="flex-1">
            <Routes>
              <Route path="/" element={<Navigate to="/verify" replace />} />
              <Route path="/admin" element={<AdminConsole />} />
              <Route path="/student" element={<StudentPortal />} />
              <Route path="/verify" element={<VerificationUI />} />
              <Route path="/profile/:studentId" element={<PublicProfile />} />
              <Route path="*" element={<Navigate to="/verify" replace />} />
            </Routes>
          </main>
          <PrototypeBanner />
        </div>
      </ToastProvider>
    </AuthProvider>
  );
}
