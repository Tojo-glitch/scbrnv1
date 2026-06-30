import React, { useState, useEffect } from 'react';
import { supabase } from './lib/supabaseClient';
import type { Session } from '@supabase/supabase-js';
import App from './App';

// ─── Login Screen ──────────────────────────────────────────────────────────

function LoginScreen() {
  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [mode,     setMode]     = useState<'login' | 'signup'>('login');
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState('');
  const [success,  setSuccess]  = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setSuccess('');

    try {
      if (mode === 'signup') {
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        setSuccess('ส่ง email ยืนยันแล้ว — กรุณาตรวจสอบกล่อง inbox');
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
    } catch (err: any) {
      setError(err.message ?? 'เกิดข้อผิดพลาด กรุณาลองใหม่');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F9F9F7] flex items-center justify-center p-4">
      <div className="w-full max-w-sm">

        {/* Logo */}
        <div className="text-center mb-10">
          <div className="w-14 h-14 bg-black text-white rounded-2xl flex items-center justify-center font-black italic text-2xl tracking-tighter mx-auto mb-4 shadow-lg">
            R.L
          </div>
          <h1 className="text-3xl font-serif italic font-bold text-[#121212]">
            Routine Lab
          </h1>
          <p className="text-xs text-black/40 font-sans font-medium mt-1 uppercase tracking-widest">
            Mental Brain Dump & Tracker
          </p>
        </div>

        {/* Card */}
        <div className="bg-white border border-black/10 rounded-2xl p-8 shadow-sm">
          <h2 className="text-lg font-black uppercase tracking-wider mb-6 text-[#121212]">
            {mode === 'login' ? 'เข้าสู่ระบบ' : 'สมัครสมาชิก'}
          </h2>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-[11px] font-black uppercase tracking-wider text-black/50 mb-1.5">
                อีเมล
              </label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                autoComplete="email"
                placeholder="your@email.com"
                style={{ colorScheme: 'light' }}
                className="w-full bg-[#F9F9F7] border border-black/10 rounded-lg px-4 py-3 text-sm text-[#121212] focus:outline-none focus:border-black font-sans font-medium placeholder:text-black/30"
              />
            </div>

            <div>
              <label className="block text-[11px] font-black uppercase tracking-wider text-black/50 mb-1.5">
                รหัสผ่าน
              </label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                placeholder="••••••••"
                style={{ colorScheme: 'light' }}
                className="w-full bg-[#F9F9F7] border border-black/10 rounded-lg px-4 py-3 text-sm text-[#121212] focus:outline-none focus:border-black font-sans font-medium placeholder:text-black/30"
              />
            </div>

            {error && (
              <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 font-medium">
                {error}
              </div>
            )}

            {success && (
              <div className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 font-medium">
                {success}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-black text-white py-3.5 rounded-xl text-xs font-black uppercase tracking-widest hover:bg-black/80 transition-all disabled:opacity-50 cursor-pointer flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <svg className="animate-spin w-4 h-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                  </svg>
                  กำลังโหลด...
                </>
              ) : (
                mode === 'login' ? 'เข้าสู่ระบบ' : 'สร้างบัญชี'
              )}
            </button>
          </form>

          <div className="mt-5 text-center">
            <button
              onClick={() => { setMode(m => m === 'login' ? 'signup' : 'login'); setError(''); setSuccess(''); }}
              className="text-[11px] text-black/40 hover:text-black font-medium transition-colors cursor-pointer underline underline-offset-2"
            >
              {mode === 'login' ? 'ยังไม่มีบัญชี? สมัครสมาชิก' : 'มีบัญชีแล้ว? เข้าสู่ระบบ'}
            </button>
          </div>
        </div>

        <p className="text-center text-[10px] text-black/25 mt-6 font-mono">
          ข้อมูลของคุณถูกเก็บรักษาด้วย Supabase RLS
        </p>
      </div>
    </div>
  );
}

// ─── Auth Wrapper ──────────────────────────────────────────────────────────

export default function AuthWrapper() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });

    // Listen for auth state changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });

    return () => subscription.unsubscribe();
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#F9F9F7] flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 bg-black text-white rounded-xl flex items-center justify-center font-black italic text-lg">
            R.L
          </div>
          <div className="w-5 h-5 border-2 border-black/20 border-t-black rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  if (!session) {
    return <LoginScreen />;
  }

  return <App session={session} />;
}