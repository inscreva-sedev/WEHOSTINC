'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { X, ShieldCheck } from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';

export interface CookiePreferences {
  essential: true;
  analytics: boolean;
  marketing: boolean;
  updatedAt: string;
}

const STORAGE_KEY = 'wehost_cookie_consent_v1';
const COOKIE_NAME = 'wehost_cookie_consent';

const EXCLUDED_ROUTE_PREFIXES = [
  '/admin',
  '/dashboard',
  '/webmail',
  '/site/',
  '/ai-website-builder',
];

function applyThirdPartyConsent(prefs: CookiePreferences) {
  if (typeof window === 'undefined') return;
  const w = window as any;

  // Google Analytics / Tag Manager Consent Mode
  if (typeof w.gtag === 'function') {
    try {
      w.gtag('consent', 'update', {
        analytics_storage: prefs.analytics ? 'granted' : 'denied',
        ad_storage: prefs.marketing ? 'granted' : 'denied',
        ad_user_data: prefs.marketing ? 'granted' : 'denied',
        ad_personalization: prefs.marketing ? 'granted' : 'denied',
      });
    } catch {
      // silencioso
    }
  }

  // Meta Pixel Consent
  if (typeof w.fbq === 'function') {
    try {
      w.fbq('consent', prefs.marketing ? 'grant' : 'revoke');
    } catch {
      // silencioso
    }
  }
}

export default function CookieConsentBanner() {
  const pathname = usePathname();
  const { language } = useLanguage();
  const isEn = language === 'en';

  const [isVisible, setIsVisible] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [analyticsEnabled, setAnalyticsEnabled] = useState(true);
  const [marketingEnabled, setMarketingEnabled] = useState(true);

  const isExcludedRoute = EXCLUDED_ROUTE_PREFIXES.some((prefix) =>
    pathname?.startsWith(prefix)
  );

  useEffect(() => {
    if (isExcludedRoute) return;

    try {
      const savedRaw = localStorage.getItem(STORAGE_KEY);
      if (savedRaw) {
        const parsed = JSON.parse(savedRaw) as CookiePreferences;
        setAnalyticsEnabled(Boolean(parsed.analytics));
        setMarketingEnabled(Boolean(parsed.marketing));
        applyThirdPartyConsent(parsed);
        setIsVisible(false);
        return;
      }
    } catch {
      // Ignora erro de parse e mostra banner
    }

    const timer = setTimeout(() => setIsVisible(true), 500);
    return () => clearTimeout(timer);
  }, [isExcludedRoute]);

  useEffect(() => {
    const handleOpenSettings = () => {
      setShowSettings(true);
    };
    window.addEventListener('wehost:open-cookie-settings', handleOpenSettings);
    return () => window.removeEventListener('wehost:open-cookie-settings', handleOpenSettings);
  }, []);

  const persistPreferences = useCallback((analytics: boolean, marketing: boolean) => {
    const prefs: CookiePreferences = {
      essential: true,
      analytics,
      marketing,
      updatedAt: new Date().toISOString(),
    };

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
      const encoded = encodeURIComponent(
        JSON.stringify({ a: analytics ? 1 : 0, m: marketing ? 1 : 0 })
      );
      document.cookie = `${COOKIE_NAME}=${encoded}; path=/; max-age=${180 * 24 * 60 * 60}; SameSite=Lax`;
    } catch {
      // Ignora falhas de storage em modo privado restrito
    }

    setAnalyticsEnabled(analytics);
    setMarketingEnabled(marketing);
    applyThirdPartyConsent(prefs);
    setIsVisible(false);
    setShowSettings(false);
  }, []);

  if (isExcludedRoute) return null;

  return (
    <>
      {/* Barra Flutuante Estilo Vidro Fosco */}
      {isVisible && !showSettings && (
        <aside
          role="dialog"
          aria-live="polite"
          aria-label={isEn ? 'Cookie consent' : 'Consentimento de cookies'}
          className="fixed bottom-3 sm:bottom-5 left-3 right-3 sm:left-6 sm:right-6 z-[60] pointer-events-none"
        >
          <div className="pointer-events-auto max-w-[1360px] mx-auto bg-neutral-100/90 backdrop-blur-xl border border-black/10 rounded-lg sm:rounded-xl shadow-[0_18px_50px_rgba(15,23,42,0.18)] px-5 py-4 sm:px-7 sm:py-5">
            <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 lg:gap-8">
              <div className="max-w-4xl">
                <h2 className="text-sm sm:text-base font-bold text-slate-900 mb-1">
                  {isEn
                    ? 'Help us improve our website with cookies'
                    : 'Ajude-nos a melhorar o nosso website com cookies'}
                </h2>
                <p className="text-xs sm:text-[13px] text-slate-700 leading-relaxed">
                  {isEn ? (
                    <>
                      We use cookies and process data from your device to analyze website performance, personalize ad content, and improve your experience. Your consent includes data transfers outside your country. View{' '}
                      <button
                        type="button"
                        onClick={() => setShowSettings(true)}
                        className="underline underline-offset-2 font-medium text-slate-900 hover:text-primary-700 cursor-pointer"
                      >
                        Cookie settings
                      </button>{' '}
                      for more information.
                    </>
                  ) : (
                    <>
                      Utilizamos cookies e processamos dados do seu dispositivo para analisar o desempenho do website, personalizar o conteúdo dos anúncios e melhorar a sua experiência. O seu consentimento inclui transferências de dados para fora do país em que se encontra. Consulte{' '}
                      <button
                        type="button"
                        onClick={() => setShowSettings(true)}
                        className="underline underline-offset-2 font-medium text-slate-900 hover:text-primary-700 cursor-pointer"
                      >
                        Definições de cookies
                      </button>{' '}
                      para obter mais informações.
                    </>
                  )}
                </p>
              </div>

              <div className="flex items-center gap-2.5 sm:gap-3 shrink-0">
                <button
                  type="button"
                  onClick={() => persistPreferences(true, true)}
                  className="flex-1 sm:flex-none bg-white hover:bg-slate-50 active:scale-[0.98] text-slate-900 font-semibold text-xs sm:text-sm px-7 sm:px-9 py-2.5 rounded-md shadow-xs border border-slate-200/80 transition cursor-pointer"
                >
                  {isEn ? 'Accept' : 'Aceitar'}
                </button>
                <button
                  type="button"
                  onClick={() => persistPreferences(false, false)}
                  className="flex-1 sm:flex-none bg-white hover:bg-slate-50 active:scale-[0.98] text-slate-900 font-semibold text-xs sm:text-sm px-7 sm:px-9 py-2.5 rounded-md shadow-xs border border-slate-200/80 transition cursor-pointer"
                >
                  {isEn ? 'Reject' : 'Rejeitar'}
                </button>
              </div>
            </div>
          </div>
        </aside>
      )}

      {/* Modal de Definições Granulares de Cookies */}
      {showSettings && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={isEn ? 'Cookie settings' : 'Definições de cookies'}
          className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs"
        >
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-lg w-full p-6">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100 mb-4">
              <div className="flex items-center gap-2.5">
                <ShieldCheck className="w-5 h-5 text-primary-600" />
                <h3 className="text-base sm:text-lg font-bold text-slate-900">
                  {isEn ? 'Cookie Settings' : 'Definições de cookies'}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowSettings(false)}
                aria-label={isEn ? 'Close' : 'Fechar'}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs sm:text-sm text-slate-600 mb-5 leading-relaxed">
              {isEn
                ? 'Choose which cookie categories you allow on WEHOSTHERE. Essential cookies are always active so authentication, security, and checkout work properly.'
                : 'Escolha quais categorias de cookies permite na WEHOSTHERE. Os cookies essenciais estão sempre ativos para garantir autenticação, segurança e pagamentos.'}
            </p>

            <div className="space-y-3 mb-5">
              {/* Essenciais */}
              <div className="flex items-start justify-between gap-4 p-3.5 rounded-xl bg-slate-50 border border-slate-200/80">
                <div>
                  <span className="text-xs sm:text-sm font-bold text-slate-900 block">
                    {isEn ? 'Strictly Essential' : 'Estritamente Essenciais'}
                  </span>
                  <span className="text-[11px] sm:text-xs text-slate-500">
                    {isEn
                      ? 'Session, security, language, currency, and checkout.'
                      : 'Sessão, segurança, idioma, moeda e checkout.'}
                  </span>
                </div>
                <span className="text-[11px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-full shrink-0">
                  {isEn ? 'Always active' : 'Sempre ativo'}
                </span>
              </div>

              {/* Analíticos */}
              <label className="flex items-start justify-between gap-4 p-3.5 rounded-xl bg-white border border-slate-200 hover:border-slate-300 cursor-pointer transition">
                <div>
                  <span className="text-xs sm:text-sm font-bold text-slate-900 block">
                    {isEn ? 'Analytics & Performance' : 'Desempenho & Análise'}
                  </span>
                  <span className="text-[11px] sm:text-xs text-slate-500">
                    {isEn
                      ? 'Helps us measure traffic and improve page speed and usability.'
                      : 'Ajuda-nos a medir o desempenho e melhorar a experiência do site.'}
                  </span>
                </div>
                <input
                  type="checkbox"
                  checked={analyticsEnabled}
                  onChange={(e) => setAnalyticsEnabled(e.target.checked)}
                  className="mt-1 h-4 w-4 rounded text-primary-600 cursor-pointer shrink-0"
                />
              </label>

              {/* Marketing */}
              <label className="flex items-start justify-between gap-4 p-3.5 rounded-xl bg-white border border-slate-200 hover:border-slate-300 cursor-pointer transition">
                <div>
                  <span className="text-xs sm:text-sm font-bold text-slate-900 block">
                    {isEn ? 'Marketing & Advertising' : 'Anúncios & Personalização'}
                  </span>
                  <span className="text-[11px] sm:text-xs text-slate-500">
                    {isEn
                      ? 'Used to measure campaigns and personalize relevant content.'
                      : 'Utilizados para medir campanhas e personalizar conteúdo de anúncios.'}
                  </span>
                </div>
                <input
                  type="checkbox"
                  checked={marketingEnabled}
                  onChange={(e) => setMarketingEnabled(e.target.checked)}
                  className="mt-1 h-4 w-4 rounded text-primary-600 cursor-pointer shrink-0"
                />
              </label>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-4 border-t border-slate-100">
              <Link
                href="/privacy"
                onClick={() => setShowSettings(false)}
                className="text-xs font-medium text-primary-600 hover:underline"
              >
                {isEn ? 'Read Privacy Policy' : 'Ler Política de Privacidade'}
              </Link>

              <div className="flex items-center gap-2 justify-end">
                <button
                  type="button"
                  onClick={() => persistPreferences(false, false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition cursor-pointer"
                >
                  {isEn ? 'Reject optional' : 'Rejeitar opcionais'}
                </button>
                <button
                  type="button"
                  onClick={() => persistPreferences(analyticsEnabled, marketingEnabled)}
                  className="px-4 py-2 text-xs font-bold text-white bg-primary-600 hover:bg-primary-700 rounded-lg shadow transition cursor-pointer"
                >
                  {isEn ? 'Save preferences' : 'Guardar preferências'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
